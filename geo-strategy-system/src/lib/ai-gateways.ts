import "server-only"

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "crypto"
import { cleanAiPath, validateAiBaseUrl } from "@/lib/ai-settings"
import { kv } from "@/lib/kv"
import type {
  AiGatewayAuthType,
  AiGatewayHealthStatus,
  AiGatewayModel,
  AiGatewayModelFamily,
  AiGatewayPreset,
  AiGatewayPresetKey,
  AiGatewayProtocol,
  AiGatewayProviderKey,
  AiGatewayProviderPublic,
  AiGatewayProviderRuntime,
} from "@/types/ai-gateway"

interface StoredAiGatewayProvider {
  id: string
  name: string
  preset: AiGatewayPresetKey
  protocol: AiGatewayProtocol
  baseUrl: string
  chatPath: string
  modelsPath: string
  authType: AiGatewayAuthType
  encryptedApiKey?: string
  apiKeyPreview?: string
  enabled: boolean
  priority: number
  timeout: number
  maxConcurrency: number
  models: AiGatewayModel[]
  healthStatus: AiGatewayHealthStatus
  healthMessage?: string
  lastCheckedAt?: string
  lastLatencyMs?: number
  createdAt: string
  updatedAt: string
  updatedBy: string
}

const STORE_KEY = "system:ai-gateway-providers:v1"
const PROVIDER_ID_PATTERN = /^gw_[a-f0-9]{24}$/
const MODEL_ID_PATTERN = /^[^\s]{1,200}$/
let mutationQueue: Promise<void> = Promise.resolve()

export const AI_GATEWAY_PRESETS: AiGatewayPreset[] = [
  {
    key: "bai",
    label: "B.AI",
    description: "B.AI 的 OpenAI 兼容接口，可同步 GPT、Claude、Gemini 等可用模型。",
    baseUrl: "https://api.b.ai",
    chatPath: "/v1/chat/completions",
    modelsPath: "/v1/models",
    protocol: "openai_chat",
    authType: "bearer",
    timeout: 600,
    maxConcurrency: 2,
  },
  {
    key: "openai-compatible",
    label: "自定义 OpenAI 兼容中转站",
    description: "适用于提供 /v1/chat/completions 的其他中转站服务商。",
    baseUrl: "https://api.example.com",
    chatPath: "/v1/chat/completions",
    modelsPath: "/v1/models",
    protocol: "openai_chat",
    authType: "bearer",
    timeout: 600,
    maxConcurrency: 2,
  },
]

function encryptionKey(): Buffer {
  const secret = String(
    process.env.AI_CONFIG_ENCRYPTION_KEY
      || process.env.AUTH_SECRET
      || "",
  ).trim()
  if (!secret) {
    throw new Error("服务器缺少 AI_CONFIG_ENCRYPTION_KEY，暂时不能保存中转站密钥")
  }
  return createHash("sha256").update(secret, "utf8").digest()
}

function encryptSecret(value: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":")
}

function decryptSecret(value: string): string {
  const [version, ivRaw, tagRaw, encryptedRaw] = value.split(":")
  if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error("中转站密钥格式无效，请重新保存 API Key")
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"))
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"))
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    throw new Error("中转站密钥无法解密，请重新保存 API Key")
  }
}

function maskApiKey(value: string): string {
  return value ? `••••${value.slice(-4)}` : ""
}

function safeUpstreamMessage(value: unknown, max = 300): string {
  return String(value || "")
    .replace(/sk-[A-Za-z0-9_.-]{6,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer ***")
    .replace(/x-api-key["':=\s]+[A-Za-z0-9._~-]+/gi, "x-api-key: ***")
    .replace(/\s+/g, " ")
    .slice(0, max)
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.round(Number(value))
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function normalizeName(value: unknown): string {
  const name = String(value || "").trim().slice(0, 60)
  if (!name) throw new Error("请填写中转站名称")
  return name
}

function normalizeModelsPath(value: unknown): string {
  const path = cleanAiPath(String(value || "/v1/models"))
  if (path.length > 240 || path.includes("..")) throw new Error("模型列表路径无效")
  return path
}

function normalizeModelId(value: unknown): string {
  const id = String(value || "").trim()
  if (!MODEL_ID_PATTERN.test(id)) return ""
  return id
}

export function inferAiGatewayModelFamily(modelId: string): AiGatewayModelFamily {
  const id = modelId.toLowerCase()
  if (/claude|sonnet|opus|haiku/.test(id)) return "claude"
  if (/gemini/.test(id)) return "gemini"
  if (/(^|[\/_-])gpt|openai|o[134](?:[\/_-]|$)/.test(id)) return "gpt"
  return "other"
}

export function toGatewayProviderKey(providerId: string): AiGatewayProviderKey {
  if (!PROVIDER_ID_PATTERN.test(providerId)) throw new Error("中转站编号无效")
  return `gateway:${providerId}`
}

export function parseGatewayProviderKey(value: unknown): string | null {
  const raw = String(value || "")
  if (!raw.startsWith("gateway:")) return null
  const id = raw.slice("gateway:".length)
  return PROVIDER_ID_PATTERN.test(id) ? id : null
}

function cloneModels(models: AiGatewayModel[]): AiGatewayModel[] {
  return models.map(model => ({ ...model, endpointTypes: [...model.endpointTypes] }))
}

function normalizeStoredProvider(value: unknown): StoredAiGatewayProvider | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const provider = value as StoredAiGatewayProvider
  if (!PROVIDER_ID_PATTERN.test(provider.id) || !provider.name || !provider.baseUrl) return null
  return {
    ...provider,
    models: Array.isArray(provider.models) ? cloneModels(provider.models) : [],
    healthStatus: provider.healthStatus || "unchecked",
  }
}

async function readProviders(): Promise<StoredAiGatewayProvider[]> {
  const values = await kv.get<unknown[]>(STORE_KEY)
  return (Array.isArray(values) ? values : [])
    .map(normalizeStoredProvider)
    .filter((provider): provider is StoredAiGatewayProvider => Boolean(provider))
}

async function mutateProviders<T>(
  mutate: (providers: StoredAiGatewayProvider[]) => Promise<T> | T,
): Promise<T> {
  const previous = mutationQueue
  let release: () => void = () => undefined
  mutationQueue = new Promise<void>(resolve => {
    release = resolve
  })
  await previous.catch(() => undefined)
  try {
    const providers = await readProviders()
    const result = await mutate(providers)
    await kv.set(STORE_KEY, providers)
    return result
  } finally {
    release()
  }
}

function toPublic(provider: StoredAiGatewayProvider): AiGatewayProviderPublic {
  return {
    id: provider.id,
    providerKey: toGatewayProviderKey(provider.id),
    name: provider.name,
    preset: provider.preset,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    chatPath: provider.chatPath,
    modelsPath: provider.modelsPath,
    authType: provider.authType,
    hasApiKey: Boolean(provider.encryptedApiKey),
    apiKeyPreview: provider.apiKeyPreview || "",
    enabled: provider.enabled,
    priority: provider.priority,
    timeout: provider.timeout,
    maxConcurrency: provider.maxConcurrency,
    models: cloneModels(provider.models),
    healthStatus: provider.healthStatus,
    healthMessage: provider.healthMessage,
    lastCheckedAt: provider.lastCheckedAt,
    lastLatencyMs: provider.lastLatencyMs,
    updatedAt: provider.updatedAt,
  }
}

export async function listAiGatewayProvidersPublic(): Promise<AiGatewayProviderPublic[]> {
  const providers = await readProviders()
  return providers
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name, "zh-CN"))
    .map(toPublic)
}

export async function getAiGatewayProviderRuntime(
  providerId: string,
): Promise<AiGatewayProviderRuntime> {
  if (!PROVIDER_ID_PATTERN.test(providerId)) throw new Error("中转站编号无效")
  const provider = (await readProviders()).find(item => item.id === providerId)
  if (!provider) throw new Error("中转站不存在或已经移除")
  const apiKey = provider.encryptedApiKey ? decryptSecret(provider.encryptedApiKey) : ""
  return {
    ...toPublic(provider),
    apiKey,
  }
}

export async function saveAiGatewayProvider(
  input: {
    id?: string
    name: string
    preset: AiGatewayPresetKey
    baseUrl: string
    chatPath: string
    modelsPath: string
    authType: AiGatewayAuthType
    apiKey?: string
    clearApiKey?: boolean
    enabled?: boolean
    priority?: number
    timeout?: number
    maxConcurrency?: number
    manualModels?: string[]
  },
  adminUserId: string,
): Promise<AiGatewayProviderPublic> {
  return mutateProviders(providers => {
    const now = new Date().toISOString()
    const existingIndex = input.id
      ? providers.findIndex(provider => provider.id === input.id)
      : -1
    if (input.id && existingIndex < 0) throw new Error("中转站不存在或已经移除")
    const previous = existingIndex >= 0 ? providers[existingIndex] : undefined
    const preset = AI_GATEWAY_PRESETS.find(item => item.key === input.preset)
    if (!preset) throw new Error("中转站预设无效")

    const apiKey = String(input.apiKey || "").trim()
    const encryptedApiKey = input.clearApiKey
      ? undefined
      : apiKey
        ? encryptSecret(apiKey)
        : previous?.encryptedApiKey
    if (!encryptedApiKey && input.enabled !== false) {
      throw new Error("请填写中转站 API Key，或先将该中转站停用")
    }

    const manualModelIds = [...new Set((input.manualModels || []).map(normalizeModelId).filter(Boolean))]
    const syncedModels = (previous?.models || []).filter(model => model.source === "synced")
    const syncedIds = new Set(syncedModels.map(model => model.id))
    const manualModels: AiGatewayModel[] = manualModelIds
      .filter(id => !syncedIds.has(id))
      .map(id => ({
        id,
        displayName: id,
        family: inferAiGatewayModelFamily(id),
        endpointTypes: ["chat.completions"],
        enabled: previous?.models.find(model => model.id === id)?.enabled ?? true,
        source: "manual",
        updatedAt: now,
      }))

    const provider: StoredAiGatewayProvider = {
      id: previous?.id || `gw_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      name: normalizeName(input.name),
      preset: preset.key,
      protocol: "openai_chat",
      baseUrl: validateAiBaseUrl(input.baseUrl || preset.baseUrl),
      chatPath: cleanAiPath(input.chatPath || preset.chatPath),
      modelsPath: normalizeModelsPath(input.modelsPath || preset.modelsPath),
      authType: input.authType === "x-api-key" ? "x-api-key" : "bearer",
      encryptedApiKey,
      apiKeyPreview: input.clearApiKey
        ? undefined
        : apiKey
          ? maskApiKey(apiKey)
          : previous?.apiKeyPreview,
      enabled: input.enabled !== false,
      priority: clampInteger(input.priority, 1, 999, previous?.priority || providers.length + 1),
      timeout: clampInteger(input.timeout, 30, 1800, preset.timeout),
      maxConcurrency: clampInteger(input.maxConcurrency, 1, 20, preset.maxConcurrency),
      models: [...syncedModels, ...manualModels],
      healthStatus: previous?.healthStatus || "unchecked",
      healthMessage: previous?.healthMessage,
      lastCheckedAt: previous?.lastCheckedAt,
      lastLatencyMs: previous?.lastLatencyMs,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      updatedBy: adminUserId,
    }

    if (existingIndex >= 0) providers[existingIndex] = provider
    else providers.push(provider)
    return toPublic(provider)
  })
}

function authHeaders(authType: AiGatewayAuthType, apiKey: string): Record<string, string> {
  return authType === "x-api-key"
    ? { "x-api-key": apiKey }
    : { Authorization: `Bearer ${apiKey}` }
}

function modelEndpointTypes(value: Record<string, unknown>): string[] {
  const raw = value.supported_endpoint_types ?? value.endpoint_types ?? value.endpoints
  return Array.isArray(raw)
    ? raw.map(item => String(item || "").trim()).filter(Boolean).slice(0, 20)
    : []
}

export async function syncAiGatewayModels(
  providerId: string,
  adminUserId: string,
): Promise<AiGatewayProviderPublic> {
  const runtime = await getAiGatewayProviderRuntime(providerId)
  if (!runtime.apiKey) throw new Error("请先配置中转站 API Key")

  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.min(60, runtime.timeout) * 1000)
  let modelValues: Array<Record<string, unknown>>
  try {
    const response = await fetch(`${validateAiBaseUrl(runtime.baseUrl)}${cleanAiPath(runtime.modelsPath)}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...authHeaders(runtime.authType, runtime.apiKey),
      },
    })
    const raw = await response.text()
    if (!response.ok) {
      throw new Error(`模型同步失败 HTTP ${response.status}：${safeUpstreamMessage(raw, 180) || "无响应内容"}`)
    }
    const parsed = JSON.parse(raw) as { data?: unknown[]; models?: unknown[] }
    const values = Array.isArray(parsed.data) ? parsed.data : Array.isArray(parsed.models) ? parsed.models : []
    modelValues = values.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "模型同步超时，请检查中转站地址或网络"
      : error instanceof Error
        ? error.message
        : "模型同步失败"
    await updateGatewayHealth(providerId, "unhealthy", message, Date.now() - startedAt, adminUserId)
    throw new Error(message)
  } finally {
    clearTimeout(timeout)
  }

  const now = new Date().toISOString()
  const syncedCandidates = modelValues
    .flatMap<AiGatewayModel>(item => {
      const id = normalizeModelId(item.id ?? item.model ?? item.name)
      if (!id) return []
      const endpointTypes = modelEndpointTypes(item)
      return [{
        id,
        displayName: String(item.display_name ?? item.displayName ?? id).trim().slice(0, 200) || id,
        family: inferAiGatewayModelFamily(id),
        endpointTypes,
        enabled: true,
        source: "synced" as const,
        updatedAt: now,
      }]
    })
    .filter(model => model.endpointTypes.length === 0
      || model.endpointTypes.some(type => /chat|completion/i.test(type)))
  const synced = [...new Map(syncedCandidates.map(model => [model.id, model])).values()]

  if (synced.length === 0) {
    const message = "中转站连接成功，但模型列表为空；可在配置中手动填写模型名"
    return updateGatewayModels(providerId, [], message, Date.now() - startedAt, adminUserId)
  }
  return updateGatewayModels(providerId, synced, `已同步 ${synced.length} 个模型`, Date.now() - startedAt, adminUserId)
}

async function updateGatewayModels(
  providerId: string,
  synced: AiGatewayModel[],
  message: string,
  latencyMs: number,
  adminUserId: string,
): Promise<AiGatewayProviderPublic> {
  return mutateProviders(providers => {
    const index = providers.findIndex(provider => provider.id === providerId)
    if (index < 0) throw new Error("中转站不存在或已经移除")
    const provider = providers[index]
    const prior = new Map(provider.models.map(model => [model.id, model]))
    const manual = provider.models.filter(model => model.source === "manual")
    const manualIds = new Set(manual.map(model => model.id))
    provider.models = [
      ...synced
        .filter(model => !manualIds.has(model.id))
        .map(model => ({ ...model, enabled: prior.get(model.id)?.enabled ?? true })),
      ...manual,
    ].sort((a, b) => a.family.localeCompare(b.family) || a.id.localeCompare(b.id))
    provider.healthStatus = "healthy"
    provider.healthMessage = message
    provider.lastCheckedAt = new Date().toISOString()
    provider.lastLatencyMs = Math.max(0, Math.round(latencyMs))
    provider.updatedAt = provider.lastCheckedAt
    provider.updatedBy = adminUserId
    return toPublic(provider)
  })
}

async function updateGatewayHealth(
  providerId: string,
  status: AiGatewayHealthStatus,
  message: string,
  latencyMs: number,
  adminUserId: string,
): Promise<AiGatewayProviderPublic> {
  return mutateProviders(providers => {
    const provider = providers.find(item => item.id === providerId)
    if (!provider) throw new Error("中转站不存在或已经移除")
    provider.healthStatus = status
    provider.healthMessage = safeUpstreamMessage(message)
    provider.lastCheckedAt = new Date().toISOString()
    provider.lastLatencyMs = Math.max(0, Math.round(latencyMs))
    provider.updatedAt = provider.lastCheckedAt
    provider.updatedBy = adminUserId
    return toPublic(provider)
  })
}

export async function setAiGatewayEnabled(
  providerId: string,
  enabled: boolean,
  adminUserId: string,
): Promise<AiGatewayProviderPublic> {
  return mutateProviders(providers => {
    const provider = providers.find(item => item.id === providerId)
    if (!provider) throw new Error("中转站不存在或已经移除")
    provider.enabled = enabled
    provider.updatedAt = new Date().toISOString()
    provider.updatedBy = adminUserId
    return toPublic(provider)
  })
}

export async function setAiGatewayModelEnabled(
  providerId: string,
  modelId: string,
  enabled: boolean,
  adminUserId: string,
): Promise<AiGatewayProviderPublic> {
  return mutateProviders(providers => {
    const provider = providers.find(item => item.id === providerId)
    if (!provider) throw new Error("中转站不存在或已经移除")
    const model = provider.models.find(item => item.id === modelId)
    if (!model) throw new Error("模型不存在，请重新同步模型列表")
    model.enabled = enabled
    model.updatedAt = new Date().toISOString()
    provider.updatedAt = model.updatedAt
    provider.updatedBy = adminUserId
    return toPublic(provider)
  })
}

export function aiGatewayAuthHeaders(
  authType: AiGatewayAuthType,
  apiKey: string,
): Record<string, string> {
  return authHeaders(authType, apiKey)
}
