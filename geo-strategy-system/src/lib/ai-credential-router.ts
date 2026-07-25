import "server-only"

import { randomUUID } from "crypto"
import {
  listAiCredentialRuntimes,
  updateAiCredentialHealth,
} from "@/lib/ai-credential-store"
import { kv } from "@/lib/kv"
import { hitRateLimit } from "@/lib/rate-limit"
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
const lastSuccessWriteAt = new Map<string, number>()

function isCoolingDown(credential: AiCredentialRuntime): boolean {
  if (!credential.cooldownUntil) return false
  return new Date(credential.cooldownUntil).getTime() > Date.now()
}

function satisfiesRequest(
  credential: AiCredentialRuntime,
  request: AiCredentialSelectionRequest,
): boolean {
  if (!credential.enabled || !credential.apiKey || isCoolingDown(credential)) return false
  if (request.excludeCredentialIds?.includes(credential.id)) return false
  if (
    credential.allowedModules.length > 0
    && !credential.allowedModules.includes(request.module)
  ) return false
  if (
    request.model
    && credential.allowedModels.length > 0
    && !credential.allowedModels.includes(request.model)
  ) return false
  const verified = new Set(credential.verifiedCapabilities)
  return (request.requiredCapabilities || []).every(capability => verified.has(capability))
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash | 0)
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
    const leftScore = ((sequence + stableHash(left.id)) % 1_000_003) / left.weight
    const rightScore = ((sequence + stableHash(right.id)) % 1_000_003) / right.weight
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
): Promise<boolean> {
  if (!credential.rpmLimit) return true
  const result = await hitRateLimit(
    "ai-credential-rpm",
    credential.id,
    credential.rpmLimit,
    60,
  )
  return result.ok
}

async function tryAcquireCredential(
  credential: AiCredentialRuntime,
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
  if (!(await withinCredentialRpmLimit(credential))) {
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
    const candidates = await orderedCandidates(request)
    sawCandidate ||= candidates.length > 0
    for (const credential of candidates) {
      const lease = await tryAcquireCredential(credential, leaseSeconds)
      if (lease) return lease
    }
    if (Date.now() >= deadline) break
    await new Promise(resolve => setTimeout(resolve, Math.min(500, Math.max(100, deadline - Date.now()))))
  } while (Date.now() <= deadline)

  if (!sawCandidate && missingOk) return null
  if (!sawCandidate) throw new Error(noCredentialMessage(request))
  throw new Error(`${request.vendor} 当前账号任务较多，排队等待超时，请稍后重试`)
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
  const message = error instanceof Error ? error.message : String(error || "")
  const failures = credential.consecutiveFailures + 1
  const permanent = /(401|403|invalid.*key|unauthorized|forbidden|余额不足|欠费|无权限)/i.test(message)
  const cooldownMs = permanent
    ? 30 * 60_000
    : failures >= 3
      ? Math.min(10 * 60_000, 30_000 * 2 ** Math.min(5, failures - 3))
      : 0
  try {
    await updateAiCredentialHealth(credential.id, {
      status: permanent ? "unhealthy" : failures >= 3 ? "degraded" : credential.healthStatus,
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
