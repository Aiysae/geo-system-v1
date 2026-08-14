import "server-only"

import { randomUUID } from "crypto"
import { isPermanentAiCredentialFailure } from "@/lib/ai-credential-errors"
import {
  listAiCredentialRuntimes,
  updateAiCredentialHealth,
} from "@/lib/ai-credential-store"
import { kv } from "@/lib/kv"
import { reserveRateLimit } from "@/lib/rate-limit"
import type {
  AiCredentialCapability,
  AiCredentialLease,
  AiCredentialRuntime,
  AiCredentialSelectionRequest,
} from "@/types/ai-credentials"

interface AcquiredSlot {
  key: string
  token: string
}

const DEFAULT_WAIT_TIMEOUT_MS = 30_000
const DEFAULT_LEASE_SECONDS = 10 * 60
const MAX_CONSECUTIVE_FAILURES_BEFORE_QUARANTINE = 6
const lastSuccessWriteAt = new Map<string, number>()

function isCoolingDown(credential: AiCredentialRuntime): boolean {
  if (!credential.cooldownUntil) return false
  return new Date(credential.cooldownUntil).getTime() > Date.now()
}

function satisfiesRequest(
  credential: AiCredentialRuntime,
  request: AiCredentialSelectionRequest,
): boolean {
  if (
    !credential.enabled
    || !credential.apiKey
    || credential.healthStatus === "unhealthy"
    || credential.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES_BEFORE_QUARANTINE
    || isCoolingDown(credential)
  ) return false
  if (request.excludeCredentialIds?.includes(credential.id)) return false
  const verified = new Set(credential.verifiedCapabilities)
  const strictWebRequest = request.module === "penetration"
    && request.requiredCapabilities?.includes("native_web")
    && request.requiredCapabilities?.includes("auditable_sources")
  const verifiedStrictWebModel = strictWebRequest
    && (request.model
      ? credential.verifiedWebModels.includes(request.model)
      : credential.verifiedWebModels.length > 0)
  const verifiedStrictWebOverride = verifiedStrictWebModel
    && verified.has("native_web")
    && verified.has("auditable_sources")
  const verifiedExternalSearchGenerationOverride =
    (request.vendor === "kimi" || request.vendor === "deepseek")
    && request.module === "penetration"
    && (request.requiredCapabilities || []).every(capability => capability === "chat")
    && verified.has("chat")
  if (
    credential.allowedModules.length > 0
    && !credential.allowedModules.includes(request.module)
    && !verifiedStrictWebOverride
    && !verifiedExternalSearchGenerationOverride
  ) return false
  if (
    request.model
    && credential.allowedModels.length > 0
    && !credential.allowedModels.includes(request.model)
  ) return false
  if (strictWebRequest && !verifiedStrictWebModel) return false
  return (request.requiredCapabilities || []).every(capability => verified.has(capability))
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function weightedRouteScore(
  credential: AiCredentialRuntime,
  sequence: number,
): number {
  const hash = stableHash(`${sequence}:${credential.id}`)
  const unit = (hash + 1) / 4_294_967_297
  return -Math.log(unit) / Math.max(1, credential.weight)
}

async function orderedCandidates(
  request: AiCredentialSelectionRequest,
): Promise<AiCredentialRuntime[]> {
  const credentials = (await listAiCredentialRuntimes(request.vendor))
    .filter(credential => satisfiesRequest(credential, request))
  if (credentials.length <= 1) return credentials
  const sequence = await kv.incrby(
    `geo:ai-credential:route-sequence:${request.vendor}:${request.module}`,
    1,
  )
  return credentials.sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority
    const leftScore = weightedRouteScore(left, sequence)
    const rightScore = weightedRouteScore(right, sequence)
    if (leftScore !== rightScore) return leftScore - rightScore
    const leftLatency = left.lastLatencyMs ?? Number.MAX_SAFE_INTEGER
    const rightLatency = right.lastLatencyMs ?? Number.MAX_SAFE_INTEGER
    return leftLatency - rightLatency
  })
}

function slotKey(scope: string, slot: number): string {
  return `geo:ai-credential:lease:${scope}:${slot}`
}

async function tryAcquireSlot(
  scope: string,
  limit: number,
  leaseSeconds: number,
): Promise<AcquiredSlot | null> {
  const token = randomUUID()
  for (let slot = 0; slot < limit; slot += 1) {
    const key = slotKey(scope, slot)
    const acquired = await kv.set(key, token, { nx: true, ex: leaseSeconds })
    if (acquired) return { key, token }
  }
  return null
}

async function releaseSlot(slot: AcquiredSlot | null): Promise<void> {
  if (!slot) return
  try {
    const current = await kv.get<string>(slot.key)
    if (current === slot.token) await kv.del(slot.key)
  } catch (error) {
    console.warn(
      "[ai-credential-router] failed to release slot",
      error instanceof Error ? error.message : String(error),
    )
  }
}

async function withinCredentialRpmLimit(
  credential: AiCredentialRuntime,
  request: AiCredentialSelectionRequest,
): Promise<boolean> {
  const configuredKimiRpm = Math.floor(
    Number(process.env.KIMI_PENETRATION_DEFAULT_RPM),
  )
  const defaultKimiRpm = Number.isFinite(configuredKimiRpm) && configuredKimiRpm > 0
    ? Math.min(1_000, configuredKimiRpm)
    : 3
  const rpmLimit = credential.rpmLimit
    || (credential.vendor === "kimi" && request.module === "penetration"
      ? defaultKimiRpm
      : undefined)
  if (!rpmLimit) return true
  const requestUnits = request.module === "penetration"
    && (credential.vendor === "kimi" || credential.vendor === "deepseek")
    ? 2
    : 1
  const result = await reserveRateLimit(
    "ai-credential-rpm",
    credential.id,
    requestUnits,
    rpmLimit,
    60,
  )
  return result.ok
}

function beijingDayWindow(): { day: string; seconds: number } {
  const now = Date.now()
  const shifted = new Date(now + 8 * 60 * 60 * 1000)
  const day = shifted.toISOString().slice(0, 10)
  const nextMidnightShifted = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
  )
  const nextMidnight = nextMidnightShifted - 8 * 60 * 60 * 1000
  return {
    day,
    seconds: Math.max(1, Math.ceil((nextMidnight - now) / 1000)),
  }
}

async function withinCredentialUsageLimits(
  credential: AiCredentialRuntime,
  request: AiCredentialSelectionRequest,
): Promise<boolean> {
  if (credential.tpmLimit && request.estimatedTokens) {
    const tokenResult = await reserveRateLimit(
      "ai-credential-tpm",
      credential.id,
      request.estimatedTokens,
      credential.tpmLimit,
      60,
    )
    if (!tokenResult.ok) return false
  }
  if (credential.dailyBudgetCents && request.estimatedCostCents) {
    const window = beijingDayWindow()
    const budgetResult = await reserveRateLimit(
      "ai-credential-daily-budget",
      `${credential.id}:${window.day}`,
      request.estimatedCostCents,
      credential.dailyBudgetCents,
      window.seconds,
    )
    if (!budgetResult.ok) return false
  }
  return withinCredentialRpmLimit(credential, request)
}

async function tryAcquireCredential(
  credential: AiCredentialRuntime,
  request: AiCredentialSelectionRequest,
  leaseSeconds: number,
): Promise<AiCredentialLease | null> {
  const groupScope = `group:${credential.vendor}:${credential.quotaGroup}`
  const credentialScope = `credential:${credential.id}`
  const groupSlot = await tryAcquireSlot(
    groupScope,
    credential.quotaGroupMaxConcurrency,
    leaseSeconds,
  )
  if (!groupSlot) return null
  const credentialSlot = await tryAcquireSlot(
    credentialScope,
    credential.maxConcurrency,
    leaseSeconds,
  )
  if (!credentialSlot) {
    await releaseSlot(groupSlot)
    return null
  }
  if (!(await withinCredentialUsageLimits(credential, request))) {
    await releaseSlot(credentialSlot)
    await releaseSlot(groupSlot)
    return null
  }

  let released = false
  return {
    credential,
    release: async () => {
      if (released) return
      released = true
      await Promise.all([
        releaseSlot(credentialSlot),
        releaseSlot(groupSlot),
      ])
    },
  }
}

function noCredentialMessage(request: AiCredentialSelectionRequest): string {
  const capabilities = request.requiredCapabilities?.length
    ? `，需要能力：${request.requiredCapabilities.join("、")}`
    : ""
  return `${request.vendor} 暂无已启用且通过验证的可用账号${capabilities}`
}

function credentialWaitAborted(): Error {
  const error = new Error("AI 账号排队已停止")
  error.name = "AbortError"
  return error
}

function throwIfCredentialWaitAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw credentialWaitAborted()
}

function waitForCredential(ms: number, signal: AbortSignal | undefined): Promise<void> {
  throwIfCredentialWaitAborted(signal)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(credentialWaitAborted())
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

async function acquireFromPool(
  request: AiCredentialSelectionRequest,
  missingOk: boolean,
): Promise<AiCredentialLease | null> {
  const timeoutMs = Math.max(
    0,
    Math.min(10 * 60_000, request.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS),
  )
  const leaseSeconds = Math.max(
    30,
    Math.min(60 * 60, request.leaseSeconds ?? DEFAULT_LEASE_SECONDS),
  )
  const deadline = Date.now() + timeoutMs
  let sawCandidate = false

  do {
    throwIfCredentialWaitAborted(request.signal)
    const candidates = await orderedCandidates(request)
    sawCandidate ||= candidates.length > 0
    for (const credential of candidates) {
      throwIfCredentialWaitAborted(request.signal)
      const lease = await tryAcquireCredential(credential, request, leaseSeconds)
      if (lease) {
        if (request.signal?.aborted) {
          await lease.release()
          throw credentialWaitAborted()
        }
        return lease
      }
    }
    if (Date.now() >= deadline) break
    await waitForCredential(
      Math.min(500, Math.max(100, deadline - Date.now())),
      request.signal,
    )
  } while (Date.now() <= deadline)

  if (!sawCandidate && missingOk) return null
  if (!sawCandidate) throw new Error(noCredentialMessage(request))
  throw new Error(`${request.vendor} 当前账号任务较多，排队等待超时，请稍后重试`)
}

export interface AiCredentialPoolCapacity {
  candidateCount: number
  maxConcurrency: number
  quotaGroupCount: number
}

export interface AiCredentialPoolSnapshot extends AiCredentialPoolCapacity {
  activeConcurrency: number
  availableConcurrency: number
}

type CredentialCapacityGroup = {
  quotaGroup: string
  credentialConcurrency: number
  groupConcurrency: number
  credentials: AiCredentialRuntime[]
}

function buildCredentialCapacityGroups(
  candidates: AiCredentialRuntime[],
): Map<string, CredentialCapacityGroup> {
  const groups = new Map<string, CredentialCapacityGroup>()
  for (const credential of candidates) {
    const group = groups.get(credential.quotaGroup) || {
      quotaGroup: credential.quotaGroup,
      credentialConcurrency: 0,
      groupConcurrency: 0,
      credentials: [],
    }
    group.credentialConcurrency += credential.maxConcurrency
    group.groupConcurrency = Math.max(
      group.groupConcurrency,
      credential.quotaGroupMaxConcurrency,
    )
    group.credentials.push(credential)
    groups.set(credential.quotaGroup, group)
  }
  return groups
}

async function occupiedSlotCount(scope: string, limit: number): Promise<number> {
  const slots = await Promise.all(
    Array.from({ length: Math.max(0, limit) }, (_, slot) =>
      kv.get<string>(slotKey(scope, slot)),
    ),
  )
  return slots.filter(Boolean).length
}

export async function getAiCredentialPoolCapacity(
  request: AiCredentialSelectionRequest,
): Promise<AiCredentialPoolCapacity> {
  const candidates = (await listAiCredentialRuntimes(request.vendor))
    .filter(credential => satisfiesRequest(credential, request))
  const groups = buildCredentialCapacityGroups(candidates)
  return {
    candidateCount: candidates.length,
    maxConcurrency: [...groups.values()].reduce(
      (sum, group) => sum + Math.min(group.credentialConcurrency, group.groupConcurrency),
      0,
    ),
    quotaGroupCount: groups.size,
  }
}

export async function getAiCredentialPoolSnapshot(
  request: AiCredentialSelectionRequest,
): Promise<AiCredentialPoolSnapshot> {
  const candidates = (await listAiCredentialRuntimes(request.vendor))
    .filter(credential => satisfiesRequest(credential, request))
  const groups = buildCredentialCapacityGroups(candidates)
  const maxConcurrency = [...groups.values()].reduce(
    (sum, group) => sum + Math.min(group.credentialConcurrency, group.groupConcurrency),
    0,
  )

  try {
    const availableByGroup = await Promise.all(
      [...groups.values()].map(async group => {
        const [activeGroupSlots, activeCredentialSlots] = await Promise.all([
          occupiedSlotCount(
            `group:${request.vendor}:${group.quotaGroup}`,
            group.groupConcurrency,
          ),
          Promise.all(
            group.credentials.map(credential =>
              occupiedSlotCount(
                `credential:${credential.id}`,
                credential.maxConcurrency,
              ),
            ),
          ),
        ])
        const availableGroupSlots = Math.max(
          0,
          group.groupConcurrency - activeGroupSlots,
        )
        const availableCredentialSlots = group.credentials.reduce(
          (sum, credential, index) =>
            sum + Math.max(
              0,
              credential.maxConcurrency - activeCredentialSlots[index],
            ),
          0,
        )
        return Math.min(availableGroupSlots, availableCredentialSlots)
      }),
    )
    const availableConcurrency = availableByGroup.reduce(
      (sum, available) => sum + available,
      0,
    )
    return {
      candidateCount: candidates.length,
      maxConcurrency,
      quotaGroupCount: groups.size,
      activeConcurrency: Math.max(0, maxConcurrency - availableConcurrency),
      availableConcurrency,
    }
  } catch (error) {
    // Capacity inspection is an optimization only. Credential leases remain
    // the authoritative concurrency gate if the snapshot cannot be read.
    console.warn(
      "[ai-credential-router] failed to inspect live pool capacity",
      request.vendor,
      error instanceof Error ? error.message : String(error),
    )
    return {
      candidateCount: candidates.length,
      maxConcurrency,
      quotaGroupCount: groups.size,
      activeConcurrency: 0,
      availableConcurrency: maxConcurrency,
    }
  }
}

export async function acquireAiCredential(
  request: AiCredentialSelectionRequest,
): Promise<AiCredentialLease> {
  const lease = await acquireFromPool(request, false)
  if (!lease) throw new Error(noCredentialMessage(request))
  return lease
}

export async function hasAiCredentialCandidate(
  request: AiCredentialSelectionRequest,
): Promise<boolean> {
  const credentials = await listAiCredentialRuntimes(request.vendor)
  return credentials.some(credential => satisfiesRequest(credential, request))
}

export async function tryAcquireAiCredential(
  request: AiCredentialSelectionRequest,
): Promise<AiCredentialLease | null> {
  return acquireFromPool(request, true)
}

export function resolveAiCredentialModel(
  credential: Pick<AiCredentialRuntime, "allowedModels">,
  requestedModel: string | undefined,
  requiredCapabilities: AiCredentialCapability[] = [],
): string {
  const requested = String(requestedModel || "").trim()
  const allowed = credential.allowedModels
    .map(model => String(model || "").trim())
    .filter(Boolean)

  if (requested && (allowed.length === 0 || allowed.includes(requested))) {
    return requested
  }
  if (requiredCapabilities.includes("vision")) {
    const visionModel = allowed.find(model =>
      /(vision|(?:^|[-_.])vl(?:[-_.]|$)|multimodal)/i.test(model),
    )
    if (visionModel) return visionModel
  }
  return allowed[0] || requested
}

export async function recordAiCredentialSuccess(
  credentialId: string,
  latencyMs: number,
): Promise<void> {
  const now = Date.now()
  if (now - (lastSuccessWriteAt.get(credentialId) || 0) < 30_000) return
  lastSuccessWriteAt.set(credentialId, now)
  try {
    await updateAiCredentialHealth(credentialId, {
      status: "healthy",
      latencyMs,
      consecutiveFailures: 0,
    })
  } catch (error) {
    console.warn(
      "[ai-credential-router] failed to record success",
      error instanceof Error ? error.message : String(error),
    )
  }
}

export async function recordAiCredentialFailure(
  credential: AiCredentialRuntime,
  error: unknown,
): Promise<void> {
  const failures = credential.consecutiveFailures + 1
  const permanent = isPermanentAiCredentialFailure(error)
  const quarantined = permanent
    || failures >= MAX_CONSECUTIVE_FAILURES_BEFORE_QUARANTINE
  const cooldownMs = quarantined
    ? 30 * 60_000
    : failures >= 3
      ? Math.min(10 * 60_000, 30_000 * 2 ** Math.min(5, failures - 3))
      : 0
  try {
    await updateAiCredentialHealth(credential.id, {
      status: quarantined ? "unhealthy" : failures >= 3 ? "degraded" : credential.healthStatus,
      consecutiveFailures: failures,
      cooldownUntil: cooldownMs ? new Date(Date.now() + cooldownMs).toISOString() : undefined,
    })
  } catch (storeError) {
    console.warn(
      "[ai-credential-router] failed to record failure",
      storeError instanceof Error ? storeError.message : String(storeError),
    )
  }
}

export async function withAiCredential<T>(
  request: AiCredentialSelectionRequest,
  task: (credential: AiCredentialRuntime) => Promise<T>,
): Promise<T> {
  const lease = await acquireAiCredential(request)
  const startedAt = Date.now()
  try {
    const result = await task(lease.credential)
    await recordAiCredentialSuccess(lease.credential.id, Date.now() - startedAt)
    return result
  } catch (error) {
    await recordAiCredentialFailure(lease.credential, error)
    throw error
  } finally {
    await lease.release()
  }
}
