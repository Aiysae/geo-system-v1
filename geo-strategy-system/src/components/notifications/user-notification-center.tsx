"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  CalendarCheck2,
  BellRing,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Inbox,
  ReceiptText,
  TriangleAlert,
  X,
} from "lucide-react"
import type {
  UserNotification,
  UserNotificationSnapshot,
  UserNotificationType,
} from "@/lib/admin-payment-request-types"

const POLL_INTERVAL_MS = 20_000

function notificationMeta(
  type: UserNotificationType,
  metadata?: Record<string, unknown>,
) {
  if (type === "penetration_automation_completed") {
    return {
      Icon: CheckCircle2,
      iconClass: "bg-emerald-50 text-emerald-700 ring-emerald-200",
      actionLabel: "查看报告",
    }
  }
  if (type === "penetration_automation_alert") {
    return {
      Icon: TriangleAlert,
      iconClass: "bg-rose-50 text-rose-700 ring-rose-200",
      actionLabel: "查看报告",
    }
  }
  if (type === "penetration_automation_attention") {
    return {
      Icon: BellRing,
      iconClass: "bg-amber-50 text-amber-700 ring-amber-200",
      actionLabel: "去处理",
    }
  }
  if (type === "feedback_action_reminder") {
    return {
      Icon: CalendarCheck2,
      iconClass: "bg-cyan-50 text-cyan-700 ring-cyan-200",
      actionLabel: metadata?.canEdit === false ? "查看进度" : "去录入",
    }
  }
  if (type === "feedback_report_sent") {
    return {
      Icon: CalendarCheck2,
      iconClass: "bg-emerald-50 text-emerald-700 ring-emerald-200",
      actionLabel: "查看报告",
    }
  }
  if (type === "feedback_report_attention") {
    return {
      Icon: TriangleAlert,
      iconClass: "bg-amber-50 text-amber-700 ring-amber-200",
      actionLabel: "去处理",
    }
  }
  if (type === "payment_request_credited") {
    return {
      Icon: CheckCircle2,
      iconClass: "bg-emerald-50 text-emerald-600 ring-emerald-200",
      actionLabel: "查看到账记录",
    }
  }
  return {
    Icon: ReceiptText,
    iconClass: "bg-white text-[#1677FF] ring-[#B7D9FF]",
    actionLabel: "查看订单",
  }
}

export function UserNotificationCenter({
  variant = "light",
}: {
  variant?: "workspace" | "light"
}) {
  const [snapshot, setSnapshot] = useState<UserNotificationSnapshot>({
    unreadCount: 0,
    notifications: [],
  })
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [toast, setToast] = useState<UserNotification | null>(null)
  const inFlight = useRef(false)
  const shown = useRef(new Set<string>())

  const poll = useCallback(async () => {
    if (inFlight.current || document.visibilityState === "hidden") return
    inFlight.current = true
    try {
      const response = await fetch("/api/notifications", {
        cache: "no-store",
        credentials: "same-origin",
      })
      if (!response.ok) return
      const next = await response.json() as UserNotificationSnapshot
      setSnapshot(next)
      const fresh = next.notifications.find(item => !item.readAt && !shown.current.has(item.id))
      if (fresh) {
        shown.current.add(fresh.id)
        setToast(fresh)
      }
    } catch {
      // Notification polling must not interrupt the current workflow.
    } finally {
      inFlight.current = false
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const initial = window.setTimeout(() => void poll(), 0)
    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS)
    const onFocus = () => void poll()
    const onVisibility = () => {
      if (document.visibilityState === "visible") void poll()
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(interval)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [poll])

  async function markRead(ids: string[]) {
    if (!ids.length) return
    setSnapshot(current => ({
      unreadCount: Math.max(0, current.unreadCount - current.notifications.filter(item => ids.includes(item.id) && !item.readAt).length),
      notifications: current.notifications.map(item => ids.includes(item.id)
        ? { ...item, readAt: item.readAt || Date.now() }
        : item),
    }))
    await fetch("/api/notifications", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }).catch(() => undefined)
  }

  const buttonClass = variant === "workspace"
    ? "relative flex h-9 w-9 items-center justify-center rounded-lg border border-white/18 bg-white/8 text-white transition hover:bg-white/14"
    : "relative flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-[#91CAFF] hover:bg-[#F3F9FF] hover:text-[#0958D9]"

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClass}
        aria-label={snapshot.unreadCount > 0 ? `消息中心有 ${snapshot.unreadCount} 条未读消息` : "打开消息中心"}
        title={snapshot.unreadCount > 0 ? `消息中心 · ${snapshot.unreadCount} 条未读` : "消息中心"}
      >
        <Inbox className="h-4 w-4" />
        {snapshot.unreadCount > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 font-mono text-[9px] font-bold leading-4 text-white ring-2 ring-white/80">
            {snapshot.unreadCount > 99 ? "99+" : snapshot.unreadCount}
          </span>
        ) : null}
      </button>

      {mounted && open ? createPortal(
        <>
          <button type="button" className="fixed inset-0 z-[88] cursor-default bg-[#00133F]/22 backdrop-blur-[1px]" aria-label="关闭消息中心" onClick={() => setOpen(false)} />
          <aside role="dialog" aria-modal="true" aria-labelledby="user-notification-title" className="fixed right-3 top-16 z-[89] flex max-h-[min(620px,calc(100vh-5rem))] w-[min(410px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-[#B7D9FF] bg-white shadow-[0_24px_70px_-28px_rgba(0,49,128,.72)] sm:right-6 sm:top-20">
            <div className="flex items-center justify-between border-b border-[#DDEBFA] px-4 py-3.5">
              <div>
                <h2 id="user-notification-title" className="text-sm font-semibold text-slate-900">消息中心</h2>
                <p className="mt-0.5 text-[11px] text-slate-500">{snapshot.unreadCount > 0 ? `${snapshot.unreadCount} 条未读消息` : "消息已全部读完"}</p>
              </div>
              <div className="flex items-center gap-1">
                {snapshot.unreadCount > 0 ? (
                  <button type="button" onClick={() => void markRead(snapshot.notifications.filter(item => !item.readAt).map(item => item.id))} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-[#0958D9] transition hover:bg-[#EEF7FF]">
                    <CheckCheck className="h-3.5 w-3.5" />
                    全部已读
                  </button>
                ) : null}
                <button type="button" onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100" aria-label="关闭消息中心">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {snapshot.notifications.length === 0 ? (
                <div className="py-12 text-center">
                  <Inbox className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-3 text-xs text-slate-400">暂无消息</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {snapshot.notifications.map(item => {
                    const meta = notificationMeta(item.type, item.metadata)
                    const Icon = meta.Icon
                    return (
                      <Link
                        key={item.id}
                        href={item.actionUrl || "/account"}
                        onClick={() => {
                          void markRead([item.id])
                          setOpen(false)
                        }}
                        className={`group flex min-h-20 items-start gap-3 rounded-lg border px-3 py-3 transition ${item.readAt ? "border-slate-200 bg-white hover:border-[#91CAFF] hover:bg-[#F7FBFF]" : "border-[#91CAFF] bg-[#EEF7FF] hover:bg-[#E5F3FF]"}`}
                      >
                        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ${meta.iconClass}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-xs font-semibold text-slate-900">{item.title}</span>
                            {!item.readAt ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#1677FF]" /> : null}
                          </span>
                          <span className="mt-1 block text-[11px] leading-5 text-slate-500">{item.body}</span>
                          <span className="mt-1 block font-mono text-[9px] text-slate-400">{new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
                        </span>
                        <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#1677FF]" />
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          </aside>
        </>,
        document.body,
      ) : null}

      {toast ? (
        <aside className="fixed right-3 top-16 z-[100] w-[calc(100vw-1.5rem)] max-w-sm overflow-hidden rounded-xl border border-[#B7D9FF] bg-white shadow-2xl shadow-[#0958D9]/20 sm:right-6 sm:top-20" role="status" aria-live="polite">
          <div className="h-1 bg-gradient-to-r from-[#1677FF] via-[#00C8FF] to-[#13C2C2]" />
          <div className="p-4">
            <div className="flex items-start gap-3">
              {(() => {
                const meta = notificationMeta(toast.type, toast.metadata)
                const Icon = meta.Icon
                return <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ${meta.iconClass}`}><Icon className="h-5 w-5" /></span>
              })()}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-900">{toast.title}</div>
                <div className="mt-1 text-xs leading-5 text-slate-600">{toast.body}</div>
              </div>
              <button type="button" onClick={() => setToast(null)} className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="关闭消息提醒"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setToast(null)} className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100">稍后查看</button>
              <Link href={toast.actionUrl || "/account"} onClick={() => { void markRead([toast.id]); setToast(null) }} className="rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-3 py-2 text-xs font-semibold text-white">{notificationMeta(toast.type, toast.metadata).actionLabel}</Link>
            </div>
          </div>
        </aside>
      ) : null}
    </>
  )
}
