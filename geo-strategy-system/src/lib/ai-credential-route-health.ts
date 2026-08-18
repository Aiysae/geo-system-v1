import "server-only"

import { createHash } from "crypto"
import { Pool, type PoolClient } from "pg"
import { circuitCooldownMs } from "@/lib/ai-credential-failure-classifier"
import { kv } from "@/lib/kv"
import type {
  AiCredentialCapability,
  AiCredentialFailureDiagnosis,
  AiCredentialFailureClass,
  AiCredentialFailureScope,
  AiCredentialRouteContext,
  AiCredentialRouteHealth,
  AiCredentialRouteIdentity,
  AiCredentialRouteState,
  AiCredentialRuntime,
  AiCredentialSelectionRequest,
  AiCredentialVendor,
} from "@/types/ai-credentials"

type RouteStoreGlobal = typeof globalThis & {
  __geoAiCredentialRoutePool?: Pool
  __geoAiCredentialRouteSchemaPromise?: Promise<unknown>
}

const globalState = globalThis as RouteStoreGlobal
const KV_KEY = "system:ai-credential-route-health:v1"
const VALID_STATES = new Set<AiCredentialRouteState>([
  "closed",
  "degraded",
  "open",
  "half_open",
  "action_required",
])
const VALID_FAILURE_CLASSES = new Set<AiCredentialFailureClass>([
  "none",
  "cancelled",
  "local_capacity",
  "request_rejected",
  "rate_limited",
  "transient_upstream",
  "authentication",
  "billing",
  "permission",
  "model_unavailable",
  "web_evidence",
  "unknown",
])
const VALID_FAILURE_SCOPES = new Set<AiCredentialFailureScope>([
  "ignored",
  "route",
  "capability",
  "model",
  "credential",
])

export const AI_CREDENTIAL_ROUTE_HEALTH_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS geo_ai_credential_route_health_v1 (
  id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL,
  vendor TEXT NOT NULL,
  model TEXT NOT NULL,
  module TEXT NOT NULL,
  capability_profile TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'closed',
  failure_class TEXT NOT NULL DEFAULT 'none',
  failure_scope TEXT NOT NULL DEFAULT 'route',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  probe_attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_message TEXT,
  open_until TIMESTAMPTZ,
  next_probe_at TIMESTAMPTZ,
  last_probe_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (credential_id, model, module, capability_profile)
);
CREATE INDEX IF NOT EXISTS geo_ai_credential_route_health_v1_credential_idx
  ON geo_ai_credential_route_health_v1 (credential_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS geo_ai_credential_route_health_v1_probe_idx
  ON geo_ai_credential_route_health_v1 (state, next_probe_at)
  WHERE state IN ('degraded', 'open', 'half_open', 'action_required');
`

let kvMutationQueue: Promise<void> = Promise.resolve()

function databasePool(): Pool | null {
  const connectionString = String(process.env.DATABASE_URL || "").trim()
  if (!connectionString) return null
  if (!globalState.__geoAiCredentialRoutePool) {
    globalState.__geoAiCredentialRoutePool = new Pool({
      connectionString,
      max: Math.max(1, Math.min(5, Number(process.env.AI_CREDENTIAL_DB_POOL_MAX) || 2)),
      ssl: /^(1|true|yes|on)$/i.test(String(process.env.DATABASE_SSL || ""))
        ? { rejectUnauthorized: false }
        : undefined,
    })
  }
  return globalState.__geoAiCredentialRoutePool
}

async function ensureSchema(db: Pool): Promise<void> {
  if (!globalState.__geoAiCredentialRouteSchemaPromise) {
    globalState.__geoAiCredentialRouteSchemaPromise = db.query(
      AI_CREDENTIAL_ROUTE_HEALTH_SCHEMA_SQL,
    )
  }
  await globalState.__geoAiCredentialRouteSchemaPromise
}

function cleanText(value: unknown, maximum = 360): string {
  return String(value || "").trim().slice(0, maximum)
}

function safeInteger(value: unknown, fallback = 0): number {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback
}

function parseDate(value: unknown): string | undefined {
  if (!value) return undefined
  const parsed = new Date(String(value))
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined
}

function normalizeRoute(value: unknown): AiCredentialRouteHealth | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const id = cleanText(row.id, 80)
  const credentialId = cleanText(row.credentialId ?? row.credential_id, 80)
  const vendor = cleanText(row.vendor, 40) as AiCredentialVendor
  const model = cleanText(row.model, 240)
  const routeModule = cleanText(row.module, 80) as AiCredentialRouteHealth["module"]
  const capabilityProfile = cleanText(
    row.capabilityProfile ?? row.capability_profile,
    240,
  )
  if (!id || !credentialId || !vendor || !model || !routeModule || !capabilityProfile) {
    return null
  }
  const stateValue = cleanText(row.state, 40) as AiCredentialRouteState
  const failureClassValue = cleanText(
    row.failureClass ?? row.failure_class,
    80,
  ) as AiCredentialFailureClass
  const failureScopeValue = cleanText(
    row.failureScope ?? row.failure_scope,
    80,
  ) as AiCredentialFailureScope
  const createdAt = parseDate(row.createdAt ?? row.created_at) || new Date().toISOString()
  return {
    id,
    credentialId,
    vendor,
    model,
    module: routeModule,
    capabilityProfile,
    state: VALID_STATES.has(stateValue) ? stateValue : "closed",
    failureClass: VALID_FAILURE_CLASSES.has(failureClassValue)
      ? failureClassValue
      : "none",
    failureScope: VALID_FAILURE_SCOPES.has(failureScopeValue)
      ? failureScopeValue
      : "route",
    consecutiveFailures: safeInteger(
      row.consecutiveFailures ?? row.consecutive_failures,
    ),
    successCount: safeInteger(row.successCount ?? row.success_count),
    failureCount: safeInteger(row.failureCount ?? row.failure_count),
    probeAttempts: safeInteger(row.probeAttempts ?? row.probe_attempts),
    lastErrorCode: cleanText(row.lastErrorCode ?? row.last_error_code, 120) || undefined,
    lastErrorMessage: cleanText(
      row.lastErrorMessage ?? row.last_error_message,
      360,
    ) || undefined,
    openUntil: parseDate(row.openUntil ?? row.open_until),
    nextProbeAt: parseDate(row.nextProbeAt ?? row.next_probe_at),
    lastProbeAt: parseDate(row.lastProbeAt ?? row.last_probe_at),
    lastSuccessAt: parseDate(row.lastSuccessAt ?? row.last_success_at),
    lastFailureAt: parseDate(row.lastFailureAt ?? row.last_failure_at),
    lastLatencyMs: safeInteger(row.lastLatencyMs ?? row.last_latency_ms) || undefined,
    createdAt,
    updatedAt: parseDate(row.updatedAt ?? row.updated_at) || createdAt,
  }
}

export function aiCredentialCapabilityProfile(
  capabilities: AiCredentialCapability[] | undefined,
): string {
  const unique = [...new Set((capabilities || []).map(String).filter(Boolean))]
  if (unique.includes("native_web") && unique.includes("auditable_sources")) {
    return "strict_web"
  }
  const normalized = unique.sort().join("+")
  return normalized || "chat"
}

export function aiCredentialRouteHealthId(
  identity: AiCredentialRouteIdentity,
): string {
  const hash = createHash("sha256")
    .update([
      identity.credentialId,
      identity.vendor,
      identity.model,
      identity.module,
      identity.capabilityProfile,
    ].join("\u001f"))
    .digest("hex")
    .slice(0, 32)
  return `route_${hash}`
}

export function buildAiCredentialRouteIdentity(
  credential: Pick<
    AiCredentialRuntime,
    "id" | "vendor" | "allowedModels" | "verifiedWebModels"
  >,
  context: AiCredentialRouteContext | AiCredentialSelectionRequest,
): AiCredentialRouteIdentity {
  const capabilityProfile = aiCredentialCapabilityProfile(
    context.requiredCapabilities,
  )
  const requestedModel = cleanText(context.model, 240)
  const model = requestedModel
    || (capabilityProfile === "strict_web" ? credential.verifiedWebModels[0] : "")
    || credential.allowedModels[0]
    || "default"
  return {
    credentialId: credential.id,
    vendor: credential.vendor,
    model,
    module: context.module,
    capabilityProfile,
  }
}

async function listStoredRoutes(): Promise<AiCredentialRouteHealth[]> {
  const db = databasePool()
  if (db) {
    await ensureSchema(db)
    const result = await db.query(
      `SELECT * FROM geo_ai_credential_route_health_v1
       ORDER BY updated_at DESC`,
    )
    return result.rows
      .map(normalizeRoute)
      .filter((item): item is AiCredentialRouteHealth => Boolean(item))
  }
  const values = await kv.get<unknown[]>(KV_KEY)
  return (Array.isArray(values) ? values : [])
    .map(normalizeRoute)
    .filter((item): item is AiCredentialRouteHealth => Boolean(item))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

async function writeKvRoutes(
  mutate: (
    values: AiCredentialRouteHealth[],
  ) => AiCredentialRouteHealth[] | Promise<AiCredentialRouteHealth[]>,
): Promise<void> {
  const previous = kvMutationQueue
  let release: () => void = () => undefined
  kvMutationQueue = new Promise(resolve => {
    release = resolve
  })
  await previous.catch(() => undefined)
  try {
    await kv.set(KV_KEY, await mutate(await listStoredRoutes()))
  } finally {
    release()
  }
}

function createRoute(
  identity: AiCredentialRouteIdentity,
  now: string,
): AiCredentialRouteHealth {
  return {
    ...identity,
    id: aiCredentialRouteHealthId(identity),
    state: "closed",
    failureClass: "none",
    failureScope: "route",
    consecutiveFailures: 0,
    successCount: 0,
    failureCount: 0,
    probeAttempts: 0,
    createdAt: now,
    updatedAt: now,
  }
}

function routeValues(route: AiCredentialRouteHealth): unknown[] {
  return [
    route.id,
    route.credentialId,
    route.vendor,
    route.model,
    route.module,
    route.capabilityProfile,
    route.state,
    route.failureClass,
    route.failureScope,
    route.consecutiveFailures,
    route.successCount,
    route.failureCount,
    route.probeAttempts,
    route.lastErrorCode || null,
    route.lastErrorMessage || null,
    route.openUntil || null,
    route.nextProbeAt || null,
    route.lastProbeAt || null,
    route.lastSuccessAt || null,
    route.lastFailureAt || null,
    route.lastLatencyMs || null,
    route.createdAt,
    route.updatedAt,
  ]
}

async function upsertRouteWithClient(
  client: PoolClient,
  route: AiCredentialRouteHealth,
): Promise<void> {
  await client.query(
    `INSERT INTO geo_ai_credential_route_health_v1 (
      id, credential_id, vendor, model, module, capability_profile, state,
      failure_class, failure_scope, consecutive_failures, success_count,
      failure_count, probe_attempts, last_error_code, last_error_message,
      open_until, next_probe_at, last_probe_at, last_success_at,
      last_failure_at, last_latency_ms, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
      $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
    )
    ON CONFLICT (id) DO UPDATE SET
      vendor = EXCLUDED.vendor,
      model = EXCLUDED.model,
      module = EXCLUDED.module,
      capability_profile = EXCLUDED.capability_profile,
      state = EXCLUDED.state,
      failure_class = EXCLUDED.failure_class,
      failure_scope = EXCLUDED.failure_scope,
      consecutive_failures = EXCLUDED.consecutive_failures,
      success_count = EXCLUDED.success_count,
      failure_count = EXCLUDED.failure_count,
      probe_attempts = EXCLUDED.probe_attempts,
      last_error_code = EXCLUDED.last_error_code,
      last_error_message = EXCLUDED.last_error_message,
      open_until = EXCLUDED.open_until,
      next_probe_at = EXCLUDED.next_probe_at,
      last_probe_at = EXCLUDED.last_probe_at,
      last_success_at = EXCLUDED.last_success_at,
      last_failure_at = EXCLUDED.last_failure_at,
      last_latency_ms = EXCLUDED.last_latency_ms,
      updated_at = EXCLUDED.updated_at`,
    routeValues(route),
  )
}

async function mutateRoute(
  identity: AiCredentialRouteIdentity,
  mutate: (current: AiCredentialRouteHealth) => AiCredentialRouteHealth,
): Promise<AiCredentialRouteHealth> {
  const id = aiCredentialRouteHealthId(identity)
  const db = databasePool()
  if (db) {
    await ensureSchema(db)
    const client = await db.connect()
    try {
      await client.query("BEGIN")
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
        [id],
      )
      const existing = await client.query(
        `SELECT * FROM geo_ai_credential_route_health_v1
         WHERE id = $1 FOR UPDATE`,
        [id],
      )
      const now = new Date().toISOString()
      const current = normalizeRoute(existing.rows[0]) || createRoute(identity, now)
      const next = mutate(current)
      await upsertRouteWithClient(client, next)
      await client.query("COMMIT")
      return next
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  let result: AiCredentialRouteHealth | undefined
  await writeKvRoutes(values => {
    const now = new Date().toISOString()
    const current = values.find(item => item.id === id) || createRoute(identity, now)
    result = mutate(current)
    return [...values.filter(item => item.id !== id), result]
  })
  if (!result) throw new Error("模型通道路由健康状态写入失败")
  return result
}

export async function listAiCredentialRouteHealth(
  credentialIds?: string[],
): Promise<AiCredentialRouteHealth[]> {
  const filter = new Set((credentialIds || []).filter(Boolean))
  if (credentialIds && filter.size === 0) return []
  const db = databasePool()
  if (db && filter.size > 0) {
    await ensureSchema(db)
    const result = await db.query(
      `SELECT * FROM geo_ai_credential_route_health_v1
       WHERE credential_id = ANY($1::text[])
       ORDER BY updated_at DESC`,
      [[...filter]],
    )
    return result.rows
      .map(normalizeRoute)
      .filter((item): item is AiCredentialRouteHealth => Boolean(item))
  }
  return (await listStoredRoutes()).filter(route =>
    credentialIds === undefined || filter.has(route.credentialId),
  )
}

export async function getAiCredentialRouteHealthMap(
  identities: AiCredentialRouteIdentity[],
): Promise<Map<string, AiCredentialRouteHealth>> {
  if (identities.length === 0) return new Map()
  const ids = new Set(identities.map(aiCredentialRouteHealthId))
  const db = databasePool()
  let routes: AiCredentialRouteHealth[]
  if (db) {
    await ensureSchema(db)
    const result = await db.query(
      `SELECT * FROM geo_ai_credential_route_health_v1
       WHERE id = ANY($1::text[])`,
      [[...ids]],
    )
    routes = result.rows
      .map(normalizeRoute)
      .filter((item): item is AiCredentialRouteHealth => Boolean(item))
  } else {
    routes = await listStoredRoutes()
  }
  return new Map(
    routes
      .filter(route => ids.has(route.id))
      .map(route => [route.id, route]),
  )
}

export async function ensureAiCredentialRouteHealth(
  identity: AiCredentialRouteIdentity,
  options: {
    state?: AiCredentialRouteState
    failureClass?: AiCredentialFailureClass
    failureScope?: AiCredentialFailureScope
    lastErrorCode?: string
    lastErrorMessage?: string
    nextProbeAt?: string
    reopenClosed?: boolean
  } = {},
): Promise<AiCredentialRouteHealth> {
  return mutateRoute(identity, current => {
    const hasHistory = current.successCount > 0 || current.failureCount > 0
    if (hasHistory && !(options.reopenClosed && current.state === "closed")) {
      return current
    }
    return {
      ...current,
      state: options.state || current.state,
      failureClass: options.failureClass || current.failureClass,
      failureScope: options.failureScope || current.failureScope,
      lastErrorCode: cleanText(options.lastErrorCode, 120) || current.lastErrorCode,
      lastErrorMessage: cleanText(options.lastErrorMessage, 360) || current.lastErrorMessage,
      nextProbeAt: parseDate(options.nextProbeAt) || current.nextProbeAt,
      updatedAt: new Date().toISOString(),
    }
  })
}

export async function recordAiCredentialRouteSuccess(
  identity: AiCredentialRouteIdentity,
  latencyMs: number,
  isProbe = false,
): Promise<AiCredentialRouteHealth> {
  return mutateRoute(identity, current => {
    const now = new Date().toISOString()
    return {
      ...current,
      ...identity,
      state: "closed",
      failureClass: "none",
      failureScope: "route",
      consecutiveFailures: 0,
      successCount: current.successCount + 1,
      probeAttempts: current.probeAttempts + (isProbe ? 1 : 0),
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
      openUntil: undefined,
      nextProbeAt: undefined,
      lastProbeAt: isProbe ? now : current.lastProbeAt,
      lastSuccessAt: now,
      lastLatencyMs: safeInteger(latencyMs) || undefined,
      updatedAt: now,
    }
  })
}

export async function recordAiCredentialRouteFailure(
  identity: AiCredentialRouteIdentity,
  failure: AiCredentialFailureDiagnosis,
  isProbe = false,
): Promise<AiCredentialRouteHealth | null> {
  if (!failure.countsTowardCircuit || failure.scope === "ignored") return null
  return mutateRoute(identity, current => {
    const nowMs = Date.now()
    const now = new Date(nowMs).toISOString()
    const consecutiveFailures = current.consecutiveFailures + 1
    const shouldOpen = consecutiveFailures >= 3
    const state: AiCredentialRouteState = failure.actionRequired
      ? "action_required"
      : shouldOpen
        ? "open"
        : "degraded"
    const cooldownMs = circuitCooldownMs(
      failure.failureClass,
      consecutiveFailures,
      failure.cooldownMs,
    )
    const nextProbeAt = new Date(nowMs + Math.max(5_000, cooldownMs)).toISOString()
    return {
      ...current,
      ...identity,
      state,
      failureClass: failure.failureClass,
      failureScope: failure.scope,
      consecutiveFailures,
      failureCount: current.failureCount + 1,
      probeAttempts: current.probeAttempts + (isProbe ? 1 : 0),
      lastErrorCode: cleanText(failure.code, 120),
      lastErrorMessage: cleanText(failure.message, 360),
      openUntil: shouldOpen || failure.actionRequired ? nextProbeAt : undefined,
      nextProbeAt,
      lastProbeAt: isProbe ? now : current.lastProbeAt,
      lastFailureAt: now,
      updatedAt: now,
    }
  })
}

export async function markAiCredentialRouteHalfOpen(
  route: AiCredentialRouteHealth,
): Promise<AiCredentialRouteHealth> {
  return mutateRoute(route, current => ({
    ...current,
    state: "half_open",
    lastProbeAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }))
}

export async function listDueAiCredentialRouteProbes(
  limit = 20,
): Promise<AiCredentialRouteHealth[]> {
  const now = Date.now()
  const staleHalfOpenBefore = now - 5 * 60_000
  const safeLimit = Math.max(1, Math.min(100, limit))
  const db = databasePool()
  let routes: AiCredentialRouteHealth[]
  if (db) {
    await ensureSchema(db)
    const result = await db.query(
      `SELECT * FROM geo_ai_credential_route_health_v1
       WHERE state <> 'closed'
         AND (
           (state = 'half_open' AND (last_probe_at IS NULL OR last_probe_at <= $1))
           OR
           (state <> 'half_open' AND (next_probe_at IS NULL OR next_probe_at <= $2))
         )
       ORDER BY COALESCE(next_probe_at, updated_at) ASC
       LIMIT $3`,
      [new Date(staleHalfOpenBefore).toISOString(), new Date(now).toISOString(), safeLimit],
    )
    routes = result.rows
      .map(normalizeRoute)
      .filter((item): item is AiCredentialRouteHealth => Boolean(item))
  } else {
    routes = await listStoredRoutes()
  }
  return routes
    .filter(route => {
      if (route.state === "closed") return false
      if (route.state === "half_open") {
        return !route.lastProbeAt
          || new Date(route.lastProbeAt).getTime() <= staleHalfOpenBefore
      }
      return !route.nextProbeAt || new Date(route.nextProbeAt).getTime() <= now
    })
    .sort((left, right) => {
      const leftAt = new Date(left.nextProbeAt || left.updatedAt).getTime()
      const rightAt = new Date(right.nextProbeAt || right.updatedAt).getTime()
      return leftAt - rightAt
    })
    .slice(0, safeLimit)
}

export async function deleteAiCredentialRouteHealth(
  credentialId: string,
): Promise<void> {
  const db = databasePool()
  if (db) {
    await ensureSchema(db)
    await db.query(
      "DELETE FROM geo_ai_credential_route_health_v1 WHERE credential_id = $1",
      [credentialId],
    )
    return
  }
  await writeKvRoutes(values => values.filter(
    route => route.credentialId !== credentialId,
  ))
}

export async function closeAiCredentialRouteHealthConnection(): Promise<void> {
  const pool = globalState.__geoAiCredentialRoutePool
  globalState.__geoAiCredentialRoutePool = undefined
  globalState.__geoAiCredentialRouteSchemaPromise = undefined
  if (pool) await pool.end()
}
