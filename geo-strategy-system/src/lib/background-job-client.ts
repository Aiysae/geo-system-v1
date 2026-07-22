"use client"

import { apiFetch, readApiJson } from "@/lib/api-fetch"
import type {
  BackgroundJobKind,
  BackgroundJobRecord,
} from "@/types"

export class BackgroundJobRequestError extends Error {
  readonly retryable: boolean

  constructor(message: string, retryable: boolean) {
    super(message)
    this.name = "BackgroundJobRequestError"
    this.retryable = retryable
  }
}

function retryableStatus(status: number): boolean {
  return [408, 409, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530].includes(status)
}

const BACKGROUND_JOB_REQUEST_TIMEOUT_MS = 20_000

function requestSignal(parent?: AbortSignal | null): {
  signal: AbortSignal
  cleanup: () => void
} {
  const controller = new AbortController()
  const abortFromParent = () => controller.abort(parent?.reason)
  if (parent?.aborted) abortFromParent()
  else parent?.addEventListener("abort", abortFromParent, { once: true })
  const timer = window.setTimeout(() => controller.abort(), BACKGROUND_JOB_REQUEST_TIMEOUT_MS)

  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timer)
      parent?.removeEventListener("abort", abortFromParent)
    },
  }
}

export function createBackgroundRequestId(prefix: string): string {
  const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
  return `${prefix}_${suffix}`
}

async function requestApiJson<TResult>(
  input: RequestInfo | URL,
  init: RequestInit,
  label: string,
): Promise<TResult> {
  const scopedSignal = requestSignal(init.signal)
  try {
    let response: Response
    try {
      response = await apiFetch(input, { ...init, signal: scopedSignal.signal })
    } catch (error) {
      throw new BackgroundJobRequestError(
        error instanceof Error ? error.message : `${label}网络连接中断`,
        true,
      )
    }

    let data: TResult & { error?: string }
    try {
      data = await readApiJson(response, label)
    } catch (error) {
      const redirectedToAuth = response.redirected && /\/(?:sign-in|sign-up)(?:\/|\?|$)/.test(response.url)
      if (redirectedToAuth) {
        throw new BackgroundJobRequestError("登录状态已失效，请重新登录后查看任务结果。", false)
      }
      throw new BackgroundJobRequestError(
        error instanceof Error ? error.message : `${label}返回异常`,
        response.ok || response.status >= 500 || retryableStatus(response.status),
      )
    }

    if (!response.ok) {
      throw new BackgroundJobRequestError(
        data.error || `${label}失败（HTTP ${response.status}）`,
        retryableStatus(response.status),
      )
    }
    return data
  } finally {
    scopedSignal.cleanup()
  }
}

function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve()
    const timer = window.setTimeout(resolve, ms)
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

export async function createIdempotentApiJob<TResult>(args: {
  endpoint: string
  requestId: string
  payload: Record<string, unknown>
  label: string
  signal?: AbortSignal
  maxAttempts?: number
  onRetry?: (message: string, attempt: number) => void
}): Promise<TResult> {
  const maxAttempts = Math.max(1, Math.min(20, args.maxAttempts || 12))
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await requestApiJson<TResult>(
        args.endpoint,
        {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...args.payload, requestId: args.requestId }),
          signal: args.signal,
        },
        args.label,
      )
    } catch (error) {
      lastError = error
      if (args.signal?.aborted) throw error
      if (!(error instanceof BackgroundJobRequestError) || !error.retryable || attempt >= maxAttempts) {
        throw error
      }
      args.onRetry?.(error.message, attempt)
      await waitForRetry(Math.min(10_000, 1500 * 2 ** Math.min(attempt - 1, 3)), args.signal)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${args.label}失败`)
}

export async function createBackgroundJob<TResult>(args: {
  kind: BackgroundJobKind
  clientId: string
  requestId: string
  payload: unknown
  signal?: AbortSignal
}): Promise<BackgroundJobRecord<TResult>> {
  return requestApiJson<BackgroundJobRecord<TResult>>(
    "/api/background-jobs",
    {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: args.kind,
        clientId: args.clientId,
        requestId: args.requestId,
        payload: args.payload,
      }),
      signal: args.signal,
    },
    "后台任务创建",
  )
}

export async function getBackgroundJob<TResult>(
  jobId: string,
  signal?: AbortSignal,
): Promise<BackgroundJobRecord<TResult>> {
  return requestApiJson<BackgroundJobRecord<TResult>>(
    `/api/background-jobs/${encodeURIComponent(jobId)}`,
    { method: "GET", cache: "no-store", signal },
    "后台任务查询",
  )
}

export async function cancelBackgroundJob<TResult>(
  jobId: string,
): Promise<BackgroundJobRecord<TResult>> {
  return requestApiJson<BackgroundJobRecord<TResult>>(
    `/api/background-jobs/${encodeURIComponent(jobId)}`,
    { method: "PATCH", cache: "no-store" },
    "后台任务停止",
  )
}
