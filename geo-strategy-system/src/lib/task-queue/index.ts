import "server-only"

import { randomUUID } from "crypto"
import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq"
import { kv } from "@/lib/kv"
import type { TaskCenterSource } from "@/types/task-center"

export type DurableTaskSource =
  | "penetration"
  | "difficulty"
  | "background"
  | "question"
  | "articleBatch"
  | "report"

export type DurableTaskQueueLane =
  | "penetration"
  | "generation"
  | "utility"

export type DurableTaskPayload = {
  source: DurableTaskSource
  sourceJobId: string
  dispatchToken: string
  queuedAt: string
}

export type TaskWorkerOutcome = {
  requeue?: boolean
  delayMs?: number
}

export type DurableTaskCancellationResult = {
  state: "local" | "removed" | "active" | "not_found"
  queueState?: string
}

export type DurableTaskDispatchSnapshot = {
  backend: "local" | "bullmq"
  claimed: boolean
  queueState:
    | "local"
    | "missing"
    | "waiting"
    | "delayed"
    | "active"
    | "completed"
    | "failed"
    | "waiting-children"
    | "prioritized"
    | "unknown"
  staleClaim: boolean
  repaired: boolean
}

export type DurableTaskQueueSnapshot = {
  backend: "local" | "bullmq"
  lane: DurableTaskQueueLane
  queueName: string
  reachable: boolean
  checkedAt: string
  active: number
  waiting: number
  delayed: number
  failed: number
  paused: number
  workers: number
  oldestQueuedAt?: string
  oldestAgeMs?: number
  error?: string
}

export type DurableTaskWorkerHeartbeat = {
  workerId: string
  startedAt: string
  heartbeatAt: string
  queues: Array<{
    lane: DurableTaskQueueLane | "legacy"
    queueName: string
    concurrency: number
  }>
}

type TaskQueueGlobal = typeof globalThis & {
  __geoDurableTaskQueues?: Map<string, Queue<DurableTaskPayload>>
  __geoDurableTaskQueueSnapshots?: Map<
    DurableTaskQueueLane,
    { expiresAt: number; value: DurableTaskQueueSnapshot }
  >
}

const globalState = globalThis as TaskQueueGlobal
const DEFAULT_QUEUE_NAME = "geo-long-tasks-v1"
const DISPATCH_CLAIM_MIN_SECONDS = 30 * 60
const QUEUE_SNAPSHOT_CACHE_MS = 2_000
const WORKER_HEARTBEAT_SET_KEY = "geo:task-worker:heartbeats"
const WORKER_HEARTBEAT_TTL_SECONDS = 75
const MIGRATED_SOURCES = new Set<DurableTaskSource>([
  "penetration",
  "difficulty",
  "background",
  "question",
  "articleBatch",
  "report",
])

function queueBackend(): "bullmq" | "local" {
  const configured = String(process.env.TASK_QUEUE_BACKEND || "").trim().toLowerCase()
  if (configured === "local" || configured === "memory" || configured === "off") return "local"
  if (configured === "bullmq" || configured === "redis") return "bullmq"
  return process.env.NODE_ENV === "production" && Boolean(process.env.REDIS_URL)
    ? "bullmq"
    : "local"
}

export function durableTaskQueueEnabled(source?: DurableTaskSource): boolean {
  if (queueBackend() !== "bullmq" || !String(process.env.REDIS_URL || "").trim()) return false
  return source ? MIGRATED_SOURCES.has(source) : true
}

export function durableTaskQueueName(): string {
  return String(process.env.TASK_QUEUE_NAME || DEFAULT_QUEUE_NAME).trim() || DEFAULT_QUEUE_NAME
}

export function durableTaskQueueLane(
  source: DurableTaskSource,
): DurableTaskQueueLane {
  if (source === "penetration") return "penetration"
  if (source === "report") return "utility"
  return "generation"
}

export function durableTaskQueueNameForLane(
  lane: DurableTaskQueueLane,
): string {
  return `${durableTaskQueueName()}-${lane}`
}

export function durableTaskQueueNameForSource(
  source: DurableTaskSource,
): string {
  return durableTaskQueueNameForLane(durableTaskQueueLane(source))
}

export function durableTaskQueueConnection(): ConnectionOptions {
  const url = String(process.env.REDIS_URL || "").trim()
  if (!url) throw new Error("REDIS_URL is required for BullMQ")
  return {
    url,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 10_000,
    retryStrategy: (attempts: number) => Math.min(250 * 2 ** Math.min(attempts, 5), 5_000),
  }
}

function queueByName(queueName: string): Queue<DurableTaskPayload> {
  const queues = globalState.__geoDurableTaskQueues
    || new Map<string, Queue<DurableTaskPayload>>()
  globalState.__geoDurableTaskQueues = queues
  const existing = queues.get(queueName)
  if (existing) return existing
  const created = new Queue<DurableTaskPayload>(
    queueName,
    {
      connection: durableTaskQueueConnection(),
      prefix: String(process.env.TASK_QUEUE_PREFIX || "geo:bull"),
      defaultJobOptions: {
        attempts: Math.max(1, Math.min(6, Number(process.env.TASK_QUEUE_ATTEMPTS) || 3)),
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: { age: 60 * 60 * 24 * 7, count: 2_000 },
      },
    },
  )
  created.on("error", error => {
    console.error("[task-queue] queue error", queueName, error.message)
  })
  queues.set(queueName, created)
  return created
}

function queue(source: DurableTaskSource): Queue<DurableTaskPayload> {
  return queueByName(durableTaskQueueNameForSource(source))
}

function queueForLane(lane: DurableTaskQueueLane): Queue<DurableTaskPayload> {
  return queueByName(durableTaskQueueNameForLane(lane))
}

function dispatchClaimKey(source: DurableTaskSource, sourceJobId: string): string {
  return `geo:task-queue:dispatch:${source}:${sourceJobId}`
}

function workerHeartbeatKey(workerId: string): string {
  return `geo:task-worker:heartbeat:${workerId}`
}

function cleanSourceJobId(value: string): string {
  const id = String(value || "").trim()
  if (!/^[A-Za-z0-9_-]{8,220}$/.test(id)) throw new Error("后台任务编号无效")
  return id
}

function dispatchClaimSeconds(delayMs: number): number {
  return Math.max(
    DISPATCH_CLAIM_MIN_SECONDS,
    Math.ceil(Math.max(0, delayMs) / 1000) + 30 * 60,
  )
}

export function durableTaskDispatchJobId(
  source: DurableTaskSource,
  sourceJobIdValue: string,
  dispatchToken: string,
): string {
  const sourceJobId = cleanSourceJobId(sourceJobIdValue)
  const cleanToken = String(dispatchToken || "").replace(/-/g, "")
  if (!/^[A-Za-z0-9]{16,160}$/.test(cleanToken)) {
    throw new Error("后台任务派发标识无效")
  }
  return `${source}-${sourceJobId}-${cleanToken}`
}

function isStaleQueueState(state: string): boolean {
  return state === "completed" || state === "failed"
}

export async function inspectDurableTaskDispatch(
  source: DurableTaskSource,
  sourceJobIdValue: string,
  options: { repairStaleClaim?: boolean } = {},
): Promise<DurableTaskDispatchSnapshot> {
  if (!durableTaskQueueEnabled(source)) {
    return {
      backend: "local",
      claimed: false,
      queueState: "local",
      staleClaim: false,
      repaired: false,
    }
  }

  const sourceJobId = cleanSourceJobId(sourceJobIdValue)
  let dispatchToken = await kv.get<string>(dispatchClaimKey(source, sourceJobId))
  if (!dispatchToken) {
    return {
      backend: "bullmq",
      claimed: false,
      queueState: "missing",
      staleClaim: false,
      repaired: false,
    }
  }

  let queuedJob = await queue(source).getJob(
    durableTaskDispatchJobId(source, sourceJobId, dispatchToken),
  )
  if (!queuedJob && options.repairStaleClaim) {
    // The claim is written immediately before BullMQ adds the job. Give a
    // concurrent dispatcher a brief chance to finish before repairing it.
    await new Promise(resolve => setTimeout(resolve, 150))
    const latestToken = await kv.get<string>(dispatchClaimKey(source, sourceJobId))
    if (!latestToken) {
      dispatchToken = ""
    } else {
      dispatchToken = latestToken
      queuedJob = await queue(source).getJob(
        durableTaskDispatchJobId(source, sourceJobId, dispatchToken),
      )
    }
  }
  if (!dispatchToken) {
    return {
      backend: "bullmq",
      claimed: false,
      queueState: "missing",
      staleClaim: false,
      repaired: false,
    }
  }
  const queueState = queuedJob
    ? await queuedJob.getState().catch(() => "unknown" as const)
    : "missing"
  const staleClaim = !queuedJob || isStaleQueueState(queueState)
  let repaired = false
  if (staleClaim && options.repairStaleClaim) {
    await releaseDurableTaskDispatch(source, sourceJobId, dispatchToken)
    repaired = true
  }

  return {
    backend: "bullmq",
    claimed: true,
    queueState,
    staleClaim,
    repaired,
  }
}

export async function enqueueDurableTask(
  source: DurableTaskSource,
  sourceJobIdValue: string,
  options: { delayMs?: number; priority?: number } = {},
): Promise<boolean> {
  if (!durableTaskQueueEnabled(source)) return false
  const sourceJobId = cleanSourceJobId(sourceJobIdValue)
  const delayMs = Math.max(0, Math.min(24 * 60 * 60 * 1000, Math.floor(options.delayMs || 0)))
  const claimKey = dispatchClaimKey(source, sourceJobId)
  let dispatchToken = ""

  for (let attempt = 0; attempt < 2 && !dispatchToken; attempt++) {
    const candidateToken = randomUUID()
    const claimed = await kv.set(claimKey, candidateToken, {
      nx: true,
      ex: dispatchClaimSeconds(delayMs),
    })
    if (claimed) {
      dispatchToken = candidateToken
      break
    }

    const current = await inspectDurableTaskDispatch(source, sourceJobId, {
      repairStaleClaim: true,
    })
    if (!current.staleClaim && current.claimed) return false
  }
  if (!dispatchToken) return false

  const payload: DurableTaskPayload = {
    source,
    sourceJobId,
    dispatchToken,
    queuedAt: new Date().toISOString(),
  }
  const jobOptions: JobsOptions = {
    jobId: durableTaskDispatchJobId(source, sourceJobId, dispatchToken),
    delay: delayMs || undefined,
    priority: options.priority,
  }

  try {
    await queue(source).add(source, payload, jobOptions)
    return true
  } catch (error) {
    await releaseDurableTaskDispatch(source, sourceJobId, dispatchToken)
    throw error
  }
}

export async function cancelQueuedDurableTask(
  source: DurableTaskSource,
  sourceJobIdValue: string,
): Promise<DurableTaskCancellationResult> {
  if (!durableTaskQueueEnabled(source)) return { state: "local" }
  const sourceJobId = cleanSourceJobId(sourceJobIdValue)
  const claimKey = dispatchClaimKey(source, sourceJobId)
  const dispatchToken = await kv.get<string>(claimKey)
  if (!dispatchToken) return { state: "not_found" }

  const jobId = durableTaskDispatchJobId(source, sourceJobId, dispatchToken)
  const queuedJob = await queue(source).getJob(jobId)
  if (!queuedJob) {
    await releaseDurableTaskDispatch(source, sourceJobId, dispatchToken)
    return { state: "not_found" }
  }

  const queueState = await queuedJob.getState()
  if (queueState === "active") return { state: "active", queueState }

  try {
    await queuedJob.remove()
    await releaseDurableTaskDispatch(source, sourceJobId, dispatchToken)
    return { state: "removed", queueState }
  } catch (error) {
    const latestState = await queuedJob.getState().catch(() => queueState)
    if (latestState === "active") return { state: "active", queueState: latestState }
    console.warn(
      "[task-queue] failed to remove cancelled queue item",
      source,
      sourceJobId,
      error instanceof Error ? error.message : error,
    )
    return { state: "not_found", queueState: latestState }
  }
}

export async function refreshDurableTaskDispatch(
  source: DurableTaskSource,
  sourceJobId: string,
  dispatchToken: string,
): Promise<boolean> {
  const key = dispatchClaimKey(source, sourceJobId)
  try {
    const current = await kv.get<string>(key)
    if (current !== dispatchToken) return false
    await kv.set(key, dispatchToken, { ex: DISPATCH_CLAIM_MIN_SECONDS })
    return true
  } catch (error) {
    console.warn(
      "[task-queue] failed to refresh dispatch claim",
      source,
      sourceJobId,
      error instanceof Error ? error.message : error,
    )
    return false
  }
}

export async function releaseDurableTaskDispatch(
  source: DurableTaskSource,
  sourceJobId: string,
  dispatchToken: string,
): Promise<void> {
  const key = dispatchClaimKey(source, sourceJobId)
  try {
    const current = await kv.get<string>(key)
    if (current === dispatchToken) await kv.del(key)
  } catch (error) {
    console.warn(
      "[task-queue] failed to release dispatch claim",
      source,
      sourceJobId,
      error instanceof Error ? error.message : error,
    )
  }
}

export async function dispatchDurableTaskOrFallback(
  source: DurableTaskSource,
  sourceJobId: string,
  fallback: () => void,
  options: { delayMs?: number; priority?: number } = {},
): Promise<void> {
  if (!durableTaskQueueEnabled(source)) {
    fallback()
    return
  }
  try {
    await enqueueDurableTask(source, sourceJobId, options)
  } catch (error) {
    console.error(
      "[task-queue] enqueue failed, using in-process fallback",
      source,
      sourceJobId,
      error instanceof Error ? error.message : error,
    )
    fallback()
  }
}

export async function getDurableTaskQueueSnapshot(
  lane: DurableTaskQueueLane,
): Promise<DurableTaskQueueSnapshot> {
  const queueName = durableTaskQueueNameForLane(lane)
  if (!durableTaskQueueEnabled()) {
    return {
      backend: "local",
      lane,
      queueName,
      reachable: true,
      checkedAt: new Date().toISOString(),
      active: 0,
      waiting: 0,
      delayed: 0,
      failed: 0,
      paused: 0,
      workers: 0,
    }
  }

  const cached = globalState.__geoDurableTaskQueueSnapshots?.get(lane)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  let snapshot: DurableTaskQueueSnapshot
  try {
    const currentQueue = queueForLane(lane)
    const [counts, workers, oldestJobs] = await Promise.all([
      currentQueue.getJobCounts(
        "active",
        "waiting",
        "delayed",
        "failed",
        "paused",
        "prioritized",
      ),
      currentQueue.getWorkersCount(),
      currentQueue.getJobs(
        ["active", "waiting", "delayed", "prioritized"],
        0,
        20,
        true,
      ),
    ])
    const timestamps = oldestJobs
      .map(job => Number(job.timestamp))
      .filter(timestamp => Number.isFinite(timestamp) && timestamp > 0)
    const oldestTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : undefined
    snapshot = {
      backend: "bullmq",
      lane,
      queueName,
      reachable: true,
      checkedAt: new Date().toISOString(),
      active: counts.active || 0,
      waiting: (counts.waiting || 0) + (counts.prioritized || 0),
      delayed: counts.delayed || 0,
      failed: counts.failed || 0,
      paused: counts.paused || 0,
      workers,
      oldestQueuedAt: oldestTimestamp
        ? new Date(oldestTimestamp).toISOString()
        : undefined,
      oldestAgeMs: oldestTimestamp
        ? Math.max(0, Date.now() - oldestTimestamp)
        : undefined,
    }
  } catch (error) {
    snapshot = {
      backend: "bullmq",
      lane,
      queueName,
      reachable: false,
      checkedAt: new Date().toISOString(),
      active: 0,
      waiting: 0,
      delayed: 0,
      failed: 0,
      paused: 0,
      workers: 0,
      error: error instanceof Error ? error.message : "队列状态读取失败",
    }
  }

  const cache = globalState.__geoDurableTaskQueueSnapshots
    || new Map<
      DurableTaskQueueLane,
      { expiresAt: number; value: DurableTaskQueueSnapshot }
    >()
  globalState.__geoDurableTaskQueueSnapshots = cache
  cache.set(lane, {
    expiresAt: Date.now() + QUEUE_SNAPSHOT_CACHE_MS,
    value: snapshot,
  })
  return snapshot
}

export async function recordDurableTaskWorkerHeartbeat(
  input: Omit<DurableTaskWorkerHeartbeat, "heartbeatAt">,
): Promise<DurableTaskWorkerHeartbeat> {
  const workerId = String(input.workerId || "").trim()
  if (!/^[A-Za-z0-9_.:-]{3,200}$/.test(workerId)) {
    throw new Error("Worker 标识无效")
  }
  const heartbeat: DurableTaskWorkerHeartbeat = {
    workerId,
    startedAt: input.startedAt,
    heartbeatAt: new Date().toISOString(),
    queues: input.queues.map(item => ({
      lane: item.lane,
      queueName: String(item.queueName || "").slice(0, 220),
      concurrency: Math.max(1, Math.min(100, Math.floor(item.concurrency || 1))),
    })),
  }
  await kv.set(
    workerHeartbeatKey(workerId),
    heartbeat,
    { ex: WORKER_HEARTBEAT_TTL_SECONDS },
  )
  await kv.sadd(WORKER_HEARTBEAT_SET_KEY, workerId)
  return heartbeat
}

async function readDurableTaskWorkerHeartbeats(): Promise<
  DurableTaskWorkerHeartbeat[]
> {
  const workerIds = await kv.smembers<string[]>(WORKER_HEARTBEAT_SET_KEY)
  if (workerIds.length === 0) return []
  const records = await Promise.all(
    workerIds.map(async workerId => ({
      workerId,
      heartbeat: await kv.get<DurableTaskWorkerHeartbeat>(
        workerHeartbeatKey(workerId),
      ),
    })),
  )
  const staleIds = records
    .filter(item => !item.heartbeat)
    .map(item => item.workerId)
  if (staleIds.length > 0) {
    await kv.srem(WORKER_HEARTBEAT_SET_KEY, ...staleIds)
  }
  return records
    .map(item => item.heartbeat)
    .filter((item): item is DurableTaskWorkerHeartbeat => Boolean(item))
    .sort((left, right) => right.heartbeatAt.localeCompare(left.heartbeatAt))
}

export async function getDurableTaskWorkerHeartbeats(): Promise<
  DurableTaskWorkerHeartbeat[]
> {
  try {
    return await readDurableTaskWorkerHeartbeats()
  } catch (error) {
    console.warn(
      "[task-queue] worker heartbeat read failed",
      error instanceof Error ? error.message : error,
    )
    return []
  }
}

export async function removeDurableTaskWorkerHeartbeat(
  workerId: string,
): Promise<void> {
  await kv.del(workerHeartbeatKey(workerId))
  await kv.srem(WORKER_HEARTBEAT_SET_KEY, workerId)
}

export function isDurableTaskSource(value: unknown): value is DurableTaskSource {
  return [
    "penetration",
    "difficulty",
    "background",
    "question",
    "articleBatch",
    "report",
  ].includes(String(value) as TaskCenterSource)
}

export async function closeDurableTaskQueue(): Promise<void> {
  const queues = [...(globalState.__geoDurableTaskQueues?.values() || [])]
  globalState.__geoDurableTaskQueues = undefined
  globalState.__geoDurableTaskQueueSnapshots = undefined
  await Promise.all(queues.map(current => current.close()))
}
