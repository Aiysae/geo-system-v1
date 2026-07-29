import "server-only"

import { createHash, randomUUID } from "crypto"
import { Pool } from "pg"
import { cleanAiPath, validateAiBaseUrl } from "@/lib/ai-settings"
import { decryptAiSecret, encryptAiSecret, maskAiSecret } from "@/lib/ai-secrets"
import { kv } from "@/lib/kv"
import type {
  AiCredentialCapability,
  AiCredentialHealthStatus,
  AiCredentialModule,
  AiCredentialPublic,
  AiCredentialRuntime,
  AiCredentialVendor,
} from "@/types/ai-credentials"

interface StoredAiCredential extends AiCredentialPublic {
  encryptedApiKey?: string
  keyFingerprint?: string
  updatedBy: string
}

type CredentialStoreGlobal = typeof globalThis & {
  __geoAiCredentialPool?: Pool
  __geoAiCredentialSchemaPromise?: Promise<unknown>
}

const globalState = globalThis as CredentialStoreGlobal
const KV_KEY = "system:ai-credentials:v1"
const CREDENTIAL_ID_PATTERN = /^cred_[a-f0-9]{24}$/
const VALID_VENDORS = new Set<AiCredentialVendor>([
  "doubao",
  "qwen",
  "hunyuan",
  "deepseek",
  "kimi",
  "ernie",
  "minimax",
  "zhipu",
])
const VALID_MODULES = new Set<AiCredentialModule>([
  "article",
  "question",
  "keywordStrategy",
  "research",
  "diagnosis",
  "difficulty",
  "penetration",
  "judge",
])
const VALID_CAPABILITIES = new Set<AiCredentialCapability>([
  "chat",
  "json",
  "long_text",
  "vision",
  "native_web",
  "auditable_sources",
])
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS geo_ai_credentials_v1 (
  id TEXT PRIMARY KEY,
  vendor TEXT NOT NULL,
  name TEXT NOT NULL,
  account_label TEXT NOT NULL,
  quota_group TEXT NOT NULL,
  base_url TEXT NOT NULL,
  chat_path TEXT NOT NULL,
  encrypted_api_key TEXT,
  key_fingerprint TEXT,
  api_key_preview TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  priority INTEGER NOT NULL DEFAULT 100,
  weight INTEGER NOT NULL DEFAULT 100,
  max_concurrency INTEGER NOT NULL DEFAULT 1,
  quota_group_max_concurrency INTEGER NOT NULL DEFAULT 1,
  rpm_limit INTEGER,
  tpm_limit INTEGER,
  daily_budget_cents INTEGER,
  allowed_models JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_modules JSONB NOT NULL DEFAULT '[]'::jsonb,
  declared_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  verified_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  verified_web_models JSONB NOT NULL DEFAULT '[]'::jsonb,
  health_status TEXT NOT NULL DEFAULT 'unchecked',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  cooldown_until TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  last_latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL
);
ALTER TABLE geo_ai_credentials_v1
  ADD COLUMN IF NOT EXISTS verified_web_models JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS geo_ai_credentials_v1_vendor_key_idx
  ON geo_ai_credentials_v1 (vendor, key_fingerprint)
  WHERE key_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS geo_ai_credentials_v1_route_idx
  ON geo_ai_credentials_v1 (vendor, enabled, priority, health_status);
`

let kvMutationQueue: Promise<void> = Promise.resolve()

function databasePool(): Pool | null {
  const connectionString = String(process.env.DATABASE_URL || "").trim()
  if (!connectionString) return null
  if (!globalState.__geoAiCredentialPool) {
    globalState.__geoAiCredentialPool = new Pool({
      connectionString,
      max: Math.max(1, Math.min(5, Number(process.env.AI_CREDENTIAL_DB_POOL_MAX) || 2)),
      ssl: /^(1|true|yes|on)$/i.test(String(process.env.DATABASE_SSL || ""))
        ? { rejectUnauthorized: false }
        : undefined,
    })
  }
  return globalState.__geoAiCredentialPool
}

async function ensureSchema(db: Pool): Promise<void> {
  if (!globalState.__geoAiCredentialSchemaPromise) {
    globalState.__geoAiCredentialSchemaPromise = db.query(SCHEMA_SQL)
  }
  await globalState.__geoAiCredentialSchemaPromise
}

function cleanText(value: unknown, max: number, fallback = ""): string {
  const text = String(value || "").trim().slice(0, max)
  return text || fallback
}

function cleanSlug(value: unknown, fallback: string): string {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
  return slug || fallback
}

function clampInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const parsed = Math.round(Number(value))
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback
}

function optionalInteger(value: unknown, maximum: number): number | undefined {
  if (value === "" || value === null || value === undefined) return undefined
  const parsed = Math.round(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(maximum, parsed) : undefined
}

function uniqueStrings(value: unknown, maximumItems = 100): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(item => String(item || "").trim()).filter(Boolean))]
    .slice(0, maximumItems)
}

function normalizeModules(value: unknown): AiCredentialModule[] {
  return uniqueStrings(value).filter(
    (item): item is AiCredentialModule => VALID_MODULES.has(item as AiCredentialModule),
  )
}

function normalizeCapabilities(value: unknown): AiCredentialCapability[] {
  return uniqueStrings(value).filter(
    (item): item is AiCredentialCapability =>
      VALID_CAPABILITIES.has(item as AiCredentialCapability),
  )
}

function normalizeVendor(value: unknown): AiCredentialVendor {
  const vendor = String(value || "").trim() as AiCredentialVendor
  if (!VALID_VENDORS.has(vendor)) throw new Error("模型供应商无效")
  return vendor
}

function normalizeHealth(value: unknown): AiCredentialHealthStatus {
  return ["unchecked", "healthy", "degraded", "unhealthy"].includes(String(value))
    ? value as AiCredentialHealthStatus
    : "unchecked"
}

function fingerprintSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function parseDate(value: unknown): string | undefined {
  if (!value) return undefined
  const parsed = new Date(String(value))
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined
}

function normalizeStored(value: unknown): StoredAiCredential | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const row = value as Partial<StoredAiCredential> & Record<string, unknown>
  if (!CREDENTIAL_ID_PATTERN.test(String(row.id || ""))) return null
  let vendor: AiCredentialVendor
  try {
    vendor = normalizeVendor(row.vendor)
  } catch {
    return null
  }
  const createdAt = parseDate(row.createdAt ?? row.created_at) || new Date().toISOString()
  const updatedAt = parseDate(row.updatedAt ?? row.updated_at) || createdAt
  const allowedModels = uniqueStrings(row.allowedModels ?? row.allowed_models, 500)
  const verifiedCapabilities = normalizeCapabilities(
    row.verifiedCapabilities ?? row.verified_capabilities,
  )
  const rawVerifiedWebModels = row.verifiedWebModels ?? row.verified_web_models
  const verifiedWebModels = rawVerifiedWebModels === undefined
    && verifiedCapabilities.includes("native_web")
    && verifiedCapabilities.includes("auditable_sources")
    ? allowedModels.slice(0, 1)
    : uniqueStrings(rawVerifiedWebModels, 500)
        .filter(model => allowedModels.includes(model))
  return {
    id: String(row.id),
    vendor,
    name: cleanText(row.name, 80, `${vendor} API`),
    accountLabel: cleanText(row.accountLabel ?? row.account_label, 80, "未命名账号"),
    quotaGroup: cleanSlug(row.quotaGroup ?? row.quota_group, `${vendor}-default`),
    baseUrl: cleanText(row.baseUrl ?? row.base_url, 500),
    chatPath: cleanAiPath(cleanText(row.chatPath ?? row.chat_path, 240, "/v1/chat/completions")),
    encryptedApiKey: cleanText(row.encryptedApiKey ?? row.encrypted_api_key, 4096) || undefined,
    keyFingerprint: cleanText(row.keyFingerprint ?? row.key_fingerprint, 128) || undefined,
    apiKeyPreview: cleanText(row.apiKeyPreview ?? row.api_key_preview, 40),
    enabled: row.enabled === true,
    priority: clampInteger(row.priority, 1, 999, 100),
    weight: clampInteger(row.weight, 1, 1000, 100),
    maxConcurrency: clampInteger(row.maxConcurrency ?? row.max_concurrency, 1, 50, 1),
    quotaGroupMaxConcurrency: clampInteger(
      row.quotaGroupMaxConcurrency ?? row.quota_group_max_concurrency,
      1,
      100,
      1,
    ),
    rpmLimit: optionalInteger(row.rpmLimit ?? row.rpm_limit, 1_000_000),
    tpmLimit: optionalInteger(row.tpmLimit ?? row.tpm_limit, 100_000_000),
    dailyBudgetCents: optionalInteger(
      row.dailyBudgetCents ?? row.daily_budget_cents,
      1_000_000_000,
    ),
    allowedModels,
    allowedModules: normalizeModules(row.allowedModules ?? row.allowed_modules),
    declaredCapabilities: normalizeCapabilities(
      row.declaredCapabilities ?? row.declared_capabilities,
    ),
    verifiedCapabilities,
    verifiedWebModels,
    healthStatus: normalizeHealth(row.healthStatus ?? row.health_status),
    consecutiveFailures: clampInteger(
      row.consecutiveFailures ?? row.consecutive_failures,
      0,
      1_000_000,
      0,
    ),
    cooldownUntil: parseDate(row.cooldownUntil ?? row.cooldown_until),
    lastCheckedAt: parseDate(row.lastCheckedAt ?? row.last_checked_at),
    lastLatencyMs: optionalInteger(row.lastLatencyMs ?? row.last_latency_ms, 24 * 60 * 60 * 1000),
    createdAt,
    updatedAt,
    updatedBy: cleanText(row.updatedBy ?? row.updated_by, 160, "system"),
  }
}

function toPublic(stored: StoredAiCredential): AiCredentialPublic {
  const publicValue = { ...stored } as Partial<StoredAiCredential>
  delete publicValue.encryptedApiKey
  delete publicValue.keyFingerprint
  delete publicValue.updatedBy
  return publicValue as AiCredentialPublic
}

function toRuntime(stored: StoredAiCredential): AiCredentialRuntime {
  return {
    ...toPublic(stored),
    apiKey: stored.encryptedApiKey ? decryptAiSecret(stored.encryptedApiKey) : "",
  }
}

async function listStored(): Promise<StoredAiCredential[]> {
  const db = databasePool()
  if (db) {
    await ensureSchema(db)
    const result = await db.query(
      `SELECT * FROM geo_ai_credentials_v1
       ORDER BY priority ASC, vendor ASC, account_label ASC, created_at ASC`,
    )
    return result.rows
      .map(normalizeStored)
      .filter((item): item is StoredAiCredential => Boolean(item))
  }
  const values = await kv.get<unknown[]>(KV_KEY)
  return (Array.isArray(values) ? values : [])
    .map(normalizeStored)
    .filter((item): item is StoredAiCredential => Boolean(item))
    .sort((a, b) =>
      a.priority - b.priority
      || a.vendor.localeCompare(b.vendor)
      || a.accountLabel.localeCompare(b.accountLabel, "zh-CN"))
}

async function writeKv(
  mutate: (values: StoredAiCredential[]) => StoredAiCredential[] | Promise<StoredAiCredential[]>,
): Promise<void> {
  const previous = kvMutationQueue
  let release: () => void = () => undefined
  kvMutationQueue = new Promise(resolve => {
    release = resolve
  })
  await previous.catch(() => undefined)
  try {
    const current = await listStored()
    await kv.set(KV_KEY, await mutate(current))
  } finally {
    release()
  }
}

export interface SaveAiCredentialInput {
  id?: string
  vendor: AiCredentialVendor
  name: string
  accountLabel: string
  quotaGroup?: string
  baseUrl: string
  chatPath?: string
  apiKey?: string
  clearApiKey?: boolean
  enabled?: boolean
  priority?: number
  weight?: number
  maxConcurrency?: number
  quotaGroupMaxConcurrency?: number
  rpmLimit?: number
  tpmLimit?: number
  dailyBudgetCents?: number
  allowedModels?: string[]
  allowedModules?: AiCredentialModule[]
  declaredCapabilities?: AiCredentialCapability[]
}

export async function listAiCredentialsPublic(): Promise<AiCredentialPublic[]> {
  return (await listStored()).map(toPublic)
}

export async function listAiCredentialRuntimes(
  vendor?: AiCredentialVendor,
): Promise<AiCredentialRuntime[]> {
  return (await listStored())
    .filter(item => !vendor || item.vendor === vendor)
    .map(toRuntime)
}

export async function getAiCredentialRuntime(id: string): Promise<AiCredentialRuntime> {
  if (!CREDENTIAL_ID_PATTERN.test(id)) throw new Error("模型账号编号无效")
  const stored = (await listStored()).find(item => item.id === id)
  if (!stored) throw new Error("模型账号不存在或已经移除")
  return toRuntime(stored)
}

export async function prioritizeAiCredentialModel(
  id: string,
  model: string,
  updatedBy = "credential-verification",
): Promise<AiCredentialPublic> {
  if (!CREDENTIAL_ID_PATTERN.test(id)) throw new Error("模型账号编号无效")
  const normalizedModel = String(model || "").trim()
  if (!normalizedModel) throw new Error("模型名称不能为空")

  const current = await listStored()
  const previous = current.find(item => item.id === id)
  if (!previous) throw new Error("模型账号不存在或已经移除")
  if (!previous.allowedModels.includes(normalizedModel)) {
    throw new Error("该模型不在账号允许列表中")
  }
  if (previous.allowedModels[0] === normalizedModel) return toPublic(previous)

  const now = new Date().toISOString()
  const next: StoredAiCredential = {
    ...previous,
    allowedModels: [
      normalizedModel,
      ...previous.allowedModels.filter(item => item !== normalizedModel),
    ],
    updatedAt: now,
    updatedBy: cleanText(updatedBy, 160, "credential-verification"),
  }
  const db = databasePool()
  if (db) {
    await ensureSchema(db)
    await db.query(
      `UPDATE geo_ai_credentials_v1
       SET allowed_models = $2::jsonb, updated_at = $3, updated_by = $4
       WHERE id = $1`,
      [
        next.id,
        JSON.stringify(next.allowedModels),
        next.updatedAt,
        next.updatedBy,
      ],
    )
  } else {
    await writeKv(values => values.map(item => item.id === id ? next : item))
  }
  return toPublic(next)
}

export async function closeAiCredentialStoreConnection(): Promise<void> {
  const pool = globalState.__geoAiCredentialPool
  globalState.__geoAiCredentialPool = undefined
  if (pool) await pool.end()
}

export async function saveAiCredential(
  input: SaveAiCredentialInput,
  adminUserId: string,
): Promise<AiCredentialPublic> {
  const vendor = normalizeVendor(input.vendor)
  const current = await listStored()
  const previous = input.id
    ? current.find(item => item.id === input.id)
    : undefined
  if (input.id && !previous) throw new Error("模型账号不存在或已经移除")

  const rawKey = String(input.apiKey || "").trim()
  const encryptedApiKey = input.clearApiKey
    ? undefined
    : rawKey
      ? encryptAiSecret(rawKey)
      : previous?.encryptedApiKey
  if (!encryptedApiKey && input.enabled === true) {
    throw new Error("启用模型账号前必须填写 API Key")
  }
  const keyFingerprint = input.clearApiKey
    ? undefined
    : rawKey
      ? fingerprintSecret(rawKey)
      : previous?.keyFingerprint
  if (
    keyFingerprint
    && current.some(item =>
      item.id !== previous?.id
      && item.vendor === vendor
      && item.keyFingerprint === keyFingerprint)
  ) {
    throw new Error("该 API Key 已经存在，无需重复添加")
  }

  const now = new Date().toISOString()
  const id = previous?.id || `cred_${randomUUID().replace(/-/g, "").slice(0, 24)}`
  const accountLabel = cleanText(input.accountLabel, 80, "未命名账号")
  const baseUrl = validateAiBaseUrl(input.baseUrl)
  const chatPath = cleanAiPath(input.chatPath || "/v1/chat/completions")
  const allowedModels = uniqueStrings(input.allowedModels ?? previous?.allowedModels, 500)
  const allowedModules = normalizeModules(input.allowedModules ?? previous?.allowedModules)
  const declaredCapabilities = normalizeCapabilities(
    input.declaredCapabilities ?? previous?.declaredCapabilities,
  )
  const apiKeyChanged = previous
    ? input.clearApiKey === true
      ? Boolean(previous.keyFingerprint)
      : Boolean(rawKey && keyFingerprint !== previous.keyFingerprint)
    : true
  const endpointChanged = Boolean(previous && (
    previous.vendor !== vendor
    || previous.baseUrl !== baseUrl
    || previous.chatPath !== chatPath
  ))
  const verificationIdentityChanged = apiKeyChanged || endpointChanged
  const declaresStrictWeb = declaredCapabilities.includes("native_web")
    && declaredCapabilities.includes("auditable_sources")
  const verifiedWebModels = verificationIdentityChanged || !declaresStrictWeb
    ? []
    : (previous?.verifiedWebModels || []).filter(model => allowedModels.includes(model))
  const retainedCapabilities = verificationIdentityChanged
    ? []
    : [...(previous?.verifiedCapabilities || [])]
  const verifiedCapabilities = verifiedWebModels.length > 0
    ? [...new Set([...retainedCapabilities, "native_web", "auditable_sources"])]
    : retainedCapabilities.filter(
        capability => capability !== "native_web" && capability !== "auditable_sources",
      )
  const stored: StoredAiCredential = {
    id,
    vendor,
    name: cleanText(input.name, 80, `${vendor} · ${accountLabel}`),
    accountLabel,
    quotaGroup: cleanSlug(input.quotaGroup, `${vendor}-${accountLabel}`),
    baseUrl,
    chatPath,
    encryptedApiKey,
    keyFingerprint,
    apiKeyPreview: input.clearApiKey
      ? ""
      : rawKey
        ? maskAiSecret(rawKey)
        : previous?.apiKeyPreview || "",
    enabled: input.enabled === true,
    priority: clampInteger(input.priority, 1, 999, previous?.priority || 100),
    weight: clampInteger(input.weight, 1, 1000, previous?.weight || 100),
    maxConcurrency: clampInteger(
      input.maxConcurrency,
      1,
      50,
      previous?.maxConcurrency || 1,
    ),
    quotaGroupMaxConcurrency: clampInteger(
      input.quotaGroupMaxConcurrency,
      1,
      100,
      previous?.quotaGroupMaxConcurrency || input.maxConcurrency || 1,
    ),
    rpmLimit: optionalInteger(input.rpmLimit, 1_000_000) ?? previous?.rpmLimit,
    tpmLimit: optionalInteger(input.tpmLimit, 100_000_000) ?? previous?.tpmLimit,
    dailyBudgetCents: optionalInteger(input.dailyBudgetCents, 1_000_000_000)
      ?? previous?.dailyBudgetCents,
    allowedModels,
    allowedModules,
    declaredCapabilities,
    verifiedCapabilities: verifiedCapabilities as AiCredentialCapability[],
    verifiedWebModels,
    healthStatus: verificationIdentityChanged ? "unchecked" : previous?.healthStatus || "unchecked",
    consecutiveFailures: verificationIdentityChanged ? 0 : previous?.consecutiveFailures || 0,
    cooldownUntil: verificationIdentityChanged ? undefined : previous?.cooldownUntil,
    lastCheckedAt: verificationIdentityChanged ? undefined : previous?.lastCheckedAt,
    lastLatencyMs: verificationIdentityChanged ? undefined : previous?.lastLatencyMs,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    updatedBy: cleanText(adminUserId, 160, "system"),
  }

  const db = databasePool()
  if (db) {
    await ensureSchema(db)
    await db.query(
      `INSERT INTO geo_ai_credentials_v1 (
        id, vendor, name, account_label, quota_group, base_url, chat_path,
        encrypted_api_key, key_fingerprint, api_key_preview, enabled, priority,
        weight, max_concurrency, quota_group_max_concurrency, rpm_limit,
        tpm_limit, daily_budget_cents, allowed_models, allowed_modules,
        declared_capabilities, verified_capabilities, verified_web_models, health_status,
        consecutive_failures, cooldown_until, last_checked_at, last_latency_ms,
        created_at, updated_at, updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19::jsonb, $20::jsonb, $21::jsonb, $22::jsonb,
        $23::jsonb, $24, $25, $26, $27, $28, $29, $30, $31
      )
      ON CONFLICT (id) DO UPDATE SET
        vendor = EXCLUDED.vendor,
        name = EXCLUDED.name,
        account_label = EXCLUDED.account_label,
        quota_group = EXCLUDED.quota_group,
        base_url = EXCLUDED.base_url,
        chat_path = EXCLUDED.chat_path,
        encrypted_api_key = EXCLUDED.encrypted_api_key,
        key_fingerprint = EXCLUDED.key_fingerprint,
        api_key_preview = EXCLUDED.api_key_preview,
        enabled = EXCLUDED.enabled,
        priority = EXCLUDED.priority,
        weight = EXCLUDED.weight,
        max_concurrency = EXCLUDED.max_concurrency,
        quota_group_max_concurrency = EXCLUDED.quota_group_max_concurrency,
        rpm_limit = EXCLUDED.rpm_limit,
        tpm_limit = EXCLUDED.tpm_limit,
        daily_budget_cents = EXCLUDED.daily_budget_cents,
        allowed_models = EXCLUDED.allowed_models,
        allowed_modules = EXCLUDED.allowed_modules,
        declared_capabilities = EXCLUDED.declared_capabilities,
        verified_capabilities = EXCLUDED.verified_capabilities,
        verified_web_models = EXCLUDED.verified_web_models,
        health_status = EXCLUDED.health_status,
        consecutive_failures = EXCLUDED.consecutive_failures,
        cooldown_until = EXCLUDED.cooldown_until,
        last_checked_at = EXCLUDED.last_checked_at,
        last_latency_ms = EXCLUDED.last_latency_ms,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by`,
      [
        stored.id,
        stored.vendor,
        stored.name,
        stored.accountLabel,
        stored.quotaGroup,
        stored.baseUrl,
        stored.chatPath,
        stored.encryptedApiKey || null,
        stored.keyFingerprint || null,
        stored.apiKeyPreview,
        stored.enabled,
        stored.priority,
        stored.weight,
        stored.maxConcurrency,
        stored.quotaGroupMaxConcurrency,
        stored.rpmLimit || null,
        stored.tpmLimit || null,
        stored.dailyBudgetCents || null,
        JSON.stringify(stored.allowedModels),
        JSON.stringify(stored.allowedModules),
        JSON.stringify(stored.declaredCapabilities),
        JSON.stringify(stored.verifiedCapabilities),
        JSON.stringify(stored.verifiedWebModels),
        stored.healthStatus,
        stored.consecutiveFailures,
        stored.cooldownUntil || null,
        stored.lastCheckedAt || null,
        stored.lastLatencyMs || null,
        stored.createdAt,
        stored.updatedAt,
        stored.updatedBy,
      ],
    )
  } else {
    await writeKv(values => [
      ...values.filter(item => item.id !== stored.id),
      stored,
    ])
  }
  return toPublic(stored)
}

export async function updateAiCredentialHealth(
  id: string,
  input: {
    status: AiCredentialHealthStatus
    verifiedCapabilities?: AiCredentialCapability[]
    verifiedWebModels?: string[]
    latencyMs?: number
    consecutiveFailures?: number
    cooldownUntil?: string
  },
): Promise<AiCredentialPublic> {
  const current = await listStored()
  const previous = current.find(item => item.id === id)
  if (!previous) throw new Error("模型账号不存在或已经移除")
  const verifiedWebModels = input.verifiedWebModels === undefined
    ? previous.verifiedWebModels
    : uniqueStrings(input.verifiedWebModels, 500)
        .filter(model => previous.allowedModels.includes(model))
  const inputCapabilities = input.verifiedCapabilities === undefined
    ? previous.verifiedCapabilities
    : normalizeCapabilities(input.verifiedCapabilities)
  const verifiedCapabilities = input.verifiedWebModels === undefined
    ? inputCapabilities
    : verifiedWebModels.length > 0
      ? [...new Set([...inputCapabilities, "native_web", "auditable_sources"])]
      : inputCapabilities.filter(
          capability => capability !== "native_web" && capability !== "auditable_sources",
        )
  const next: StoredAiCredential = {
    ...previous,
    healthStatus: normalizeHealth(input.status),
    verifiedCapabilities: verifiedCapabilities as AiCredentialCapability[],
    verifiedWebModels,
    lastCheckedAt: new Date().toISOString(),
    lastLatencyMs: optionalInteger(input.latencyMs, 24 * 60 * 60 * 1000),
    consecutiveFailures: clampInteger(
      input.consecutiveFailures,
      0,
      1_000_000,
      previous.consecutiveFailures,
    ),
    cooldownUntil: parseDate(input.cooldownUntil),
    updatedAt: new Date().toISOString(),
  }
  const db = databasePool()
  if (db) {
    await ensureSchema(db)
    await db.query(
      `UPDATE geo_ai_credentials_v1
       SET health_status = $2,
           verified_capabilities = $3::jsonb,
           verified_web_models = $4::jsonb,
           last_checked_at = $5,
           last_latency_ms = $6,
           consecutive_failures = $7,
           cooldown_until = $8,
           updated_at = $9
       WHERE id = $1`,
      [
        next.id,
        next.healthStatus,
        JSON.stringify(next.verifiedCapabilities),
        JSON.stringify(next.verifiedWebModels),
        next.lastCheckedAt,
        next.lastLatencyMs || null,
        next.consecutiveFailures,
        next.cooldownUntil || null,
        next.updatedAt,
      ],
    )
  } else {
    await writeKv(values => values.map(item => item.id === id ? next : item))
  }
  return toPublic(next)
}

export async function setAiCredentialEnabled(
  id: string,
  enabled: boolean,
  adminUserId: string,
): Promise<AiCredentialPublic> {
  const runtime = await getAiCredentialRuntime(id)
  if (enabled && !runtime.apiKey) throw new Error("该模型账号尚未配置 API Key")
  const db = databasePool()
  const now = new Date().toISOString()
  if (db) {
    await ensureSchema(db)
    await db.query(
      `UPDATE geo_ai_credentials_v1
       SET enabled = $2, updated_at = $3, updated_by = $4
       WHERE id = $1`,
      [id, enabled, now, cleanText(adminUserId, 160, "system")],
    )
  } else {
    await writeKv(values => values.map(item => item.id === id
      ? { ...item, enabled, updatedAt: now, updatedBy: cleanText(adminUserId, 160, "system") }
      : item))
  }
  const publicRuntime = { ...runtime } as Partial<AiCredentialRuntime>
  delete publicRuntime.apiKey
  return {
    ...publicRuntime as AiCredentialPublic,
    enabled,
    updatedAt: now,
  }
}

export async function deleteAiCredential(id: string): Promise<void> {
  if (!CREDENTIAL_ID_PATTERN.test(id)) throw new Error("模型账号编号无效")
  const db = databasePool()
  if (db) {
    await ensureSchema(db)
    await db.query("DELETE FROM geo_ai_credentials_v1 WHERE id = $1", [id])
    return
  }
  await writeKv(values => values.filter(item => item.id !== id))
}

export { SCHEMA_SQL as AI_CREDENTIAL_SCHEMA_SQL }
