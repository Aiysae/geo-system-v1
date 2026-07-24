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

type TaskQueueGlobal = typeof globalThis & {
  __geoDurableTaskQueue?: Queue<DurableTaskPayload>
}

const globalState = globalThis as TaskQueueGlobal
const DEFAULT_QUEUE_NAME = "geo-long-tasks-v1"
const DISPATCH_CLAIM_MIN_SECONDS = 30 * 60
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

function queue(): Queue<DurableTaskPayload> {
  if (globalState.__geoDurableTaskQueue) return globalState.__geoDurableTaskQueue
  globalState.__geoDurableTaskQueue = new Queue<DurableTaskPayload>(
    durableTaskQueueName(),
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
  globalState.__geoDurableTaskQueue.on("error", error => {
    console.error("[task-queue] queue error", error.message)
  })
  return globalState.__geoDurableTaskQueue
}

function dispatchClaimKey(source: DurableTaskSource, sourceJobId: string): string {
  return `geo:task-queue:dispatch:${source}:${sourceJobId}`
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

export async function enqueueDurableTask(
  source: DurableTaskSource,
  sourceJobIdValue: string,
  options: { delayMs?: number; priority?: number } = {},
): Promise<boolean> {
  if (!durableTaskQueueEnabled(source)) return false
  const sourceJobId = cleanSourceJobId(sourceJobIdValue)
  const delayMs = Math.max(0, Math.min(24 * 60 * 60 * 1000, Math.floor(options.delayMs || 0)))
  const dispatchToken = randomUUID()
  const claimKey = dispatchClaimKey(source, sourceJobId)
  const claimed = await kv.set(claimKey, dispatchToken, {
    nx: true,
    ex: dispatchClaimSeconds(delayMs),
  })
  if (!claimed) return false

  const payload: DurableTaskPayload = {
    source,
    sourceJobId,
    dispatchToken,
    queuedAt: new Date().toISOString(),
  }
  const jobOptions: JobsOptions = {
    jobId: `${source}-${sourceJobId}-${dispatchToken.replace(/-/g, "")}`,
    delay: delayMs || undefined,
    priority: options.priority,
  }

  try {
    await queue().add(source, payload, jobOptions)
    return true
  } catch (error) {
    await releaseDurableTaskDispatch(source, sourceJobId, dispatchToken)
    throw error
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
  const current = globalState.__geoDurableTaskQueue
  globalState.__geoDurableTaskQueue = undefined
  if (current) await current.close()
}
