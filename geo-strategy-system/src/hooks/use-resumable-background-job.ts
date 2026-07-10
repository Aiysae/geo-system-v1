"use client"

import { useEffect, useRef, useState } from "react"
import {
  BackgroundJobRequestError,
  createBackgroundJob,
  getBackgroundJob,
} from "@/lib/background-job-client"
import type {
  BackgroundJobKind,
  BackgroundJobRecord,
  BackgroundJobRef,
} from "@/types"

interface Options<TResult> {
  kind: BackgroundJobKind
  clientId: string
  jobRef?: BackgroundJobRef
  payload: unknown
  pollIntervalMs?: number
  onAccepted: (job: BackgroundJobRecord<TResult>) => void
  onSucceeded: (job: BackgroundJobRecord<TResult>) => void
  onFailed: (message: string, job?: BackgroundJobRecord<TResult>) => void
  onCancelled?: (job: BackgroundJobRecord<TResult>) => void
}

function retryDelay(attempt: number): number {
  return Math.min(15_000, 1500 * Math.max(1, 2 ** Math.min(attempt, 3)))
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve()
    const timer = window.setTimeout(resolve, ms)
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

export function useResumableBackgroundJob<TResult>(options: Options<TResult>) {
  const [currentJob, setCurrentJob] = useState<BackgroundJobRecord<TResult> | null>(null)
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null)
  const latest = useRef(options)

  useEffect(() => {
    latest.current = options
  }, [options])

  const requestId = options.jobRef?.requestId
  const jobId = options.jobRef?.jobId
  const active = Boolean(requestId)
  const pollIntervalMs = options.pollIntervalMs || 2000

  useEffect(() => {
    if (!active || !requestId) return
    const activeRequestId = requestId
    const controller = new AbortController()
    let stopped = false

    async function recoverOrPoll() {
      if (!jobId) {
        let failures = 0
        while (!stopped) {
          try {
            const job = await createBackgroundJob<TResult>({
              kind: latest.current.kind,
              clientId: latest.current.clientId,
              requestId: activeRequestId,
              payload: latest.current.jobRef?.payload ?? latest.current.payload,
              signal: controller.signal,
            })
            if (stopped) return
            if (job.clientId !== latest.current.clientId) {
              latest.current.onFailed("后台任务与当前客户不匹配，已停止同步以避免数据串用。")
              return
            }
            setCurrentJob(job)
            setConnectionNotice(null)
            latest.current.onAccepted(job)
            return
          } catch (error) {
            if (stopped || controller.signal.aborted) return
            if (error instanceof BackgroundJobRequestError && !error.retryable) {
              latest.current.onFailed(error.message)
              return
            }
            failures += 1
            setConnectionNotice("网络暂时中断，正在确认任务是否已提交；请勿重复点击。")
            await delay(retryDelay(failures), controller.signal)
          }
        }
        return
      }

      let failures = 0
      while (!stopped) {
        try {
          const job = await getBackgroundJob<TResult>(jobId, controller.signal)
          if (stopped) return
          if (job.clientId !== latest.current.clientId) {
            latest.current.onFailed("后台任务与当前客户不匹配，已停止同步以避免数据串用。", job)
            return
          }
          failures = 0
          setCurrentJob(job)
          setConnectionNotice(null)

          if (job.status === "succeeded") {
            latest.current.onSucceeded(job)
            return
          }
          if (job.status === "failed") {
            latest.current.onFailed(job.error || "后台任务失败", job)
            return
          }
          if (job.status === "cancelled") {
            if (latest.current.onCancelled) latest.current.onCancelled(job)
            else latest.current.onFailed(job.error || "后台任务已停止", job)
            return
          }
          await delay(pollIntervalMs, controller.signal)
        } catch (error) {
          if (stopped || controller.signal.aborted) return
          if (error instanceof BackgroundJobRequestError && !error.retryable) {
            latest.current.onFailed(error.message)
            return
          }
          failures += 1
          setConnectionNotice("网络暂时中断，任务仍在服务器后台执行，恢复后会自动同步结果。")
          await delay(retryDelay(failures), controller.signal)
        }
      }
    }

    void recoverOrPoll()
    return () => {
      stopped = true
      controller.abort()
    }
  }, [active, jobId, pollIntervalMs, requestId])

  return {
    currentJob: active ? currentJob : null,
    connectionNotice: active
      ? connectionNotice || (!jobId ? "正在建立后台任务..." : null)
      : null,
  }
}
