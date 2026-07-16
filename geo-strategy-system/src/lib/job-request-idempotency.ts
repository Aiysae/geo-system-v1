import "server-only"

import { createHash, randomUUID } from "crypto"
import { kv } from "@/lib/kv"

const CLAIM_TTL_SECONDS = 120

export interface JobRequestClaim {
  key: string
  token: string
}

export type JobRequestAcquireResult<TResult> =
  | { status: "claimed"; claim: JobRequestClaim }
  | { status: "existing"; job: TResult }
  | { status: "pending" }

function claimKey(namespace: string, ownerUserId: string, requestId: string): string {
  const ownerHash = createHash("sha256").update(ownerUserId).digest("hex").slice(0, 24)
  return `geo:job-create-claims:${namespace}:${ownerHash}:${requestId}`
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function normalizeJobRequestId(value: unknown): string {
  const requestId = String(value || "").trim()
  if (!requestId) return `legacy_${randomUUID().replace(/-/g, "")}`
  if (!/^[A-Za-z0-9_-]{16,160}$/.test(requestId)) {
    throw new Error("任务请求编号无效，请刷新后重试")
  }
  return requestId
}

export function jobIdFromRequest(
  prefix: "pjob" | "djob" | "qjob" | "rjob",
  ownerUserId: string,
  requestId: string,
): string {
  const digest = createHash("sha256")
    .update(`${prefix}:${ownerUserId}:${requestId}`)
    .digest("hex")
    .slice(0, 32)
  return `${prefix}_${digest}`
}

export async function acquireJobRequest<TResult>(args: {
  namespace: string
  ownerUserId: string
  requestId: string
  existingJobId: string
  loadExisting: (jobId: string) => Promise<TResult | null>
}): Promise<JobRequestAcquireResult<TResult>> {
  const existing = await args.loadExisting(args.existingJobId)
  if (existing) return { status: "existing", job: existing }

  const key = claimKey(args.namespace, args.ownerUserId, args.requestId)
  const token = `pending:${randomUUID()}`
  const claimed = await kv.set(key, token, { nx: true, ex: CLAIM_TTL_SECONDS })
  if (claimed) return { status: "claimed", claim: { key, token } }

  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(100)
    const pendingJob = await args.loadExisting(args.existingJobId)
    if (pendingJob) return { status: "existing", job: pendingJob }
  }
  return { status: "pending" }
}

export async function releaseJobRequestClaim(claim: JobRequestClaim | null | undefined): Promise<void> {
  if (!claim) return
  try {
    const current = await kv.get<string>(claim.key)
    if (current === claim.token) await kv.del(claim.key)
  } catch (error) {
    console.warn("[job-idempotency] failed to release creation claim", error)
  }
}
