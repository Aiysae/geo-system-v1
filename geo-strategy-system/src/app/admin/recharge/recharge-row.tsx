"use client"

import { useActionState } from "react"
import { Check, X } from "lucide-react"
import { approveRechargeAction, rejectRechargeAction, type AdminActionResult } from "./actions"
import type { RechargeRequest } from "@/lib/recharge"

const initialState: AdminActionResult | null = null

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
  const lastError =
    approveState && !approveState.ok
      ? approveState.error
      : rejectState && !rejectState.ok
      ? rejectState.error
      : null

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
        <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-gradient-to-br from-amber-50 to-rose-50 ring-1 ring-amber-200/70 text-sm font-semibold font-mono tabular-nums text-slate-900">
          +{req.amount}
        </span>
      </td>
      <td className="px-4 py-3 align-top text-xs text-slate-500 whitespace-nowrap">
        {new Date(req.createdAt).toLocaleString("zh-CN", { hour12: false })}
      </td>
      <td className="px-4 py-3 align-top">
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
        {lastError && (
          <div className="mt-1.5 text-[11px] text-rose-600">{lastError}</div>
        )}
      </td>
    </tr>
  )
}
