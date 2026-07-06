"use client"

import { useActionState, useState, useEffect } from "react"
import { Sparkles, X, Plus } from "lucide-react"
import { requestRechargeAction, type RequestRechargeResult } from "@/app/actions/recharge"
import { useCredits } from "./credits-provider"
import { formatYuan, RECHARGE_PACKAGES, type RechargePackageKey } from "@/lib/pricing"

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
  const [packageKey, setPackageKey] = useState<RechargePackageKey>("standard_299")
  const [paymentMethod, setPaymentMethod] = useState("manual_transfer")
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
        className="relative max-h-[90vh] w-[90%] max-w-md overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200"
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
                已提交 <span className="font-bold text-slate-900">{state!.ok && state!.packageName}</span>
                充值申请，到账积分{" "}
                <span className="font-mono font-bold text-slate-900">
                  {state!.ok && state!.credits}
                </span>
                。请完成付款后等待管理员审批。
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
                选择固定套餐后提交申请。管理员核对付款后审批，审批通过后积分立即到账。
              </p>

              <input type="hidden" name="packageKey" value={packageKey} />
              <input type="hidden" name="paymentMethod" value={paymentMethod} />

              <div className="mt-5 space-y-2">
                {RECHARGE_PACKAGES.map(pkg => {
                  const selected = packageKey === pkg.key
                  return (
                    <button
                      key={pkg.key}
                      type="button"
                      onClick={() => setPackageKey(pkg.key)}
                      className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                        selected
                          ? "border-[#0077B6] bg-blue-50 ring-2 ring-blue-100"
                          : "border-slate-200 bg-white hover:border-blue-200 hover:bg-slate-50"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900">{pkg.name}</span>
                            {"badge" in pkg && pkg.badge && (
                              <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                                {pkg.badge}
                              </span>
                            )}
                          </span>
                          <span className="mt-1 block text-xs text-slate-500">{pkg.description}</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-sm font-bold text-slate-900">{formatYuan(pkg.priceCents)}</span>
                          <span className="block font-mono text-xs text-[#006AA3]">+{pkg.credits} 积分</span>
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>

              <label className="mt-5 block text-xs font-medium text-slate-700">
                付款方式
              </label>
              <select
                value={paymentMethod}
                onChange={e => setPaymentMethod(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-[#0077B6] focus:ring-2 focus:ring-[#0077B6]/20"
              >
                <option value="manual_transfer">人工转账 / 对公付款</option>
                <option value="wechat">微信支付</option>
                <option value="alipay">支付宝</option>
                <option value="other">其他</option>
              </select>

              <label className="mt-4 block text-xs font-medium text-slate-700">
                付款备注（选填）
              </label>
              <textarea
                name="note"
                rows={2}
                className="mt-1.5 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-[#0077B6] focus:ring-2 focus:ring-[#0077B6]/20"
                placeholder="例如：已对公付款 / 微信昵称 / 转账时间"
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
