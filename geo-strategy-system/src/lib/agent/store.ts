import "server-only"

import fs from "node:fs/promises"
import path from "node:path"
import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"
import { Pool } from "pg"
import { getUserById } from "@/lib/auth"
import { AGENT_SCHEMA_SQL } from "@/lib/agent/schema"
import { normalizeAgentScopes } from "@/lib/agent/scopes"
import type {
  AgentAuditRecord,
  AgentClientGrant,
  AgentClientMode,
  AgentScope,
  AgentTokenRecord,
  AgentTokenSecret,
} from "@/types/agent"

type StoredAgentToken = AgentTokenRecord & { tokenHash: string }

type FileAgentState = {
  tokens: Record<string, StoredAgentToken>
  audits: Record<string, AgentAuditRecord>
}

type AgentTokenRow = {
  id: string
  owner_user_id: string
  name: string
  token_hash: string
  token_prefix: string
  scopes: unknown
  client_mode: AgentClientMode
  client_grants: unknown
  status: AgentTokenRecord["status"]
  rate_limit_per_minute: number
  daily_credit_limit: number
  max_task_credits: number
  allowed_ips: unknown
  expires_at: string | Date | null
  last_used_at: string | Date | null
  revoked_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}

type AgentAuditRow = {
  id: string
  token_id: string
  owner_user_id: string
  action: string
  method: string
  path: string
  trace_id: string
  request_id: string | null
  client_id: string | null
  team_id: string | null
  status: AgentAuditRecord["status"]
  http_status: number
  estimated_credits: number
  metadata: unknown
  created_at: string | Date
}

const DEFAULT_FILE_PATH = process.env.NODE_ENV === "production"
  ? "/var/lib/geo-system/agents.json"
  : path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "agents.json")

const TOKEN_PATTERN = /^stgeo_(agt_[a-f0-9]{32})_([A-Za-z0-9_-]{32,120})$/
const MAX_AUDITS_IN_FILE = 5_000

const agentGlobal = globalThis as typeof globalThis & {
  __geoAgentPool?: Pool
  __geoAgentSchemaPromise?: Promise<void>
  __geoAgentFileQueue?: Promise<unknown>
  __geoAgentTokenTouches?: Map<string, number>
}

function backend(): "postgres" | "file" {
  const configured = String(process.env.AGENT_STORE || "").trim().toLowerCase()
  if (configured === "postgres" || configured === "file") return configured
  if (configured) throw new Error(`Unsupported AGENT_STORE: ${configured}`)
  return process.env.DATABASE_URL ? "postgres" : "file"
}

function pool(): Pool {
  if (agentGlobal.__geoAgentPool) return agentGlobal.__geoAgentPool
  const connectionString = String(process.env.DATABASE_URL || "").trim()
  if (!connectionString) throw new Error("DATABASE_URL is required when AGENT_STORE=postgres")
  agentGlobal.__geoAgentPool = new Pool({
    connectionString,
    max: Math.max(1, Math.min(6, Number(process.env.AGENT_DB_POOL_MAX) || 2)),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  })
  agentGlobal.__geoAgentPool.on("error", error => {
    console.error(`[agent-db] ${error.message}`)
  })
  return agentGlobal.__geoAgentPool
}

export async function ensureAgentSchema(): Promise<void> {
  if (backend() !== "postgres") return
  if (!agentGlobal.__geoAgentSchemaPromise) {
    agentGlobal.__geoAgentSchemaPromise = pool().query(AGENT_SCHEMA_SQL)
      .then(() => undefined)
      .catch(error => {
        agentGlobal.__geoAgentSchemaPromise = undefined
        throw error
      })
  }
  await agentGlobal.__geoAgentSchemaPromise
}

function asIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function optionalIso(value: string | Date | null | undefined): string | undefined {
  return value ? asIso(value) : undefined
}

function cleanName(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 100) || "我的 Agent"
}

function cleanId(value: unknown, max = 200): string {
  return String(value || "").trim().slice(0, max)
}

function cleanInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback
}

function normalizeClientGrants(value: unknown): AgentClientGrant[] {
  if (!Array.isArray(value)) return []
  const grants = value.flatMap(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const input = item as Record<string, unknown>
    const clientId = cleanId(input.clientId)
    const teamId = cleanId(input.teamId) || undefined
    return clientId ? [{ clientId, teamId }] : []
  })
  return Array.from(
    new Map(grants.map(grant => [`${grant.teamId || "personal"}:${grant.clientId}`, grant])).values(),
  ).slice(0, 500)
}

function normalizeAllowedIps(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value.map(item => String(item || "").trim()).filter(Boolean),
  )).map(item => item.slice(0, 80)).slice(0, 100)
}

function tokenPepper(): string {
  const pepper = process.env.AGENT_TOKEN_PEPPER
    || process.env.AUTH_SECRET
    || process.env.SESSION_SECRET
  if (pepper) return pepper
  if (process.env.NODE_ENV !== "production") return "dev-only-agent-token-pepper"
  throw new Error("AGENT_TOKEN_PEPPER or AUTH_SECRET is required")
}

function hashToken(value: string): string {
  return createHmac("sha256", tokenPepper()).update(value).digest("base64url")
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function publicRecord(record: StoredAgentToken): AgentTokenRecord {
  const result = { ...record }
  Reflect.deleteProperty(result, "tokenHash")
  return result
}

function rowToToken(row: AgentTokenRow): StoredAgentToken {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    tokenHash: row.token_hash,
    tokenPrefix: row.token_prefix,
    scopes: normalizeAgentScopes(row.scopes),
    clientMode: row.client_mode === "all" ? "all" : "selected",
    clientGrants: normalizeClientGrants(row.client_grants),
    status: row.status === "revoked" ? "revoked" : "active",
    rateLimitPerMinute: cleanInteger(row.rate_limit_per_minute, 60, 1, 600),
    dailyCreditLimit: cleanInteger(row.daily_credit_limit, 500, 0, 1_000_000),
    maxTaskCredits: cleanInteger(row.max_task_credits, 200, 0, 1_000_000),
    allowedIps: normalizeAllowedIps(row.allowed_ips),
    expiresAt: optionalIso(row.expires_at),
    lastUsedAt: optionalIso(row.last_used_at),
    revokedAt: optionalIso(row.revoked_at),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  }
}

function rowToAudit(row: AgentAuditRow): AgentAuditRecord {
  return {
    id: row.id,
    tokenId: row.token_id,
    ownerUserId: row.owner_user_id,
    action: row.action,
    method: row.method,
    path: row.path,
    traceId: row.trace_id,
    requestId: row.request_id || undefined,
    clientId: row.client_id || undefined,
    teamId: row.team_id || undefined,
    status: row.status,
    httpStatus: row.http_status,
    estimatedCredits: row.estimated_credits,
    metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : {},
    createdAt: asIso(row.created_at),
  }
}

function emptyFileState(): FileAgentState {
  return { tokens: {}, audits: {} }
}

async function readFileState(): Promise<FileAgentState> {
  const filePath = process.env.AGENT_FILE || DEFAULT_FILE_PATH
  try {
    const raw = await fs.readFile(filePath, "utf8")
    const parsed = JSON.parse(raw) as Partial<FileAgentState>
    return {
      tokens: parsed.tokens || {},
      audits: parsed.audits || {},
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFileState()
    throw error
  }
}

async function writeFileState(state: FileAgentState): Promise<void> {
  const filePath = process.env.AGENT_FILE || DEFAULT_FILE_PATH
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(state, null, 2), { mode: 0o600 })
  await fs.rename(tempPath, filePath)
}

async function withFileState<T>(
  operation: (state: FileAgentState) => T | Promise<T>,
  write = false,
): Promise<T> {
  const previous = agentGlobal.__geoAgentFileQueue || Promise.resolve()
  let release: () => void = () => undefined
  agentGlobal.__geoAgentFileQueue = new Promise<void>(resolve => {
    release = resolve
  })
  await previous
  try {
    const state = await readFileState()
    const result = await operation(state)
    if (write) await writeFileState(state)
    return result
  } finally {
    release()
  }
}

export async function createAgentToken(input: {
  ownerUserId: string
  name: string
  scopes: AgentScope[]
  clientMode: AgentClientMode
  clientGrants?: AgentClientGrant[]
  rateLimitPerMinute?: number
  dailyCreditLimit?: number
  maxTaskCredits?: number
  allowedIps?: string[]
  expiresAt?: string
}): Promise<AgentTokenSecret> {
  const ownerUserId = cleanId(input.ownerUserId, 160)
  if (!ownerUserId) throw new Error("Agent 所属账号无效")
  const owner = await getUserById(ownerUserId)
  if (!owner || owner.status !== "active") throw new Error("Agent 所属账号不存在或已停用")

  const scopes = normalizeAgentScopes(input.scopes)
  if (scopes.length === 0) throw new Error("请至少授予一个 Agent 权限")
  const clientMode: AgentClientMode = input.clientMode === "all" ? "all" : "selected"
  const clientGrants = normalizeClientGrants(input.clientGrants)
  if (clientMode === "selected" && clientGrants.length === 0) {
    throw new Error("请选择 Agent 可以访问的客户")
  }

  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) {
    throw new Error("Agent 密钥有效期必须晚于当前时间")
  }

  const now = new Date().toISOString()
  const id = `agt_${randomBytes(16).toString("hex")}`
  const secret = randomBytes(32).toString("base64url")
  const token = `stgeo_${id}_${secret}`
  const record: StoredAgentToken = {
    id,
    ownerUserId,
    name: cleanName(input.name),
    tokenHash: hashToken(token),
    tokenPrefix: `stgeo_${id.slice(0, 12)}...`,
    scopes,
    clientMode,
    clientGrants,
    status: "active",
    rateLimitPerMinute: cleanInteger(input.rateLimitPerMinute, 60, 1, 600),
    dailyCreditLimit: cleanInteger(input.dailyCreditLimit, 500, 0, 1_000_000),
    maxTaskCredits: cleanInteger(input.maxTaskCredits, 200, 0, 1_000_000),
    allowedIps: normalizeAllowedIps(input.allowedIps),
    expiresAt: expiresAt?.toISOString(),
    createdAt: now,
    updatedAt: now,
  }

  if (backend() === "postgres") {
    await ensureAgentSchema()
    await pool().query(
      `INSERT INTO geo_agent_tokens_v1 (
        id, owner_user_id, name, token_hash, token_prefix, scopes,
        client_mode, client_grants, status, rate_limit_per_minute,
        daily_credit_limit, max_task_credits, allowed_ips, expires_at,
        created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11,$12,$13::jsonb,$14,$15,$16)`,
      [
        record.id,
        record.ownerUserId,
        record.name,
        record.tokenHash,
        record.tokenPrefix,
        JSON.stringify(record.scopes),
        record.clientMode,
        JSON.stringify(record.clientGrants),
        record.status,
        record.rateLimitPerMinute,
        record.dailyCreditLimit,
        record.maxTaskCredits,
        JSON.stringify(record.allowedIps),
        record.expiresAt || null,
        record.createdAt,
        record.updatedAt,
      ],
    )
  } else {
    await withFileState(state => {
      state.tokens[record.id] = record
    }, true)
  }

  return { token, record: publicRecord(record) }
}

async function getStoredAgentToken(id: string): Promise<StoredAgentToken | null> {
  if (backend() === "postgres") {
    await ensureAgentSchema()
    const result = await pool().query<AgentTokenRow>(
      "SELECT * FROM geo_agent_tokens_v1 WHERE id = $1 LIMIT 1",
      [id],
    )
    return result.rows[0] ? rowToToken(result.rows[0]) : null
  }
  return withFileState(state => state.tokens[id] || null)
}

export async function listAgentTokens(ownerUserId: string): Promise<AgentTokenRecord[]> {
  const owner = cleanId(ownerUserId, 160)
  if (backend() === "postgres") {
    await ensureAgentSchema()
    const result = await pool().query<AgentTokenRow>(
      `SELECT * FROM geo_agent_tokens_v1
       WHERE owner_user_id = $1
       ORDER BY (status = 'active') DESC, created_at DESC
       LIMIT 200`,
      [owner],
    )
    return result.rows.map(row => publicRecord(rowToToken(row)))
  }
  return withFileState(state => Object.values(state.tokens)
    .filter(record => record.ownerUserId === owner)
    .sort((left, right) => (
      Number(right.status === "active") - Number(left.status === "active")
      || right.createdAt.localeCompare(left.createdAt)
    ))
    .slice(0, 200)
    .map(publicRecord))
}

export async function revokeAgentToken(input: {
  ownerUserId: string
  tokenId: string
}): Promise<AgentTokenRecord | null> {
  const now = new Date().toISOString()
  if (backend() === "postgres") {
    await ensureAgentSchema()
    const result = await pool().query<AgentTokenRow>(
      `UPDATE geo_agent_tokens_v1
       SET status = 'revoked', revoked_at = $3, updated_at = $3
       WHERE id = $1 AND owner_user_id = $2
       RETURNING *`,
      [cleanId(input.tokenId, 80), cleanId(input.ownerUserId, 160), now],
    )
    return result.rows[0] ? publicRecord(rowToToken(result.rows[0])) : null
  }
  return withFileState(state => {
    const current = state.tokens[input.tokenId]
    if (!current || current.ownerUserId !== input.ownerUserId) return null
    const next: StoredAgentToken = {
      ...current,
      status: "revoked",
      revokedAt: now,
      updatedAt: now,
    }
    state.tokens[input.tokenId] = next
    return publicRecord(next)
  }, true)
}

async function touchAgentToken(record: StoredAgentToken): Promise<void> {
  const touches = agentGlobal.__geoAgentTokenTouches || new Map<string, number>()
  agentGlobal.__geoAgentTokenTouches = touches
  const previous = touches.get(record.id) || 0
  if (Date.now() - previous < 60_000) return
  touches.set(record.id, Date.now())
  const now = new Date().toISOString()

  if (backend() === "postgres") {
    await pool().query(
      "UPDATE geo_agent_tokens_v1 SET last_used_at = $2, updated_at = $2 WHERE id = $1",
      [record.id, now],
    )
    return
  }
  await withFileState(state => {
    const current = state.tokens[record.id]
    if (current) state.tokens[record.id] = { ...current, lastUsedAt: now, updatedAt: now }
  }, true)
}

export async function authenticateAgentToken(rawToken: string): Promise<AgentTokenRecord | null> {
  const token = String(rawToken || "").trim()
  const match = token.match(TOKEN_PATTERN)
  if (!match) return null
  const record = await getStoredAgentToken(match[1])
  if (!record || record.status !== "active") return null
  if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) return null
  if (!safeEqual(record.tokenHash, hashToken(token))) return null
  const owner = await getUserById(record.ownerUserId)
  if (!owner || owner.status !== "active") return null
  void touchAgentToken(record).catch(error => {
    console.warn("[agent-auth] token touch failed", error instanceof Error ? error.message : error)
  })
  return publicRecord(record)
}

export function agentTokenAllowsClient(
  token: AgentTokenRecord,
  clientId: string,
  teamId?: string,
): boolean {
  if (token.clientMode === "all") return true
  return token.clientGrants.some(grant => (
    grant.clientId === clientId
    && (grant.teamId || undefined) === (teamId || undefined)
  ))
}

function scrubMetadata(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[truncated]"
  if (value === null || typeof value === "boolean" || typeof value === "number") return value
  if (typeof value === "string") return value.slice(0, 500)
  if (Array.isArray(value)) return value.slice(0, 30).map(item => scrubMetadata(item, depth + 1))
  if (!value || typeof value !== "object") return String(value || "").slice(0, 500)

  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
    if (/(token|secret|password|cookie|authorization|api.?key)/i.test(key)) {
      result[key] = "[redacted]"
    } else {
      result[key] = scrubMetadata(item, depth + 1)
    }
  }
  return result
}

export async function appendAgentAudit(
  input: Omit<AgentAuditRecord, "id" | "createdAt" | "metadata"> & {
    metadata?: Record<string, unknown>
  },
): Promise<AgentAuditRecord> {
  const record: AgentAuditRecord = {
    ...input,
    id: `agaudit_${randomUUID().replace(/-/g, "")}`,
    metadata: scrubMetadata(input.metadata || {}) as Record<string, unknown>,
    createdAt: new Date().toISOString(),
  }
  if (backend() === "postgres") {
    await ensureAgentSchema()
    await pool().query(
      `INSERT INTO geo_agent_audit_v1 (
        id, token_id, owner_user_id, action, method, path, trace_id,
        request_id, client_id, team_id, status, http_status,
        estimated_credits, metadata, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)`,
      [
        record.id,
        record.tokenId,
        record.ownerUserId,
        record.action,
        record.method,
        record.path,
        record.traceId,
        record.requestId || null,
        record.clientId || null,
        record.teamId || null,
        record.status,
        record.httpStatus,
        record.estimatedCredits,
        JSON.stringify(record.metadata),
        record.createdAt,
      ],
    )
  } else {
    await withFileState(state => {
      state.audits[record.id] = record
      const ordered = Object.values(state.audits)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      for (const stale of ordered.slice(MAX_AUDITS_IN_FILE)) delete state.audits[stale.id]
    }, true)
  }
  return record
}

export async function listAgentAudits(
  ownerUserId: string,
  limit = 100,
): Promise<AgentAuditRecord[]> {
  const safeLimit = cleanInteger(limit, 100, 1, 500)
  if (backend() === "postgres") {
    await ensureAgentSchema()
    const result = await pool().query<AgentAuditRow>(
      `SELECT * FROM geo_agent_audit_v1
       WHERE owner_user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [cleanId(ownerUserId, 160), safeLimit],
    )
    return result.rows.map(rowToAudit)
  }
  return withFileState(state => Object.values(state.audits)
    .filter(record => record.ownerUserId === ownerUserId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, safeLimit))
}
