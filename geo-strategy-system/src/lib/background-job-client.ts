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
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(status)
}

async function requestJob<TResult>(
  input: RequestInfo | URL,
  init: RequestInit,
  label: string,
): Promise<BackgroundJobRecord<TResult>> {
  let response: Response
  try {
    response = await apiFetch(input, init)
  } catch (error) {
    throw new BackgroundJobRequestError(
      error instanceof Error ? error.message : `${label}网络连接中断`,
      true,
    )
  }

  let data: BackgroundJobRecord<TResult> & { error?: string }
  try {
    data = await readApiJson(response, label)
  } catch (error) {
    throw new BackgroundJobRequestError(
      error instanceof Error ? error.message : `${label}返回异常`,
      retryableStatus(response.status),
    )
  }

  if (!response.ok) {
    throw new BackgroundJobRequestError(
      data.error || `${label}失败（HTTP ${response.status}）`,
      retryableStatus(response.status),
    )
  }
  return data
}

export async function createBackgroundJob<TResult>(args: {
  kind: BackgroundJobKind
  clientId: string
  requestId: string
  payload: unknown
  signal?: AbortSignal
}): Promise<BackgroundJobRecord<TResult>> {
  return requestJob<TResult>(
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
  return requestJob<TResult>(
    `/api/background-jobs/${encodeURIComponent(jobId)}`,
    { method: "GET", cache: "no-store", signal },
    "后台任务查询",
  )
}

export async function cancelBackgroundJob<TResult>(
  jobId: string,
): Promise<BackgroundJobRecord<TResult>> {
  return requestJob<TResult>(
    `/api/background-jobs/${encodeURIComponent(jobId)}`,
    { method: "PATCH", cache: "no-store" },
    "后台任务停止",
  )
}
