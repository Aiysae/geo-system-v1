"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { Bell, CreditCard, Handshake, X } from "lucide-react"
import type {
  ManagedServiceNotification,
  ManagedServiceNotificationSnapshot,
} from "@/lib/managed-service-notifications"
import type {
  AdminRechargeNotificationSnapshot,
  RechargeNotificationSummary,
} from "@/lib/recharge-notifications"

const POLL_INTERVAL_MS = 20_000

export function AdminRechargeNotifier({
  variant,
}: {
  variant: "workspace" | "admin"
}) {
  const [pendingCount, setPendingCount] = useState(0)
  const [managedCount, setManagedCount] = useState(0)
  const [toast, setToast] = useState<RechargeNotificationSummary | null>(null)
  const [managedToast, setManagedToast] = useState<ManagedServiceNotification | null>(null)
  const [additionalCount, setAdditionalCount] = useState(0)
  const [managedAdditionalCount, setManagedAdditionalCount] = useState(0)
  const inFlightRef = useRef(false)
  const shownIdsRef = useRef(new Set<string>())

  const poll = useCallback(async () => {
    if (inFlightRef.current || document.visibilityState === "hidden") return
    inFlightRef.current = true
    try {
      const [response, managedResponse] = await Promise.all([
        fetch("/api/admin/recharge-notifications", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/admin/managed-service-notifications", { cache: "no-store", credentials: "same-origin" }),
      ])
      if (!response.ok && !managedResponse.ok) return
      const snapshot = response.ok
        ? await response.json() as AdminRechargeNotificationSnapshot
        : { pendingCount: 0, unread: [] }
      setPendingCount(Math.max(0, Number(snapshot.pendingCount) || 0))
      const fresh = (snapshot.unread || [])
        .filter(item => !shownIdsRef.current.has(item.id))
      if (fresh.length > 0) {
        fresh.forEach(item => shownIdsRef.current.add(item.id))
        setToast(fresh[0])
        setAdditionalCount(Math.max(0, fresh.length - 1))
        void fetch("/api/admin/recharge-notifications", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestIds: fresh.map(item => item.id) }),
        })
      }
      const managedSnapshot = managedResponse.ok
        ? await managedResponse.json() as ManagedServiceNotificationSnapshot
        : { unreadCount: 0, unread: [] }
      setManagedCount(Math.max(0, Number(managedSnapshot.unreadCount) || 0))
      const freshManaged = (managedSnapshot.unread || [])
        .filter(item => !shownIdsRef.current.has(item.id))
      if (freshManaged.length > 0) {
        freshManaged.forEach(item => shownIdsRef.current.add(item.id))
        setManagedToast(freshManaged[0])
        setManagedAdditionalCount(Math.max(0, freshManaged.length - 1))
        void fetch("/api/admin/managed-service-notifications", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventIds: freshManaged.map(item => item.id) }),
        })
      }
    } catch {
      // Notification polling must never interrupt the workspace.
    } finally {
      inFlightRef.current = false
    }
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

  const buttonClass = variant === "workspace"
    ? "relative flex h-9 w-9 items-center justify-center rounded-lg border border-white/18 bg-white/8 text-white transition hover:bg-white/14"
    : "geo-utility-header-action relative flex h-10 w-10 items-center justify-center rounded-lg transition"

  const totalCount = pendingCount + managedCount

  return (
    <>
      <Link
        href={managedCount > 0 ? "/admin/managed-services" : "/admin/recharge"}
        className={buttonClass}
        aria-label={totalCount > 0 ? `有 ${totalCount} 条待处理提醒` : "查看管理提醒"}
        title={totalCount > 0 ? `${totalCount} 条待处理提醒` : "管理提醒"}
      >
        <Bell className="h-4 w-4" />
        {totalCount > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 font-mono text-[9px] font-bold leading-4 text-white ring-2 ring-white/80">
            {totalCount > 99 ? "99+" : totalCount}
          </span>
        ) : null}
      </Link>

      {managedToast ? (
        <aside className="fixed right-3 top-16 z-[101] w-[calc(100vw-1.5rem)] max-w-sm overflow-hidden rounded-xl border border-[#B7D9FF] bg-white shadow-2xl shadow-[#0958D9]/20 sm:right-6 sm:top-20" role="status" aria-live="polite">
          <div className="h-1 bg-gradient-to-r from-[#1677FF] via-[#00C8FF] to-[#13C2C2]" />
          <div className="p-4"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#EAF5FF] text-[#0958D9] ring-1 ring-[#B7DBFF]"><Handshake className="h-5 w-5" /></span><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-slate-900">{managedToast.type === "manual_payment_review" ? "代运营转账待核对" : managedToast.type === "intake_submitted" ? "客户已提交项目资料" : "代运营订单支付成功"}</div><div className="mt-1 text-xs leading-5 text-slate-600">{managedToast.username || managedToast.email} · {managedToast.projectName || managedToast.planName}</div><div className="mt-1 font-mono text-xs font-semibold text-[#0958D9]">¥{(managedToast.priceCents / 100).toLocaleString("zh-CN")}</div>{managedAdditionalCount > 0 ? <div className="mt-1 text-[11px] text-amber-600">同时还有 {managedAdditionalCount} 条新提醒</div> : null}</div><button type="button" onClick={() => setManagedToast(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="关闭代运营提醒"><X className="h-4 w-4" /></button></div><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setManagedToast(null)} className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100">稍后处理</button><Link href={`/admin/managed-services#managed-service-${encodeURIComponent(managedToast.orderId)}`} onClick={() => setManagedToast(null)} className="rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-3 py-2 text-xs font-semibold text-white">进入服务订单</Link></div></div>
        </aside>
      ) : null}

      {toast && !managedToast ? (
        <aside
          className="fixed right-3 top-16 z-[100] w-[calc(100vw-1.5rem)] max-w-sm overflow-hidden rounded-xl border border-[#B7D9FF] bg-white shadow-2xl shadow-[#0958D9]/20 sm:right-6 sm:top-20"
          role="status"
          aria-live="polite"
        >
          <div className="h-1 bg-gradient-to-r from-[#1677FF] via-[#00C8FF] to-[#315EFB]" />
          <div className="p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#EAF5FF] text-[#0958D9] ring-1 ring-[#B7DBFF]">
                <CreditCard className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-900">
                  新的积分充值申请
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-600">
                  {toast.username || toast.email || "新用户"} · {toast.packageName}
                </div>
                <div className="mt-1 font-mono text-xs font-semibold text-[#0958D9]">
                  {typeof toast.priceCents === "number"
                    ? `¥${(toast.priceCents / 100).toFixed(2)} · `
                    : ""}
                  {toast.credits} 积分
                </div>
                {additionalCount > 0 ? (
                  <div className="mt-1 text-[11px] text-amber-600">
                    同时还有 {additionalCount} 条新申请
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="关闭充值提醒"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setToast(null)}
                className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
              >
                稍后处理
              </button>
              <Link
                href={`/admin/recharge#recharge-${encodeURIComponent(toast.id)}`}
                onClick={() => setToast(null)}
                className="rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-3 py-2 text-xs font-semibold text-white shadow-sm"
              >
                立即审核
              </Link>
            </div>
          </div>
        </aside>
      ) : null}
    </>
  )
}
