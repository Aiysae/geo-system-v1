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

const MATCH_STATUS_LABEL = {
  active: "有效用户",
  disabled: "用户已停用",
  missing: "未匹配用户",
} as const

const MATCH_STATUS_CLASS = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  disabled: "bg-rose-50 text-rose-700 ring-rose-200",
  missing: "bg-slate-50 text-slate-600 ring-slate-200",
} as const

function formatTime(value?: string): string {
  if (!value) return "-"
  return new Date(value).toLocaleString("zh-CN", { hour12: false })
}

export function PasswordResetRow({ request }: { request: PasswordResetRequest }) {
  const matchStatus = request.userStatus || (request.userId ? "active" : "missing")
  const canGenerateLink = request.status !== "used" && matchStatus === "active" && Boolean(request.userId)
  const disabledReason = matchStatus === "missing"
    ? "该邮箱未匹配到系统用户，不能生成链接"
    : matchStatus === "disabled"
      ? "该用户已停用，不能生成链接"
      : ""
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
      <td data-label="用户" className="px-5 py-3">
        <div className="font-medium text-slate-900">{request.userName || "未匹配用户"}</div>
        <div className="mt-0.5 font-mono text-xs text-slate-500">{request.email}</div>
      </td>
      <td data-label="匹配状态" className="px-5 py-3">
        <span className={`inline-flex rounded-lg px-2 py-1 text-xs font-medium ring-1 ${MATCH_STATUS_CLASS[matchStatus]}`}>
          {MATCH_STATUS_LABEL[matchStatus]}
        </span>
      </td>
      <td data-label="申请状态" className="px-5 py-3">
        <span className={`inline-flex rounded-lg px-2 py-1 text-xs font-medium ring-1 ${STATUS_CLASS[request.status]}`}>
          {STATUS_LABEL[request.status]}
        </span>
      </td>
      <td data-label="申请时间" className="px-5 py-3 text-xs text-slate-500">{formatTime(request.createdAt)}</td>
      <td data-label="链接过期时间" className="px-5 py-3 text-xs text-slate-500">{formatTime(request.tokenExpiresAt)}</td>
      <td data-label="操作" className="px-5 py-3">
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="requestId" value={request.id} />
          <button
            type="submit"
            disabled={pending || !canGenerateLink}
            className="inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-[#0958D9] px-3 py-2 text-xs font-medium text-white transition hover:bg-[#003EB3] disabled:cursor-not-allowed disabled:opacity-50 sm:w-fit"
          >
            {pending ? "生成中..." : canGenerateLink ? "生成重置链接" : "不能生成链接"}
          </button>
          {disabledReason && (
            <div className="text-xs text-slate-500">
              {disabledReason}
            </div>
          )}
          {state.message && (
            <div className={`text-xs ${state.ok ? "text-emerald-700" : "text-rose-600"}`}>
              {state.message}
            </div>
          )}
          {absoluteLink && (
            <div className="w-full max-w-md rounded-lg bg-slate-50 p-2 ring-1 ring-slate-200">
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
