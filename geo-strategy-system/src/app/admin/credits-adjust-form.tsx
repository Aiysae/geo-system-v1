"use client"

import { useActionState } from "react"
import { Minus, Plus } from "lucide-react"
import { adjustCreditsAction, type AdjustCreditsState } from "./actions"

const initialState: AdjustCreditsState = {}

export function CreditsAdjustForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(adjustCreditsAction, initialState)

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <input
        name="amount"
        type="number"
        min={1}
        step={1}
        placeholder="积分"
        className="h-9 w-20 rounded-lg border border-slate-200 bg-white px-2 text-sm outline-none focus:border-[#0077B6] focus:ring-2 focus:ring-blue-100"
      />
      <button
        type="submit"
        name="direction"
        value="add"
        disabled={pending}
        className="inline-flex h-9 items-center gap-1 rounded-lg bg-emerald-50 px-2.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100 disabled:opacity-60"
      >
        <Plus className="h-3.5 w-3.5" />
        增加
      </button>
      <button
        type="submit"
        name="direction"
        value="subtract"
        disabled={pending}
        className="inline-flex h-9 items-center gap-1 rounded-lg bg-rose-50 px-2.5 text-xs font-medium text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 disabled:opacity-60"
      >
        <Minus className="h-3.5 w-3.5" />
        扣除
      </button>
      {state.message && (
        <span className={state.ok ? "text-xs text-emerald-600" : "text-xs text-rose-600"}>
          {state.message}
        </span>
      )}
    </form>
  )
}
