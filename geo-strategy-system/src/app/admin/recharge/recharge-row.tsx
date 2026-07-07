"use client"

import { useActionState } from "react"
import { Check, X } from "lucide-react"
import { approveRechargeAction, rejectRechargeAction, type AdminActionResult } from "./actions"
import type { RechargeRequest } from "@/lib/recharge"
import { formatYuan } from "@/lib/pricing"

const initialState: AdminActionResult | null = null
const statusLabel: Record<RechargeRequest["status"], string> = {
  pending: "待审批",
  approved: "已到账",
  rejected: "已拒绝",
}
const statusClass: Record<RechargeRequest["status"], string> = {
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200",
}

export function RechargeRow({ req }: { req: RechargeRequest }) {
  const [approveState, approveFormAction, approvePending] = useActionState<
    AdminActionResult | null,
    FormData
  >(async (_prev, fd) => approveRechargeAction(fd), initialState)

  const [rejectState, rejectFormAction, rejectPending] = useActionState<
    AdminActionResult | null,
    FormData
  >(async (_prev, fd) => rejectRechargeAction(fd), initialState)

  const busy = approvePending || rejectPending
  const credits = req.credits ?? req.amount
  const paymentLabel = {
    manual_transfer: "人工转账",
    wechat: "微信",
    alipay: "支付宝",
    other: "其他",
  }[req.paymentMethod || "manual_transfer"]
  const lastError =
    approveState && !approveState.ok
      ? approveState.error
      : rejectState && !rejectState.ok
      ? rejectState.error
      : null
  const isPending = req.status === "pending"

  return (
    <tr className="border-t border-slate-200 hover:bg-slate-50/60 transition">
      <td className="px-4 py-3 align-top">
        <div className="text-sm font-medium text-slate-900">
          {req.username || <span className="text-slate-400">（无昵称）</span>}
        </div>
        <div className="text-xs text-slate-500 mt-0.5">{req.email || "—"}</div>
        <div className="text-[10px] text-slate-400 font-mono mt-1">{req.userId}</div>
      </td>
      <td className="px-4 py-3 align-top">
        <div className="mb-1 text-xs font-medium text-slate-700">
          {req.packageName || "历史充值申请"}
        </div>
        {req.priceCents ? (
          <div className="mb-1 font-mono text-xs font-semibold text-slate-900">
            {formatYuan(req.priceCents)}
          </div>
        ) : null}
        <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-gradient-to-br from-amber-50 to-rose-50 ring-1 ring-amber-200/70 text-sm font-semibold font-mono tabular-nums text-slate-900">
          +{credits}
        </span>
        <div className="mt-1 text-[11px] text-slate-500">付款方式：{paymentLabel}</div>
        {(req.payerName || req.paymentReference || req.contact) && (
          <div className="mt-2 max-w-[260px] rounded-lg bg-blue-50/70 px-2 py-1.5 text-[11px] leading-4 text-slate-600 ring-1 ring-blue-100">
            {req.payerName && <div>付款人：{req.payerName}</div>}
            {req.paymentReference && <div>凭证：{req.paymentReference}</div>}
            {req.contact && <div>联系：{req.contact}</div>}
          </div>
        )}
        {req.note && (
          <div className="mt-1 max-w-[220px] rounded-md bg-slate-50 px-2 py-1 text-[11px] leading-4 text-slate-500">
            {req.note}
          </div>
        )}
      </td>
      <td className="px-4 py-3 align-top text-xs text-slate-500 whitespace-nowrap">
        {new Date(req.createdAt).toLocaleString("zh-CN", { hour12: false })}
      </td>
      <td className="px-4 py-3 align-top">
        {isPending ? (
          <div className="flex items-center gap-2">
            <form action={approveFormAction}>
              <input type="hidden" name="requestId" value={req.id} />
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:shadow-md hover:shadow-emerald-200/60 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0 transition-all"
              >
                <Check className="h-3.5 w-3.5" />
                {approvePending ? "处理中..." : "同意"}
              </button>
            </form>
            <form action={rejectFormAction}>
              <input type="hidden" name="requestId" value={req.id} />
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-white ring-1 ring-slate-200 text-slate-700 hover:bg-slate-50 hover:ring-rose-200 hover:text-rose-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <X className="h-3.5 w-3.5" />
                {rejectPending ? "处理中..." : "拒绝"}
              </button>
            </form>
          </div>
        ) : (
          <div className="space-y-1">
            <span className={`inline-flex rounded-lg px-2 py-1 text-xs font-medium ring-1 ${statusClass[req.status]}`}>
              {statusLabel[req.status]}
            </span>
            {req.processedAt && (
              <div className="text-[11px] text-slate-500">
                {new Date(req.processedAt).toLocaleString("zh-CN", { hour12: false })}
              </div>
            )}
          </div>
        )}
        {lastError && (
          <div className="mt-1.5 text-[11px] text-rose-600">{lastError}</div>
        )}
      </td>
    </tr>
  )
}
