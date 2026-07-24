"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  Bell,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  LoaderCircle,
  RefreshCw,
  X,
  XCircle,
} from "lucide-react"
import {
  isTaskCenterTerminalStatus,
  type TaskCenterListResponse,
  type TaskCenterStatus,
  type TaskCenterTask,
} from "@/types/task-center"

const EMPTY_RESPONSE: TaskCenterListResponse = {
  tasks: [],
  activeCount: 0,
  unreadCount: 0,
  serverTime: "",
}

const STATUS_LABELS: Record<TaskCenterStatus, string> = {
  queued: "等待处理",
  running: "处理中",
  retrying: "正在重试",
  succeeded: "已完成",
  partial: "部分完成",
  failed: "失败",
  cancelled: "已停止",
  blocked: "需要处理",
}

const MODULE_LABELS = {
  penetration: "渗透率情报",
  research: "独立调研",
  diagnosis: "AI 诊断",
  difficulty: "难度测评",
  keyword: "关键词策略",
  article: "文章生成",
  report: "专业报告",
} as const

function displayedStorageKey(userId: string): string {
  return `geo:task-center:displayed:${userId}`
}

function readDisplayedIds(userId: string): Set<string> {
  try {
    const value = JSON.parse(sessionStorage.getItem(displayedStorageKey(userId)) || "[]")
    return new Set(Array.isArray(value) ? value.map(String).slice(-200) : [])
  } catch {
    return new Set()
  }
}

function saveDisplayedIds(userId: string, ids: Set<string>): void {
  try {
    sessionStorage.setItem(
      displayedStorageKey(userId),
      JSON.stringify(Array.from(ids).slice(-200)),
    )
  } catch {
    // Private browsing can reject sessionStorage. Notifications still work in this tab.
  }
}

function timeLabel(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return ""
  const diffMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
  if (diffMinutes < 1) return "刚刚"
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`
  if (diffMinutes < 24 * 60) return `${Math.floor(diffMinutes / 60)} 小时前`
  return new Date(timestamp).toLocaleDateString("zh-CN")
}

function statusTone(status: TaskCenterStatus): string {
  if (status === "succeeded") return "text-emerald-600 bg-emerald-50 ring-emerald-200"
  if (status === "failed" || status === "blocked") return "text-rose-600 bg-rose-50 ring-rose-200"
  if (status === "cancelled") return "text-slate-500 bg-slate-100 ring-slate-200"
  if (status === "partial") return "text-amber-700 bg-amber-50 ring-amber-200"
  return "text-[#0958D9] bg-[#EAF5FF] ring-[#B7D9FF]"
}

function TerminalStatusIcon({
  status,
  className,
}: {
  status: TaskCenterStatus
  className?: string
}) {
  if (status === "succeeded") return <CheckCircle2 className={className} />
  if (status === "failed" || status === "blocked") {
    return <XCircle className={className} />
  }
  return <CircleAlert className={className} />
}

export function GlobalTaskCenter({ userId }: { userId: string }) {
  const [snapshot, setSnapshot] = useState<TaskCenterListResponse>(EMPTY_RESPONSE)
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [toasts, setToasts] = useState<TaskCenterTask[]>([])
  const previousStatusesRef = useRef(new Map<string, TaskCenterStatus>())
  const displayedIdsRef = useRef<Set<string>>(new Set())
  const initializedRef = useRef(false)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const activeCountRef = useRef(0)

  const rememberDisplayed = useCallback((id: string, broadcast = true) => {
    displayedIdsRef.current.add(id)
    saveDisplayedIds(userId, displayedIdsRef.current)
    if (broadcast) channelRef.current?.postMessage({ type: "displayed", id })
  }, [userId])

  const applyResponse = useCallback((next: TaskCenterListResponse) => {
    const previous = previousStatusesRef.current
    const displayed = displayedIdsRef.current
    const recentCutoff = Date.now() - 24 * 60 * 60 * 1000
    const completed = next.tasks
      .filter(task => task.unread && isTaskCenterTerminalStatus(task.status))
      .filter(task => {
        if (displayed.has(task.id)) return false
        const prior = previous.get(task.id)
        if (initializedRef.current) {
          return prior !== task.status
        }
        const finishedAt = Date.parse(task.finishedAt || task.updatedAt)
        return Number.isFinite(finishedAt) && finishedAt >= recentCutoff
      })
      .slice(0, 3)

    for (const task of completed) rememberDisplayed(task.id)
    if (completed.length > 0) {
      setToasts(current => {
        const known = new Set(current.map(task => task.id))
        return [...current, ...completed.filter(task => !known.has(task.id))].slice(-3)
      })
    }

    previousStatusesRef.current = new Map(next.tasks.map(task => [task.id, task.status]))
    initializedRef.current = true
    activeCountRef.current = next.activeCount
    setSnapshot(next)
  }, [rememberDisplayed])

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/task-center?limit=60", {
        cache: "no-store",
        credentials: "same-origin",
        signal,
      })
      if (!response.ok) {
        if (response.status === 401) return
        throw new Error("任务状态读取失败")
      }
      const body = await response.json() as TaskCenterListResponse
      applyResponse(body)
      setError("")
    } catch (refreshError) {
      if (signal?.aborted) return
      setError(refreshError instanceof Error ? refreshError.message : "任务状态读取失败")
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [applyResponse])

  useEffect(() => {
    const mountedTimer = setTimeout(() => {
      setMounted(true)
    }, 0)
    displayedIdsRef.current = readDisplayedIds(userId)
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(`geo-task-center:${userId}`)
      channel.onmessage = event => {
        const payload = event.data as { type?: string; id?: string }
        if (payload.type === "displayed" && payload.id) {
          rememberDisplayed(payload.id, false)
          setToasts(current => current.filter(task => task.id !== payload.id))
        }
      }
      channelRef.current = channel
    }
    return () => {
      clearTimeout(mountedTimer)
      channelRef.current?.close()
      channelRef.current = null
    }
  }, [rememberDisplayed, userId])

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    const schedule = async () => {
      await refresh(controller.signal)
      if (stopped) return
      const hidden = document.visibilityState === "hidden"
      const delay = activeCountRef.current > 0
        ? hidden ? 8_000 : 3_000
        : hidden ? 30_000 : 15_000
      timer = setTimeout(schedule, delay)
    }
    void schedule()

    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh(controller.signal)
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stopped = true
      controller.abort()
      if (timer) clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [refresh])

  useEffect(() => {
    if (toasts.length === 0) return
    const timer = setTimeout(() => setToasts(current => current.slice(1)), 12_000)
    return () => clearTimeout(timer)
  }, [toasts])

  const markRead = useCallback(async (taskId: string) => {
    setSnapshot(current => ({
      ...current,
      tasks: current.tasks.map(task => task.id === taskId ? { ...task, unread: false } : task),
      unreadCount: Math.max(0, current.unreadCount - (
        current.tasks.find(task => task.id === taskId)?.unread ? 1 : 0
      )),
    }))
    await fetch(`/api/task-center/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      credentials: "same-origin",
      cache: "no-store",
    }).catch(() => undefined)
  }, [])

  const markAllRead = useCallback(async () => {
    setSnapshot(current => ({
      ...current,
      unreadCount: 0,
      tasks: current.tasks.map(task => ({ ...task, unread: false })),
    }))
    await fetch("/api/task-center", {
      method: "PATCH",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_all_read" }),
    }).catch(() => undefined)
  }, [])

  const activeTasks = useMemo(
    () => snapshot.tasks.filter(task => !isTaskCenterTerminalStatus(task.status)),
    [snapshot.tasks],
  )
  const recentTasks = useMemo(
    () => snapshot.tasks.filter(task => isTaskCenterTerminalStatus(task.status)).slice(0, 30),
    [snapshot.tasks],
  )

  const panel = mounted ? createPortal(
    <>
      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[78] cursor-default bg-[#00133F]/28 backdrop-blur-[1px]"
            aria-label="关闭任务中心"
            onClick={() => setOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="global-task-center-title"
            className="fixed inset-y-0 right-0 z-[79] flex w-full max-w-md flex-col bg-white shadow-[-24px_0_70px_-32px_rgba(0,29,102,0.72)] sm:inset-y-3 sm:right-3 sm:rounded-lg sm:ring-1 sm:ring-[#B7D9FF]"
          >
            <div className="flex items-center justify-between border-b border-[#DDEBFA] px-4 py-3.5">
              <div>
                <h2 id="global-task-center-title" className="text-base font-semibold text-slate-900">
                  任务中心
                </h2>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {snapshot.activeCount > 0 ? `${snapshot.activeCount} 个任务正在处理` : "当前没有进行中的任务"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-[#EEF5FC] hover:text-[#0958D9]"
                  aria-label="刷新任务状态"
                  title="刷新任务状态"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100"
                  aria-label="关闭任务中心"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3">
              {error ? (
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="mb-3 flex w-full items-center justify-between rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-left text-xs text-rose-700"
                >
                  <span>{error}</span>
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              ) : null}

              {activeTasks.length > 0 ? (
                <section>
                  <h3 className="px-1 pb-2 text-[11px] font-semibold text-slate-500">进行中</h3>
                  <div className="space-y-2">
                    {activeTasks.map(task => <TaskRow key={task.id} task={task} onRead={markRead} />)}
                  </div>
                </section>
              ) : null}

              <section className={activeTasks.length > 0 ? "mt-5" : ""}>
                <div className="flex items-center justify-between px-1 pb-2">
                  <h3 className="text-[11px] font-semibold text-slate-500">最近任务</h3>
                  {snapshot.unreadCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => void markAllRead()}
                      className="text-[11px] font-semibold text-[#0958D9] hover:text-[#1677FF]"
                    >
                      全部已读
                    </button>
                  ) : null}
                </div>
                {recentTasks.length > 0 ? (
                  <div className="space-y-2">
                    {recentTasks.map(task => <TaskRow key={task.id} task={task} onRead={markRead} />)}
                  </div>
                ) : (
                  <div className="flex min-h-40 flex-col items-center justify-center text-center text-xs text-slate-400">
                    <Clock3 className="mb-2 h-7 w-7 text-slate-300" />
                    还没有后台任务记录
                  </div>
                )}
              </section>
            </div>
          </aside>
        </>
      ) : null}

      <div className="pointer-events-none fixed right-4 top-20 z-[82] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2 sm:right-6">
        {toasts.map(task => {
          return (
            <div
              key={task.id}
              className="pointer-events-auto overflow-hidden rounded-lg border border-[#B7D9FF] bg-white shadow-[0_22px_60px_-26px_rgba(0,65,160,0.65)]"
              role="status"
            >
              <div className="flex items-start gap-3 p-3.5">
                <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ring-1 ${statusTone(task.status)}`}>
                  <TerminalStatusIcon status={task.status} className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{task.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                    {task.error || task.stage || STATUS_LABELS[task.status]}
                  </p>
                  <div className="mt-2 flex items-center gap-3">
                    {task.resultUrl ? (
                      <a
                        href={task.resultUrl}
                        onClick={() => {
                          void markRead(task.id)
                          setToasts(current => current.filter(item => item.id !== task.id))
                        }}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#0958D9]"
                      >
                        查看结果
                        <ChevronRight className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setToasts(current => current.filter(item => item.id !== task.id))}
                      className="text-xs text-slate-400 hover:text-slate-600"
                    >
                      稍后查看
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setToasts(current => current.filter(item => item.id !== task.id))}
                  className="text-slate-300 hover:text-slate-500"
                  aria-label="关闭完成提醒"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </>,
    document.body,
  ) : null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-white/18 bg-white/8 text-white transition hover:bg-white/14"
        aria-label="打开任务中心"
        title={snapshot.activeCount > 0 ? `${snapshot.activeCount} 个任务正在处理` : "任务中心"}
      >
        <Bell className="h-4 w-4" />
        {snapshot.activeCount > 0 ? (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-cyan-300 ring-2 ring-[#001D66]" />
        ) : null}
        {snapshot.unreadCount > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold leading-4 text-white ring-2 ring-[#001D66]">
            {snapshot.unreadCount > 99 ? "99+" : snapshot.unreadCount}
          </span>
        ) : null}
      </button>
      {panel}
    </>
  )
}

function TaskRow({
  task,
  onRead,
}: {
  task: TaskCenterTask
  onRead: (taskId: string) => Promise<void>
}) {
  const active = !isTaskCenterTerminalStatus(task.status)
  return (
    <div className={`relative rounded-lg border bg-white p-3 ${
      task.unread ? "border-[#91CAFF] shadow-[0_10px_24px_-22px_rgba(22,119,255,0.72)]" : "border-slate-200"
    }`}>
      {task.unread ? <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-[#1677FF]" /> : null}
      <div className="flex items-start gap-2.5 pr-3">
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ring-1 ${statusTone(task.status)}`}>
          {active ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <TerminalStatusIcon status={task.status} className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate text-xs font-semibold text-slate-900">{task.title}</p>
            <span className="text-[10px] text-slate-400">{MODULE_LABELS[task.module]}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">
            {task.error || task.stage || STATUS_LABELS[task.status]}
          </p>
          {active ? (
            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#1677FF] to-[#00C8FF] transition-[width]"
                  style={{ width: `${Math.max(3, task.progressPercent)}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                <span>{STATUS_LABELS[task.status]}</span>
                <span>{task.progressPercent}%</span>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[10px] text-slate-400">
                {task.clientName || (task.scope === "workspace" ? "客户专属账号任务" : "")}
                {task.finishedAt ? ` · ${timeLabel(task.finishedAt)}` : ""}
              </span>
              {task.resultUrl ? (
                <a
                  href={task.resultUrl}
                  onClick={() => void onRead(task.id)}
                  className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-[#0958D9]"
                >
                  查看
                  <ChevronRight className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
