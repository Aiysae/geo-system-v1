"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Minus, Plus } from "lucide-react"

type ResultState = { ok: boolean; message: string } | null

function operationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `adjust_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
}

export function CreditsAdjustForm({
  userId,
  disabled = false,
}: {
  userId: string
  disabled?: boolean
}) {
  const router = useRouter()
  const [amount, setAmount] = useState("")
  const [pending, setPending] = useState(false)
  const [state, setState] = useState<ResultState>(null)

  async function adjust(direction: "add" | "subtract") {
    if (pending || disabled) return
    const parsedAmount = Math.floor(Number(amount))
    setState(null)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setState({ ok: false, message: "请输入大于 0 的积分数" })
      return
    }

    setPending(true)
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/credits`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, amount: parsedAmount, operationId: operationId() }),
      })
      const data = await response.json() as { message?: string; error?: string }
      if (!response.ok) throw new Error(data.error || "积分调整失败")
      setAmount("")
      setState({ ok: true, message: data.message || "积分调整成功" })
      router.refresh()
    } catch (error) {
      setState({ ok: false, message: error instanceof Error ? error.message : "积分调整失败" })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
      <input
        type="number"
        min={1}
        step={1}
        value={amount}
        onChange={event => setAmount(event.target.value)}
        disabled={disabled || pending}
        placeholder="积分"
        className="col-span-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#1677FF] focus:ring-2 focus:ring-blue-100 sm:h-9 sm:w-20"
      />
      <button
        type="button"
        onClick={() => adjust("add")}
        disabled={disabled || pending}
        className="inline-flex h-10 items-center justify-center gap-1 rounded-lg bg-emerald-50 px-2.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100 disabled:opacity-60 sm:h-9"
      >
        <Plus className="h-3.5 w-3.5" />
        增加
      </button>
      <button
        type="button"
        onClick={() => adjust("subtract")}
        disabled={disabled || pending}
        className="inline-flex h-10 items-center justify-center gap-1 rounded-lg bg-rose-50 px-2.5 text-xs font-medium text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 disabled:opacity-60 sm:h-9"
      >
        <Minus className="h-3.5 w-3.5" />
        扣除
      </button>
      {state?.message && (
        <span className={state.ok ? "col-span-2 text-xs text-emerald-600" : "col-span-2 text-xs text-rose-600"}>
          {state.message}
        </span>
      )}
      {disabled && <span className="col-span-2 text-xs text-blue-600">无限积分账号无需调整</span>}
    </div>
  )
}
