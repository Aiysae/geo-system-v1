"use client"

import { useActionState, useMemo } from "react"
import type { PasswordResetRequest } from "@/lib/auth"
import { createPasswordResetLinkAction, type PasswordResetLinkState } from "./actions"

const STATUS_LABEL: Record<PasswordResetRequest["status"], string> = {
  pending: "待生成链接",
  link_generated: "已生成链接",
  used: "已完成重置",
}

const STATUS_CLASS: Record<PasswordResetRequest["status"], string> = {
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
  link_generated: "bg-blue-50 text-blue-700 ring-blue-200",
  used: "bg-emerald-50 text-emerald-700 ring-emerald-200",
}

function formatTime(value?: string): string {
  if (!value) return "-"
  return new Date(value).toLocaleString("zh-CN", { hour12: false })
}

export function PasswordResetRow({ request }: { request: PasswordResetRequest }) {
  const [state, formAction, pending] = useActionState<PasswordResetLinkState, FormData>(
    createPasswordResetLinkAction,
    {},
  )
  const absoluteLink = useMemo(() => {
    if (!state.path) return ""
    if (typeof window === "undefined") return state.path
    return new URL(state.path, window.location.origin).toString()
  }, [state.path])

  return (
    <tr className="border-t border-slate-100 text-sm">
      <td className="px-5 py-3">
        <div className="font-medium text-slate-900">{request.userName || "用户"}</div>
        <div className="mt-0.5 font-mono text-xs text-slate-500">{request.email}</div>
      </td>
      <td className="px-5 py-3">
        <span className={`inline-flex rounded-lg px-2 py-1 text-xs font-medium ring-1 ${STATUS_CLASS[request.status]}`}>
          {STATUS_LABEL[request.status]}
        </span>
      </td>
      <td className="px-5 py-3 text-xs text-slate-500">{formatTime(request.createdAt)}</td>
      <td className="px-5 py-3 text-xs text-slate-500">{formatTime(request.tokenExpiresAt)}</td>
      <td className="px-5 py-3">
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="requestId" value={request.id} />
          <button
            type="submit"
            disabled={pending || request.status === "used"}
            className="inline-flex w-fit items-center rounded-lg bg-[#006AA3] px-3 py-2 text-xs font-medium text-white transition hover:bg-[#004B73] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "生成中..." : "生成重置链接"}
          </button>
          {state.message && (
            <div className={`text-xs ${state.ok ? "text-emerald-700" : "text-rose-600"}`}>
              {state.message}
            </div>
          )}
          {absoluteLink && (
            <div className="max-w-md rounded-lg bg-slate-50 p-2 ring-1 ring-slate-200">
              <div className="mb-1 text-[11px] text-slate-500">复制给用户，30 分钟内有效：</div>
              <input
                readOnly
                value={absoluteLink}
                onFocus={event => event.currentTarget.select()}
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs text-slate-700"
              />
            </div>
          )}
        </form>
      </td>
    </tr>
  )
}
