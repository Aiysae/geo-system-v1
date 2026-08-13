import "server-only"

import { createHash, randomUUID } from "crypto"
import { kv } from "@/lib/kv"
import type { AgentActionDispatchResult } from "@/lib/agent/action-dispatch"
import type { AgentActionName } from "@/types/agent"

const CLAIM_TTL_SECONDS = 10 * 60
const RESULT_TTL_SECONDS = 36 * 60 * 60

type StoredActionResult = {
  version: 1
  payloadHash: string
  status: number
  data: unknown
  task?: AgentActionDispatchResult["task"]
  createdAt: string
}

export type AgentActionRequestClaim = {
  key: string
  token: string
}

export type AgentActionAcquireResult =
  | { status: "claimed"; claim: AgentActionRequestClaim; payloadHash: string }
  | { status: "existing"; result: AgentActionDispatchResult }
  | { status: "pending" }
  | { status: "conflict" }

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]),
  )
}

function payloadHash(payload: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(payload)))
    .digest("hex")
}

function keyPrefix(tokenId: string, action: AgentActionName, requestId: string): string {
  const digest = createHash("sha256")
    .update(`${tokenId}\u0000${action}\u0000${requestId}`)
    .digest("hex")
  return `geo:agent-action-idempotency:${digest}`
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function storedResult(
  resultKey: string,
  expectedHash: string,
): Promise<AgentActionAcquireResult | null> {
  const stored = await kv.get<StoredActionResult>(resultKey)
  if (!stored) return null
  if (stored.payloadHash !== expectedHash) return { status: "conflict" }
  return {
    status: "existing",
    result: {
      status: stored.status,
      data: stored.data,
      task: stored.task,
    },
  }
}

export async function acquireAgentActionRequest(input: {
  tokenId: string
  action: AgentActionName
  requestId: string
  payload: Record<string, unknown>
}): Promise<AgentActionAcquireResult> {
  const hash = payloadHash(input.payload)
  const prefix = keyPrefix(input.tokenId, input.action, input.requestId)
  const resultKey = `${prefix}:result`
  const existing = await storedResult(resultKey, hash)
  if (existing) return existing

  const claimKey = `${prefix}:claim`
  const token = randomUUID()
  const claimed = await kv.set(claimKey, token, { nx: true, ex: CLAIM_TTL_SECONDS })
  if (claimed) {
    return {
      status: "claimed",
      claim: { key: claimKey, token },
      payloadHash: hash,
    }
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(100)
    const completed = await storedResult(resultKey, hash)
    if (completed) return completed
  }
  return { status: "pending" }
}

export async function commitAgentActionRequest(input: {
  tokenId: string
  action: AgentActionName
  requestId: string
  payloadHash: string
  claim: AgentActionRequestClaim
  result: AgentActionDispatchResult
}): Promise<void> {
  const prefix = keyPrefix(input.tokenId, input.action, input.requestId)
  await kv.set(`${prefix}:result`, {
    version: 1,
    payloadHash: input.payloadHash,
    status: input.result.status,
    data: input.result.data,
    task: input.result.task,
    createdAt: new Date().toISOString(),
  } satisfies StoredActionResult, { ex: RESULT_TTL_SECONDS })
  await releaseAgentActionRequest(input.claim)
}

export async function releaseAgentActionRequest(
  claim: AgentActionRequestClaim | undefined,
): Promise<void> {
  if (!claim) return
  const current = await kv.get<string>(claim.key)
  if (current === claim.token) await kv.del(claim.key)
}
