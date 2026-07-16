"use client"

import { useActionState } from "react"
import { CircleSlash, RotateCcw } from "lucide-react"
import { updateUserStatusAction, type UpdateUserStatusState } from "./actions"

const initialState: UpdateUserStatusState = {}

export function UserStatusForm({
  userId,
  status,
}: {
  userId: string
  status: "active" | "disabled"
}) {
  const [state, action, pending] = useActionState(updateUserStatusAction, initialState)
  const nextStatus = status === "active" ? "disabled" : "active"

  return (
    <form action={action} className="flex w-full flex-wrap items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="status" value={nextStatus} />
      <span className={status === "active" ? "rounded-lg bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200" : "rounded-lg bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-200"}>
        {status === "active" ? "正常" : "已停用"}
      </span>
      <button
        type="submit"
        disabled={pending}
        className={status === "active" ? "inline-flex min-h-10 items-center justify-center gap-1 rounded-lg bg-rose-50 px-3 text-xs font-medium text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 disabled:opacity-60 sm:min-h-8" : "inline-flex min-h-10 items-center justify-center gap-1 rounded-lg bg-emerald-50 px-3 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100 disabled:opacity-60 sm:min-h-8"}
      >
        {status === "active" ? <CircleSlash className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
        {pending ? "处理中" : status === "active" ? "停用" : "启用"}
      </button>
      {state.message && (
        <span className={state.ok ? "text-xs text-emerald-600" : "text-xs text-rose-600"}>
          {state.message}
        </span>
      )}
    </form>
  )
}
