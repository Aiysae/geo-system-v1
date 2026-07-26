import "server-only"

import { kv } from "@/lib/kv"
import {
  cancelQueuedDurableTask,
  type DurableTaskCancellationResult,
  type DurableTaskSource,
} from "@/lib/task-queue"

export type TaskCancellationRequest = {
  source: DurableTaskSource
  sourceJobId: string
  requestedBy: string
  requestedAt: string
}

const CANCELLATION_TTL_SECONDS = 60 * 60 * 24
const DEFAULT_POLL_INTERVAL_MS = 500
const localControllers = new Map<string, Set<AbortController>>()

function cancellationKey(source: DurableTaskSource, sourceJobId: string): string {
  return `geo:task-cancellation:${source}:${sourceJobId}`
}

function localKey(source: DurableTaskSource, sourceJobId: string): string {
  return `${source}:${sourceJobId}`
}

export async function requestTaskCancellation(
  source: DurableTaskSource,
  sourceJobId: string,
  requestedBy: string,
): Promise<TaskCancellationRequest> {
  const request: TaskCancellationRequest = {
    source,
    sourceJobId,
    requestedBy,
    requestedAt: new Date().toISOString(),
  }
  await kv.set(cancellationKey(source, sourceJobId), request, {
    ex: CANCELLATION_TTL_SECONDS,
  })
  return request
}

export async function signalTaskCancellation(
  source: DurableTaskSource,
  sourceJobId: string,
  requestedBy: string,
): Promise<DurableTaskCancellationResult> {
  try {
    await requestTaskCancellation(source, sourceJobId, requestedBy)
  } catch (error) {
    console.warn(
      "[task-cancellation] failed to persist shared cancellation signal",
      source,
      sourceJobId,
      error instanceof Error ? error.message : error,
    )
  }
  abortLocalTask(source, sourceJobId)
  try {
    return await cancelQueuedDurableTask(source, sourceJobId)
  } catch (error) {
    console.warn(
      "[task-cancellation] queue cancellation failed after signal",
      source,
      sourceJobId,
      error instanceof Error ? error.message : error,
    )
    return { state: "active" }
  }
}

export async function getTaskCancellationRequest(
  source: DurableTaskSource,
  sourceJobId: string,
): Promise<TaskCancellationRequest | null> {
  const value = await kv.get<TaskCancellationRequest>(
    cancellationKey(source, sourceJobId),
  )
  return value?.source === source && value.sourceJobId === sourceJobId
    ? value
    : null
}

export async function isTaskCancellationRequested(
  source: DurableTaskSource,
  sourceJobId: string,
): Promise<boolean> {
  return Boolean(await getTaskCancellationRequest(source, sourceJobId))
}

export async function clearTaskCancellation(
  source: DurableTaskSource,
  sourceJobId: string,
): Promise<void> {
  await kv.del(cancellationKey(source, sourceJobId))
}

export function registerTaskAbortController(
  source: DurableTaskSource,
  sourceJobId: string,
  controller: AbortController,
): () => void {
  const key = localKey(source, sourceJobId)
  const controllers = localControllers.get(key) || new Set<AbortController>()
  controllers.add(controller)
  localControllers.set(key, controllers)

  void isTaskCancellationRequested(source, sourceJobId)
    .then(requested => {
      if (requested && !controller.signal.aborted) controller.abort()
    })
    .catch(error => {
      console.warn(
        "[task-cancellation] initial cancellation check failed",
        source,
        sourceJobId,
        error instanceof Error ? error.message : error,
      )
    })

  return () => {
    controllers.delete(controller)
    if (controllers.size === 0) localControllers.delete(key)
  }
}

export function abortLocalTask(
  source: DurableTaskSource,
  sourceJobId: string,
): number {
  const controllers = localControllers.get(localKey(source, sourceJobId))
  if (!controllers) return 0
  let aborted = 0
  for (const controller of controllers) {
    if (controller.signal.aborted) continue
    controller.abort()
    aborted += 1
  }
  return aborted
}

export function startTaskCancellationMonitor(
  source: DurableTaskSource,
  sourceJobId: string,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
): () => void {
  let stopped = false
  let checking = false

  const check = async () => {
    if (stopped || checking) return
    checking = true
    try {
      if (await isTaskCancellationRequested(source, sourceJobId)) {
        abortLocalTask(source, sourceJobId)
      }
    } catch (error) {
      console.warn(
        "[task-cancellation] monitor check failed",
        source,
        sourceJobId,
        error instanceof Error ? error.message : error,
      )
    } finally {
      checking = false
    }
  }

  void check()
  const timer = setInterval(
    () => void check(),
    Math.max(250, Math.min(5_000, Math.floor(intervalMs))),
  )
  timer.unref()

  return () => {
    stopped = true
    clearInterval(timer)
  }
}

export function isTaskAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === "AbortError"
    || /用户已停止|任务已停止|请求已停止|operation was aborted|this operation was aborted/i.test(
      error.message,
    )
}
