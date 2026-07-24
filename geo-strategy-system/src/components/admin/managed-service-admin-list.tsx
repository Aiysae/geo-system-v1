"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { ArrowRight, CheckCircle2, Loader2, RefreshCw } from "lucide-react"
import type { ManagedServiceOrder } from "@/lib/managed-services"
import { formatYuan } from "@/lib/pricing"

type AdminOrder = ManagedServiceOrder & {
  payment?: {
    status: string
    provider: string
    payerName?: string
    paymentReference?: string
    contact?: string
    note?: string
  } | null
}

const STATUS: Record<string, string> = {
  pending_payment: "待付款",
  paid: "已付款",
  provisioning: "正在创建项目",
  awaiting_intake: "待提交资料",
  intake_submitted: "资料待确认",
  active: "执行中",
  paused: "已暂停",
  completed: "已完成",
  canceled: "已取消",
  provisioning_failed: "项目创建失败",
}

export function ManagedServiceAdminList({ orders }: { orders: AdminOrder[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Record<string, string>>({})
  const [startDates, setStartDates] = useState<Record<string, string>>({})

  async function act(order: AdminOrder, body: Record<string, string>) {
    setBusyId(order.id)
    setMessages(current => ({ ...current, [order.id]: "" }))
    try {
      const response = await fetch(`/api/admin/managed-services/${encodeURIComponent(order.id)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = await response.json() as { error?: string }
      if (!response.ok) throw new Error(payload.error || "操作失败")
      setMessages(current => ({ ...current, [order.id]: "操作成功" }))
      router.refresh()
    } catch (error) {
      setMessages(current => ({ ...current, [order.id]: error instanceof Error ? error.message : "操作失败" }))
    } finally {
      setBusyId(null)
    }
  }

  if (!orders.length) return <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-14 text-center text-sm text-slate-500">暂无代运营服务订单</div>

  return <div className="space-y-3">{orders.map(order => {
    const busy = busyId === order.id
    const manualPending = order.payment?.provider === "manual_transfer" && order.payment.status === "pending"
    const startDate = startDates[order.id] || new Date().toISOString().slice(0, 10)
    return <article id={`managed-service-${order.id}`} key={order.id} className="scroll-mt-24 rounded-lg border border-[#D8E7F7] bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-bold text-slate-950">{order.intake?.projectName || order.planName}</h2><span className="rounded-md bg-blue-50 px-2 py-1 text-[10px] font-semibold text-[#0958D9] ring-1 ring-blue-100">{STATUS[order.status] || order.status}</span></div>
          <p className="mt-1 text-xs text-slate-500">{order.username} · {order.email}</p>
          <div className="mt-3 grid gap-2 text-[11px] text-slate-600 sm:grid-cols-2 xl:grid-cols-4"><span>金额：<b className="text-slate-900">{formatYuan(order.priceCents)}</b></span><span>周期：{order.durationMonths} 个月</span><span>支付：{paymentLabel(order.payment?.provider)} · {order.payment?.status || "未创建"}</span><span>服务单：<span className="font-mono">{order.id}</span></span></div>
          {order.payment?.payerName || order.payment?.paymentReference || order.payment?.contact ? <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-600 ring-1 ring-slate-200">付款人：{order.payment.payerName || "-"} · 流水：{order.payment.paymentReference || "-"}<br />联系：{order.payment.contact || "-"} {order.payment.note ? `· ${order.payment.note}` : ""}</div> : null}
          {order.intake ? <div className="mt-3 rounded-lg bg-emerald-50/70 px-3 py-2 text-[11px] leading-5 text-slate-700 ring-1 ring-emerald-100">主体：{order.intake.subjectName} · {order.intake.industry || "行业待补充"} · {order.intake.region || "区域待补充"}<br />联系人：{order.intake.contactName || "-"} · {order.intake.contactPhone || order.intake.contactWechat || "-"}</div> : null}
          {order.provisioningError ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-700 ring-1 ring-rose-200">{order.provisioningError}</p> : null}
          {messages[order.id] ? <p className="mt-3 text-xs font-semibold text-[#0958D9]">{messages[order.id]}</p> : null}
        </div>
        <div className="flex w-full shrink-0 flex-col gap-2 lg:w-56">
          {manualPending ? <button type="button" disabled={busy} onClick={() => void act(order, { action: "confirm_payment" })} className="flex h-10 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}确认银行到账</button> : null}
          {order.status === "provisioning_failed" ? <button type="button" disabled={busy} onClick={() => void act(order, { action: "retry_provisioning" })} className="flex h-10 items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 text-xs font-semibold text-white disabled:opacity-50"><RefreshCw className="h-4 w-4" />重试创建项目</button> : null}
          {order.status === "intake_submitted" || order.status === "paused" ? <div className="flex gap-2"><input type="date" value={startDate} onChange={event => setStartDates(current => ({ ...current, [order.id]: event.target.value }))} className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-2 text-[11px]" /><button type="button" disabled={busy} onClick={() => void act(order, { action: "set_status", status: "active", serviceStartsAt: startDate })} className="h-10 shrink-0 rounded-lg bg-[#1677FF] px-3 text-xs font-semibold text-white">立项</button></div> : null}
          {order.status === "active" ? <button type="button" disabled={busy} onClick={() => void act(order, { action: "set_status", status: "paused" })} className="h-10 rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-semibold text-amber-700">暂停服务</button> : null}
          {order.status === "active" || order.status === "paused" ? <button type="button" disabled={busy} onClick={() => void act(order, { action: "set_status", status: "completed" })} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700">标记完成</button> : null}
          <Link href={`/account/services/${encodeURIComponent(order.id)}`} className="flex h-10 items-center justify-center gap-1 rounded-lg border border-[#BAE0FF] bg-[#F0F8FF] px-3 text-xs font-semibold text-[#0958D9]">查看项目资料<ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
      </div>
    </article>
  })}</div>
}

function paymentLabel(value?: string) {
  if (value === "wechat") return "微信"
  if (value === "alipay") return "支付宝"
  return "银行转账"
}
