import "server-only"

import { randomUUID } from "crypto"
import { cleanAiPath, validateAiBaseUrl } from "@/lib/ai-settings"
import {
  decryptAiSecret,
  encryptAiSecret,
  maskAiSecret,
  sanitizeAiUpstreamMessage,
} from "@/lib/ai-secrets"
import { kv } from "@/lib/kv"
import type {
  AiGatewayAuthType,
  AiGatewayChannel,
  AiGatewayHealthStatus,
  AiGatewayModel,
  AiGatewayModelFamily,
  AiGatewayPreset,
  AiGatewayPresetKey,
  AiGatewayProtocol,
  AiGatewayProviderKey,
  AiGatewayProviderPublic,
  AiGatewayProviderRuntime,
  AiGatewaySyncSummary,
  AiGatewayVendor,
} from "@/types/ai-gateway"

interface StoredAiGatewayProvider {
  id: string
  name: string
  preset: AiGatewayPresetKey
  vendor: AiGatewayVendor
  channel: AiGatewayChannel
  protocol: AiGatewayProtocol
  baseUrl: string
  chatPath: string
  modelsPath: string
  modelsUrl?: string
  authType: AiGatewayAuthType
  encryptedApiKey?: string
  apiKeyPreview?: string
  enabled: boolean
  priority: number
  timeout: number
  maxConcurrency: number
  primaryModel?: string
  models: AiGatewayModel[]
  healthStatus: AiGatewayHealthStatus
  healthMessage?: string
  lastCheckedAt?: string
  lastLatencyMs?: number
  lastSyncSummary?: AiGatewaySyncSummary
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
    key: "openai",
    vendor: "openai",
    channel: "official",
    label: "ChatGPT / OpenAI",
    description: "OpenAI 官方接口",
    baseUrl: "https://api.openai.com",
    chatPath: "/v1/responses",
    modelsPath: "/v1/models",
    protocol: "openai_responses",
    authType: "bearer",
    defaultModel: "gpt-5.6-terra",
    timeout: 600,
    maxConcurrency: 3,
  },
  {
    key: "anthropic",
    vendor: "anthropic",
    channel: "official",
    label: "Claude / Anthropic",
    description: "Anthropic 官方接口",
    baseUrl: "https://api.anthropic.com",
    chatPath: "/v1/messages",
    modelsPath: "/v1/models",
    modelsUrl: "https://api.anthropic.com/v1/models?limit=1000",
    protocol: "anthropic_messages",
    authType: "x-api-key",
    defaultModel: "claude-sonnet-5",
    timeout: 600,
    maxConcurrency: 3,
  },
  {
    key: "gemini",
    vendor: "gemini",
    channel: "official",
    label: "Gemini / Google",
    description: "Google AI Studio 官方接口",
    baseUrl: "https://generativelanguage.googleapis.com",
    chatPath: "/v1beta/models/{model}:generateContent",
    modelsPath: "/v1beta/models",
    modelsUrl: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
    protocol: "gemini_generate",
    authType: "query-key",
    defaultModel: "gemini-3.6-flash",
    timeout: 600,
    maxConcurrency: 3,
  },
  {
    key: "doubao",
    vendor: "doubao",
    channel: "official",
    label: "豆包 / 火山方舟",
    description: "火山方舟官方接口",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    chatPath: "/chat/completions",
    modelsPath: "/models",
    protocol: "openai_chat",
    authType: "bearer",
    defaultModel: "doubao-seed-2-0-lite-260215",
    timeout: 600,
    maxConcurrency: 3,
  },
  {
    key: "qwen",
    vendor: "qwen",
    channel: "official",
    label: "通义千问 / 百炼",
    description: "阿里云百炼官方接口",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
    chatPath: "/v1/chat/completions",
    modelsPath: "/v1/models",
    modelsUrl: "https://dashscope.aliyuncs.com/api/v1/deployments/models?page_no=1&page_size=100&version=v1.0&model_source=base",
    protocol: "openai_chat",
    authType: "bearer",
    defaultModel: "qwen-plus",
    timeout: 600,
    maxConcurrency: 3,
  },
  {
    key: "hunyuan",
    vendor: "hunyuan",
    channel: "official",
    label: "腾讯混元 / TokenHub",
    description: "腾讯 TokenHub 官方兼容接口",
    baseUrl: "https://tokenhub.tencentmaas.com",
    chatPath: "/v1/chat/completions",
    modelsPath: "/v1/models",
    protocol: "openai_chat",
    authType: "bearer",
    defaultModel: "hy3-preview",
    timeout: 600,
    maxConcurrency: 3,
  },
  {
    key: "deepseek",
    vendor: "deepseek",
    channel: "official",
    label: "DeepSeek",
    description: "DeepSeek 官方接口",
    baseUrl: "https://api.deepseek.com",
    chatPath: "/chat/completions",
    modelsPath: "/models",
    protocol: "openai_chat",
    authType: "bearer",
    defaultModel: "deepseek-chat",
    timeout: 600,
    maxConcurrency: 3,
  },
  {
    key: "kimi",
    vendor: "kimi",
    channel: "official",
    label: "Kimi / Moonshot",
    description: "Moonshot 官方接口",
    baseUrl: "https://api.moonshot.cn",
    chatPath: "/v1/chat/completions",
    modelsPath: "/v1/models",
    protocol: "openai_chat",
    authType: "bearer",
    defaultModel: "kimi-k2.6",
    timeout: 600,
    maxConcurrency: 3,
  },
  {
    key: "ernie",
    vendor: "ernie",
    channel: "official",
    label: "文心一言 / 千帆",
    description: "百度千帆官方接口",
    baseUrl: "https://qianfan.baidubce.com",
    chatPath: "/v2/chat/completions",
    modelsPath: "/v2/models",
    protocol: "openai_chat",
    authType: "bearer",
    defaultModel: "ernie-4.5-turbo-32k",
    timeout: 600,
    maxConcurrency: 3,
  },
  {
    key: "bai",
    vendor: "relay",
    channel: "relay",
    label: "B.AI 中转站",
    description: "B.AI 的 OpenAI 兼容接口",
    baseUrl: "https://api.b.ai",
    chatPath: "/v1/chat/completions",
    modelsPath: "/v1/models",
    protocol: "openai_chat",
    authType: "bearer",
    configurableBaseUrl: true,
    timeout: 600,
    maxConcurrency: 2,
  },
  {
    key: "openai-compatible",
    vendor: "relay",
    channel: "relay",
    label: "自定义中转站",
    description: "适用于提供 OpenAI 兼容接口的其他服务商",
    baseUrl: "https://api.example.com",
    chatPath: "/v1/chat/completions",
    modelsPath: "/v1/models",
    protocol: "openai_chat",
    authType: "bearer",
    configurableBaseUrl: true,
    timeout: 600,
    maxConcurrency: 2,
  },
]

export const AI_OFFICIAL_PRESETS = AI_GATEWAY_PRESETS.filter(preset => preset.channel === "official")
export const AI_RELAY_PRESETS = AI_GATEWAY_PRESETS.filter(preset => preset.channel === "relay")

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.round(Number(value))
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function normalizeName(value: unknown): string {
  const name = String(value || "").trim().slice(0, 60)
  if (!name) throw new Error("请填写渠道名称")
  return name
}

function normalizeModelsPath(value: unknown): string {
  const path = cleanAiPath(String(value || "/v1/models"))
  if (path.length > 240 || path.includes("..")) throw new Error("模型列表路径无效")
  return path
}

function normalizeModelsUrl(value: unknown): string | undefined {
  const raw = String(value || "").trim()
  if (!raw) return undefined
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error("模型列表地址无效")
  }
  validateAiBaseUrl(`${parsed.origin}${parsed.pathname}`)
  if (parsed.username || parsed.password) throw new Error("模型列表地址不能包含用户名或密码")
  parsed.hash = ""
  return parsed.toString()
}

function normalizeModelId(value: unknown): string {
  const raw = String(value || "").trim().replace(/^models\//, "")
  return MODEL_ID_PATTERN.test(raw) ? raw : ""
}

export function inferAiGatewayModelFamily(modelId: string): AiGatewayModelFamily {
  const id = modelId.toLowerCase()
  if (/claude|sonnet|opus|haiku/.test(id)) return "claude"
  if (/gemini/.test(id)) return "gemini"
  if (/(^|[\/_-])gpt|openai|o[134](?:[\/_-]|$)/.test(id)) return "gpt"
  return "other"
}

export function getAiGatewayPreset(key: AiGatewayPresetKey): AiGatewayPreset {
  const preset = AI_GATEWAY_PRESETS.find(item => item.key === key)
  if (!preset) throw new Error("模型渠道预设无效")
  return preset
}

export function toGatewayProviderKey(providerId: string): AiGatewayProviderKey {
  if (!PROVIDER_ID_PATTERN.test(providerId)) throw new Error("模型渠道编号无效")
  return `gateway:${providerId}`
}

export function parseGatewayProviderKey(value: unknown): string | null {
  const raw = String(value || "")
  if (!raw.startsWith("gateway:")) return null
  const id = raw.slice("gateway:".length)
  return PROVIDER_ID_PATTERN.test(id) ? id : null
}

function cloneModels(models: AiGatewayModel[]): AiGatewayModel[] {
  return models.map(model => ({
    ...model,
    endpointTypes: Array.isArray(model.endpointTypes) ? [...model.endpointTypes] : [],
    status: model.status || "available",
  }))
}

function normalizeStoredProvider(value: unknown): StoredAiGatewayProvider | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const provider = value as StoredAiGatewayProvider
  if (!PROVIDER_ID_PATTERN.test(provider.id) || !provider.name || !provider.baseUrl) return null
  const preset = AI_GATEWAY_PRESETS.find(item => item.key === provider.preset)
    || AI_GATEWAY_PRESETS.find(item => item.key === "openai-compatible")!
  return {
    ...provider,
    preset: preset.key,
    vendor: provider.vendor || preset.vendor,
    channel: provider.channel || preset.channel,
    protocol: provider.protocol || preset.protocol,
    modelsPath: provider.modelsPath || preset.modelsPath,
    modelsUrl: provider.modelsUrl || preset.modelsUrl,
    authType: provider.authType || preset.authType,
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
    vendor: provider.vendor,
    channel: provider.channel,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    chatPath: provider.chatPath,
    modelsPath: provider.modelsPath,
    modelsUrl: provider.modelsUrl,
    authType: provider.authType,
    hasApiKey: Boolean(provider.encryptedApiKey),
    apiKeyPreview: provider.apiKeyPreview || "",
    enabled: provider.enabled,
    priority: provider.priority,
    timeout: provider.timeout,
    maxConcurrency: provider.maxConcurrency,
    primaryModel: provider.primaryModel,
    models: cloneModels(provider.models),
    healthStatus: provider.healthStatus,
    healthMessage: provider.healthMessage,
    lastCheckedAt: provider.lastCheckedAt,
    lastLatencyMs: provider.lastLatencyMs,
    lastSyncSummary: provider.lastSyncSummary,
    updatedAt: provider.updatedAt,
  }
}

export async function listAiGatewayProvidersPublic(): Promise<AiGatewayProviderPublic[]> {
  const providers = await readProviders()
  return providers
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name, "zh-CN"))
    .map(toPublic)
}

export async function getAiGatewayProviderRuntime(providerId: string): Promise<AiGatewayProviderRuntime> {
  if (!PROVIDER_ID_PATTERN.test(providerId)) throw new Error("模型渠道编号无效")
  const provider = (await readProviders()).find(item => item.id === providerId)
  if (!provider) throw new Error("模型渠道不存在或已经移除")
  return {
    ...toPublic(provider),
    apiKey: provider.encryptedApiKey ? decryptAiSecret(provider.encryptedApiKey) : "",
  }
}

export async function saveAiGatewayProvider(
  input: {
    id?: string
    name: string
    preset: AiGatewayPresetKey
    baseUrl?: string
    chatPath?: string
    modelsPath?: string
    modelsUrl?: string
    authType?: AiGatewayAuthType
    apiKey?: string
    clearApiKey?: boolean
    enabled?: boolean
    priority?: number
    timeout?: number
    maxConcurrency?: number
    primaryModel?: string
    manualModels?: string[]
  },
  adminUserId: string,
): Promise<AiGatewayProviderPublic> {
  return mutateProviders(providers => {
    const now = new Date().toISOString()
    const preset = getAiGatewayPreset(input.preset)
    const existingIndex = input.id
      ? providers.findIndex(provider => provider.id === input.id)
      : preset.channel === "official"
        ? providers.findIndex(provider => provider.channel === "official" && provider.vendor === preset.vendor)
        : -1
    if (input.id && existingIndex < 0) throw new Error("模型渠道不存在或已经移除")
    const previous = existingIndex >= 0 ? providers[existingIndex] : undefined

    const apiKey = String(input.apiKey || "").trim()
    const encryptedApiKey = input.clearApiKey
      ? undefined
      : apiKey
        ? encryptAiSecret(apiKey)
        : previous?.encryptedApiKey
    if (!encryptedApiKey && input.enabled !== false) {
      throw new Error("请填写 API Key，或先停用该渠道")
    }

    const fixedOfficial = preset.channel === "official"
    const baseUrl = validateAiBaseUrl(fixedOfficial ? preset.baseUrl : input.baseUrl || preset.baseUrl)
    const chatPath = cleanAiPath(fixedOfficial ? preset.chatPath : input.chatPath || preset.chatPath)
    const modelsPath = normalizeModelsPath(fixedOfficial ? preset.modelsPath : input.modelsPath || preset.modelsPath)
    const modelsUrl = normalizeModelsUrl(fixedOfficial ? preset.modelsUrl : input.modelsUrl || preset.modelsUrl)
    const manualModelIds = [...new Set([
      ...(input.manualModels && input.manualModels.length > 0
        ? input.manualModels
        : previous?.models.filter(model => model.source === "manual").map(model => model.id) || []),
      input.primaryModel || "",
      previous ? "" : preset.defaultModel || "",
    ].map(normalizeModelId).filter(Boolean))]
    const priorModels = previous?.models || []
    const priorById = new Map(priorModels.map(model => [model.id, model]))
    const syncedModels = priorModels.filter(model => model.source === "synced")
    const syncedIds = new Set(syncedModels.map(model => model.id))
    const manualModels: AiGatewayModel[] = manualModelIds
      .filter(id => !syncedIds.has(id))
      .map(id => ({
        id,
        displayName: id,
        family: inferAiGatewayModelFamily(id),
        endpointTypes: ["chat.completions"],
        enabled: priorById.get(id)?.enabled ?? true,
        source: "manual",
        status: "available",
        discoveredAt: priorById.get(id)?.discoveredAt || now,
        lastSeenAt: now,
        updatedAt: now,
      }))

    const provider: StoredAiGatewayProvider = {
      id: previous?.id || `gw_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      name: normalizeName(input.name || preset.label),
      preset: preset.key,
      vendor: preset.vendor,
      channel: preset.channel,
      protocol: preset.protocol,
      baseUrl,
      chatPath,
      modelsPath,
      modelsUrl,
      authType: fixedOfficial ? preset.authType : input.authType || preset.authType,
      encryptedApiKey,
      apiKeyPreview: input.clearApiKey
        ? undefined
        : apiKey
          ? maskAiSecret(apiKey)
          : previous?.apiKeyPreview,
      enabled: input.enabled !== false,
      priority: clampInteger(input.priority, 1, 999, previous?.priority || providers.length + 1),
      timeout: clampInteger(input.timeout, 30, 1800, preset.timeout),
      maxConcurrency: clampInteger(input.maxConcurrency, 1, 20, preset.maxConcurrency),
      primaryModel: normalizeModelId(input.primaryModel) || previous?.primaryModel || preset.defaultModel,
      models: [...syncedModels, ...manualModels],
      healthStatus: previous?.healthStatus || "unchecked",
      healthMessage: previous?.healthMessage,
      lastCheckedAt: previous?.lastCheckedAt,
      lastLatencyMs: previous?.lastLatencyMs,
      lastSyncSummary: previous?.lastSyncSummary,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      updatedBy: adminUserId,
    }

    if (existingIndex >= 0) providers[existingIndex] = provider
    else providers.push(provider)
    return toPublic(provider)
  })
}

function authHeaders(runtime: Pick<AiGatewayProviderRuntime, "authType" | "apiKey" | "protocol">): Record<string, string> {
  if (runtime.authType === "query-key") return {}
  if (runtime.authType === "x-api-key") {
    return {
      "x-api-key": runtime.apiKey,
      ...(runtime.protocol === "anthropic_messages" ? { "anthropic-version": "2023-06-01" } : {}),
    }
  }
  return { Authorization: `Bearer ${runtime.apiKey}` }
}

function modelEndpointTypes(value: Record<string, unknown>): string[] {
  const raw = value.supported_endpoint_types
    ?? value.endpoint_types
    ?? value.endpoints
    ?? value.supportedGenerationMethods
  return Array.isArray(raw)
    ? raw.map(item => String(item || "").trim()).filter(Boolean).slice(0, 20)
    : []
}

function extractModelValues(parsed: unknown): Array<Record<string, unknown>> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return []
  const root = parsed as Record<string, unknown>
  const output = root.output && typeof root.output === "object" ? root.output as Record<string, unknown> : undefined
  const result = root.result && typeof root.result === "object" ? root.result as Record<string, unknown> : undefined
  const candidates = [root.data, root.models, output?.models, output?.data, result?.models, result?.data]
  const values = candidates.find(Array.isArray) as unknown[] | undefined
  return (values || []).flatMap(item => {
    if (typeof item === "string") return [{ id: item }]
    return item && typeof item === "object" && !Array.isArray(item)
      ? [item as Record<string, unknown>]
      : []
  })
}

function modelListUrl(runtime: AiGatewayProviderRuntime): string {
  const raw = runtime.modelsUrl
    || `${validateAiBaseUrl(runtime.baseUrl)}${cleanAiPath(runtime.modelsPath)}`
  const url = new URL(raw)
  if (runtime.authType === "query-key") url.searchParams.set("key", runtime.apiKey)
  return url.toString()
}

function nestedErrorCode(error: unknown): string {
  let current: unknown = error
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") return ""
    const record = current as Record<string, unknown>
    if (typeof record.code === "string") return record.code.toUpperCase()
    current = record.cause
  }
  return ""
}

export function describeAiGatewayNetworkFailure(error: unknown): string {
  const name = error instanceof Error ? error.name : ""
  const code = nestedErrorCode(error)
  if (name === "AbortError" || name === "TimeoutError" || code === "ETIMEDOUT") {
    return "网站服务器连接该渠道超时。电脑上的 VPN 不会作用于服务器，请改用可从中国大陆访问的中转站"
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "网站服务器无法解析该渠道域名，请检查地址或 DNS"
  }
  if (code === "ECONNREFUSED") {
    return "渠道服务器拒绝连接，请检查地址、端口或服务状态"
  }
  if (/CERT|TLS|SSL/.test(code) || /certificate|tls|ssl/i.test(name)) {
    return "渠道的 HTTPS 证书校验失败，请检查中转站证书"
  }
  return `网站服务器无法连接该渠道${code ? `（${code}）` : ""}，请检查地址和服务器网络`
}

export function describeAiGatewayHttpFailure(status: number, raw: unknown): string {
  const detail = sanitizeAiUpstreamMessage(raw, 140)
  const suffix = detail ? `：${detail}` : ""
  if (status === 400) return `服务器线路已连通，但请求参数或模型列表路径不正确（HTTP 400）${suffix}`
  if (status === 401) return `服务器线路已连通，但 API Key 无效或未授权（HTTP 401）${suffix}`
  if (status === 403) return `服务器线路已连通，但账号权限、余额或区域访问受限（HTTP 403）${suffix}`
  if (status === 404) return `服务器线路已连通，但模型列表路径不存在（HTTP 404）${suffix}`
  if (status === 408 || status === 504) return `服务器线路已连通，但上游处理超时（HTTP ${status}）${suffix}`
  if (status === 429) return `服务器线路已连通，但请求频率或额度受限（HTTP 429）${suffix}`
  if (status >= 500) return `服务器线路已连通，但上游服务暂时异常（HTTP ${status}）${suffix}`
  return `服务器线路已连通，但渠道返回 HTTP ${status}${suffix}`
}

async function fetchAiGatewayModelList(
  runtime: AiGatewayProviderRuntime,
  timeoutSeconds: number,
): Promise<{ raw: string; latencyMs: number }> {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutSeconds) * 1000)
  try {
    const response = await fetch(modelListUrl(runtime), {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...authHeaders(runtime),
      },
    })
    const raw = await response.text()
    if (!response.ok) throw new Error(describeAiGatewayHttpFailure(response.status, raw))
    return { raw, latencyMs: Date.now() - startedAt }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("服务器线路已连通")) throw error
    throw new Error(describeAiGatewayNetworkFailure(error))
  } finally {
    clearTimeout(timeout)
  }
}

export async function testAiGatewayConnection(
  providerId: string,
  adminUserId: string,
): Promise<AiGatewayProviderPublic> {
  const runtime = await getAiGatewayProviderRuntime(providerId)
  if (!runtime.apiKey) throw new Error("请先配置 API Key")
  const startedAt = Date.now()
  try {
    const result = await fetchAiGatewayModelList(runtime, Math.min(15, runtime.timeout))
    let modelCount = 0
    try {
      modelCount = extractModelValues(JSON.parse(result.raw)).length
    } catch {
      modelCount = 0
    }
    const message = modelCount > 0
      ? `服务器线路已连通，API Key 校验通过，发现 ${modelCount} 个模型（${result.latencyMs} ms）`
      : `服务器线路已连通，API Key 校验通过（${result.latencyMs} ms）`
    return updateGatewayHealth(providerId, "healthy", message, result.latencyMs, adminUserId)
  } catch (error) {
    const message = error instanceof Error ? error.message : "服务器线路检测失败"
    await updateGatewayHealth(providerId, "unhealthy", message, Date.now() - startedAt, adminUserId)
    throw new Error(message)
  }
}

export async function syncAiGatewayModels(
  providerId: string,
  adminUserId: string,
): Promise<AiGatewayProviderPublic> {
  const runtime = await getAiGatewayProviderRuntime(providerId)
  if (!runtime.apiKey) throw new Error("请先配置 API Key")

  const startedAt = Date.now()
  let modelValues: Array<Record<string, unknown>>
  try {
    const result = await fetchAiGatewayModelList(runtime, Math.min(60, runtime.timeout))
    modelValues = extractModelValues(JSON.parse(result.raw))
  } catch (error) {
    const message = error instanceof Error ? error.message : "模型同步失败"
    await updateGatewayHealth(providerId, "unhealthy", message, Date.now() - startedAt, adminUserId)
    throw new Error(message)
  }

  const now = new Date().toISOString()
  const syncedCandidates = modelValues
    .flatMap<AiGatewayModel>(item => {
      const id = normalizeModelId(item.id ?? item.model ?? item.model_name ?? item.name)
      if (!id) return []
      const endpointTypes = modelEndpointTypes(item)
      return [{
        id,
        displayName: String(item.display_name ?? item.displayName ?? item.model_name ?? id).trim().slice(0, 200) || id,
        family: inferAiGatewayModelFamily(id),
        endpointTypes,
        enabled: true,
        source: "synced" as const,
        status: "available" as const,
        lastSeenAt: now,
        updatedAt: now,
      }]
    })
    .filter(model => {
      if (/embedding|rerank|moderation|tts|whisper|image|realtime|transcribe|sora/i.test(model.id)) return false
      return model.endpointTypes.length === 0
        || model.endpointTypes.some(type => /chat|completion|generatecontent|messages/i.test(type))
    })
  const synced = [...new Map(syncedCandidates.map(model => [model.id, model])).values()]

  if (synced.length === 0) {
    const message = "连接成功，但没有发现可用于文本生成的模型；可手动填写模型名"
    return updateGatewayHealth(providerId, "healthy", message, Date.now() - startedAt, adminUserId)
  }
  return updateGatewayModels(providerId, synced, "", Date.now() - startedAt, adminUserId)
}

async function updateGatewayModels(
  providerId: string,
  synced: AiGatewayModel[],
  emptyMessage: string,
  latencyMs: number,
  adminUserId: string,
): Promise<AiGatewayProviderPublic> {
  return mutateProviders(providers => {
    const index = providers.findIndex(provider => provider.id === providerId)
    if (index < 0) throw new Error("模型渠道不存在或已经移除")
    const provider = providers[index]
    const now = new Date().toISOString()
    const prior = new Map(provider.models.map(model => [model.id, model]))
    const incomingIds = new Set(synced.map(model => model.id))
    const manual = provider.models
      .filter(model => model.source === "manual")
      .map(model => ({ ...model, status: "available" as const }))
    const removed = provider.models
      .filter(model => model.source === "synced" && !incomingIds.has(model.id))
      .map(model => ({ ...model, enabled: false, status: "removed" as const, updatedAt: now }))
    const available = synced.map(model => ({
      ...model,
      enabled: prior.get(model.id)?.enabled ?? true,
      status: "available" as const,
      discoveredAt: prior.get(model.id)?.discoveredAt || now,
      lastSeenAt: now,
    }))
    const added = available.filter(model => !prior.has(model.id)).length
    provider.models = [...available, ...manual, ...removed]
      .sort((a, b) => Number(a.status === "removed") - Number(b.status === "removed")
        || a.family.localeCompare(b.family)
        || a.id.localeCompare(b.id))
    const summary: AiGatewaySyncSummary = {
      added,
      removed: removed.length,
      available: available.length + manual.length,
      syncedAt: now,
    }
    provider.lastSyncSummary = summary
    provider.healthStatus = "healthy"
    provider.healthMessage = emptyMessage
      || `已同步 ${summary.available} 个模型${added ? `，新增 ${added} 个` : ""}${removed.length ? `，下架 ${removed.length} 个` : ""}`
    provider.lastCheckedAt = now
    provider.lastLatencyMs = Math.max(0, Math.round(latencyMs))
    provider.updatedAt = now
    provider.updatedBy = adminUserId
    if (!provider.primaryModel) {
      provider.primaryModel = available.find(model => model.id === getAiGatewayPreset(provider.preset).defaultModel)?.id
        || available[0]?.id
        || manual[0]?.id
    }
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
    if (!provider) throw new Error("模型渠道不存在或已经移除")
    provider.healthStatus = status
    provider.healthMessage = sanitizeAiUpstreamMessage(message)
    provider.lastCheckedAt = new Date().toISOString()
    provider.lastLatencyMs = Math.max(0, Math.round(latencyMs))
    provider.updatedAt = provider.lastCheckedAt
    provider.updatedBy = adminUserId
    return toPublic(provider)
  })
}

export async function syncAllAiGatewayModels(adminUserId: string): Promise<{
  success: number
  failed: number
  errors: Array<{ id: string; name: string; message: string }>
}> {
  const providers = (await listAiGatewayProvidersPublic()).filter(item => item.enabled && item.hasApiKey)
  const errors: Array<{ id: string; name: string; message: string }> = []
  const results = await Promise.allSettled(
    providers.map(provider => syncAiGatewayModels(provider.id, adminUserId)),
  )
  results.forEach((result, index) => {
    if (result.status === "fulfilled") return
    const provider = providers[index]
    errors.push({
      id: provider.id,
      name: provider.name,
      message: result.reason instanceof Error ? result.reason.message : "同步失败",
    })
  })
  const success = providers.length - errors.length
  return { success, failed: errors.length, errors }
}

export async function setAiGatewayEnabled(
  providerId: string,
  enabled: boolean,
  adminUserId: string,
): Promise<AiGatewayProviderPublic> {
  return mutateProviders(providers => {
    const provider = providers.find(item => item.id === providerId)
    if (!provider) throw new Error("模型渠道不存在或已经移除")
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
    if (!provider) throw new Error("模型渠道不存在或已经移除")
    const model = provider.models.find(item => item.id === modelId)
    if (!model) throw new Error("模型不存在，请重新同步模型列表")
    if (model.status === "removed" && enabled) throw new Error("该模型已从渠道下架，不能重新启用")
    model.enabled = enabled
    model.updatedAt = new Date().toISOString()
    provider.updatedAt = model.updatedAt
    provider.updatedBy = adminUserId
    return toPublic(provider)
  })
}

export async function setAiGatewayPrimaryModel(
  providerId: string,
  modelId: string,
  adminUserId: string,
): Promise<AiGatewayProviderPublic> {
  return mutateProviders(providers => {
    const provider = providers.find(item => item.id === providerId)
    if (!provider) throw new Error("模型渠道不存在或已经移除")
    const model = provider.models.find(item => item.id === modelId)
    if (!model || model.status === "removed" || !model.enabled) {
      throw new Error("主模型必须是当前已启用的可用模型")
    }
    provider.primaryModel = model.id
    provider.updatedAt = new Date().toISOString()
    provider.updatedBy = adminUserId
    return toPublic(provider)
  })
}

export async function deleteAiGatewayProvider(providerId: string): Promise<void> {
  await mutateProviders(providers => {
    const index = providers.findIndex(item => item.id === providerId)
    if (index < 0) throw new Error("模型渠道不存在或已经移除")
    providers.splice(index, 1)
  })
}

export function aiGatewayAuthHeaders(
  authType: AiGatewayAuthType,
  apiKey: string,
): Record<string, string> {
  if (authType === "query-key") return {}
  return authType === "x-api-key"
    ? { "x-api-key": apiKey }
    : { Authorization: `Bearer ${apiKey}` }
}
