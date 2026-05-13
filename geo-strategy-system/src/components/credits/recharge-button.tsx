"use client"

import { useActionState, useState, useEffect } from "react"
import { Sparkles, X, Plus } from "lucide-react"
import { requestRechargeAction, type RequestRechargeResult } from "@/app/actions/recharge"
import { useCredits } from "./credits-provider"

export function RechargeButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="申请充值积分"
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-[#004B73] to-[#0077B6] text-white text-[11px] font-medium hover:shadow-md hover:shadow-blue-300/40 hover:-translate-y-0.5 transition-all"
      >
        <Plus className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">申请充值</span>
      </button>
      {open && <RechargeDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function RechargeDialog({ onClose }: { onClose: () => void }) {
  const { refresh } = useCredits()
  const [amount, setAmount] = useState<string>("100")
  const [state, formAction, pending] = useActionState<RequestRechargeResult | null, FormData>(
    async (_prev, fd) => requestRechargeAction(fd),
    null
  )

  // 提交成功后刷新积分（虽然审批通过才到账，但保险起见同步一次）
  useEffect(() => {
    if (state?.ok) {
      refresh()
    }
  }, [state, refresh])

  const submitted = state?.ok === true

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-[90%] max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-slate-100 transition"
          aria-label="关闭"
        >
          <X className="h-4 w-4 text-slate-500" />
        </button>

        <div className="px-7 pt-7 pb-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400 to-rose-500 flex items-center justify-center shadow-lg shadow-rose-200/50">
              <Sparkles className="h-5 w-5 text-white" />
            </span>
            <h2 className="text-lg font-bold tracking-tight text-slate-900">
              申请积分充值
            </h2>
          </div>

          {submitted ? (
            <>
              <p className="text-sm text-slate-600 leading-relaxed">
                已提交 <span className="font-mono font-bold text-slate-900">{state!.ok && state!.amount}</span> 积分的充值申请，等待管理员审批。
              </p>
              <button
                onClick={onClose}
                className="mt-6 w-full py-2.5 rounded-xl bg-gradient-to-r from-[#004B73] to-[#0077B6] text-white text-sm font-medium hover:shadow-lg hover:shadow-blue-300/40 hover:-translate-y-0.5 transition-all"
              >
                好的
              </button>
            </>
          ) : (
            <form action={formAction}>
              <p className="text-sm text-slate-600 leading-relaxed">
                请输入希望充值的积分数值。提交后将由管理员审批，审批通过后积分立即到账。
              </p>

              <label className="block mt-5 mb-1.5 text-xs font-medium text-slate-700">
                充值积分数
              </label>
              <input
                name="amount"
                type="number"
                min={1}
                max={100000}
                step={1}
                value={amount}
                onChange={e => setAmount(e.target.value)}
                required
                className="w-full px-4 py-2.5 text-sm rounded-xl border border-slate-200 bg-white outline-none focus:border-[#0077B6] focus:ring-2 focus:ring-[#0077B6]/20 transition-all font-mono"
                placeholder="例如 100"
              />

              {state && !state.ok && (
                <div className="mt-3 text-xs text-rose-600 bg-rose-50 ring-1 ring-rose-200 rounded-lg px-3 py-2">
                  {state.error}
                </div>
              )}

              <div className="mt-6 flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 rounded-xl bg-white ring-1 ring-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#004B73] to-[#0077B6] text-white text-sm font-medium hover:shadow-lg hover:shadow-blue-300/40 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0 transition-all"
                >
                  {pending ? "提交中..." : "提交申请"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
