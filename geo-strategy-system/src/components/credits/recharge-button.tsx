"use client"

import Image from "next/image"
import Link from "next/link"
import { useActionState, useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { Building2, CreditCard, MessageCircle, QrCode, Sparkles, X, Plus } from "lucide-react"
import { requestRechargeAction, type RequestRechargeResult } from "@/app/actions/recharge"
import { useCredits } from "./credits-provider"
import { formatYuan, RECHARGE_PACKAGES, type RechargePackageKey } from "@/lib/pricing"
import { RECHARGE_PAYMENT_INFO } from "@/lib/recharge-payment"

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
  const [packageKey, setPackageKey] = useState<RechargePackageKey>("standard_99")
  const [paymentMethod, setPaymentMethod] = useState("manual_transfer")
  const [state, formAction, pending] = useActionState<RequestRechargeResult | null, FormData>(
    async (_prev, fd) => requestRechargeAction(fd),
    null
  )

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  useEffect(() => {
    if (state?.ok) {
      refresh()
    }
  }, [state, refresh])

  const submitted = state?.ok === true
  const hasAccountInfo = Boolean(
    RECHARGE_PAYMENT_INFO.accountName
    || RECHARGE_PAYMENT_INFO.creditCode
    || RECHARGE_PAYMENT_INFO.registeredAddress
    || RECHARGE_PAYMENT_INFO.accountNo
    || RECHARGE_PAYMENT_INFO.bankName
    || RECHARGE_PAYMENT_INFO.bankCode
    || RECHARGE_PAYMENT_INFO.contact
  )
  const selectedQrCode = RECHARGE_PAYMENT_INFO.qrCodes.find(code => code.method === paymentMethod)

  const dialog = (
    <div
      className="fixed inset-0 z-[9999] overflow-hidden bg-black/50 px-3 py-3 backdrop-blur-sm animate-fade-in sm:px-6 sm:py-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="flex min-h-full items-center justify-center">
        <div
          className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 sm:max-h-[92dvh]"
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-10 p-1.5 rounded-lg hover:bg-slate-100 transition"
            aria-label="关闭"
          >
            <X className="h-4 w-4 text-slate-500" />
          </button>

          <div className="shrink-0 flex items-center gap-3 border-b border-slate-100 px-5 py-4 sm:px-7">
            <span className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400 to-rose-500 flex items-center justify-center shadow-lg shadow-rose-200/50">
              <Sparkles className="h-5 w-5 text-white" />
            </span>
            <h2 className="pr-9 text-lg font-bold tracking-tight text-slate-900">
              申请积分充值
            </h2>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7">
            {submitted ? (
              <>
                <p className="text-sm text-slate-600 leading-relaxed">
                  已提交 <span className="font-bold text-slate-900">{state!.ok && state!.packageName}</span>
                  充值申请，到账积分{" "}
                  <span className="font-mono font-bold text-slate-900">
                    {state!.ok && state!.credits}
                  </span>
                  。管理员核对到账后会审批加积分。
                </p>
                {state!.ok && state!.paymentOutTradeNo && (
                  <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
                    订单号：
                    <span className="font-mono text-slate-900">{state!.paymentOutTradeNo}</span>
                  </div>
                )}
                <button
                  onClick={onClose}
                  className="mt-6 w-full py-2.5 rounded-xl bg-gradient-to-r from-[#004B73] to-[#0077B6] text-white text-sm font-medium hover:shadow-lg hover:shadow-blue-300/40 hover:-translate-y-0.5 transition-all"
                >
                  好的
                </button>
              </>
            ) : (
            <form action={formAction} className="min-h-0">
              <p className="text-sm text-slate-600 leading-relaxed">
                选择套餐并完成付款后提交申请。管理员核对到账后审批，审批通过后积分立即到账。
              </p>

              <div className="mt-4 rounded-xl bg-blue-50/70 px-4 py-3 text-xs leading-5 text-slate-700 ring-1 ring-blue-100">
                <div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-900">
                  <CreditCard className="h-3.5 w-3.5 text-[#0077B6]" />
                  付款说明
                </div>
                <p>{RECHARGE_PAYMENT_INFO.notice}</p>
                <p className="mt-2 text-[11px] text-slate-500">
                  建议付款备注填写注册邮箱和套餐名称，便于管理员核对。提交充值申请即表示你理解积分仅用于平台服务消耗，并同意
                  <Link href="/recharge-rules" target="_blank" className="mx-1 font-medium text-[#006AA3] hover:text-[#004B73]">
                    充值与退款规则
                  </Link>
                  。首购体验包每个账号仅限提交一次。
                </p>
              </div>

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

              <PaymentMethodInfo
                hasAccountInfo={hasAccountInfo}
                paymentMethod={paymentMethod}
                selectedQrCode={selectedQrCode}
              />

              <CustomerServiceInfo />

              <label className="mt-4 block text-xs font-medium text-slate-700">
                付款人 / 付款账户名（推荐）
              </label>
              <input
                name="payerName"
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-[#0077B6] focus:ring-2 focus:ring-[#0077B6]/20"
                placeholder="例如：公司名称、微信昵称、支付宝实名"
              />

              <label className="mt-4 block text-xs font-medium text-slate-700">
                付款凭证 / 流水号（推荐）
              </label>
              <input
                name="paymentReference"
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-[#0077B6] focus:ring-2 focus:ring-[#0077B6]/20"
                placeholder="例如：转账单号、交易号、付款截图链接"
              />

              <label className="mt-4 block text-xs font-medium text-slate-700">
                联系方式（选填）
              </label>
              <input
                name="contact"
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-[#0077B6] focus:ring-2 focus:ring-[#0077B6]/20"
                placeholder="例如：手机号、微信号、邮箱"
              />

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

              <div className="sticky bottom-0 -mx-5 mt-6 flex gap-2 border-t border-slate-100 bg-white/95 px-5 py-3 backdrop-blur sm:-mx-7 sm:px-7">
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
    </div>
  )

  if (typeof document === "undefined") return null
  return createPortal(dialog, document.body)
}

function CustomerServiceInfo() {
  const wechatId = RECHARGE_PAYMENT_INFO.serviceWechatId
  const qrImageUrl = RECHARGE_PAYMENT_INFO.serviceWechatQrImageUrl

  if (!wechatId && !qrImageUrl) return null

  return (
    <div className="mt-3 rounded-xl bg-emerald-50/70 px-4 py-3 text-xs leading-5 text-slate-700 ring-1 ring-emerald-100">
      <div className="mb-2 flex items-center gap-1.5 font-semibold text-slate-900">
        <MessageCircle className="h-3.5 w-3.5 text-emerald-700" />
        充值客服微信
      </div>
      <div className="flex items-center gap-4 rounded-lg bg-white/85 px-3 py-3 ring-1 ring-emerald-100">
        {qrImageUrl ? (
          <Image
            src={qrImageUrl}
            alt="充值客服微信二维码"
            width={160}
            height={160}
            className="h-28 w-28 shrink-0 rounded-lg object-contain sm:h-32 sm:w-32"
            sizes="(max-width: 640px) 112px, 128px"
          />
        ) : null}
        <div className="min-w-0">
          <p className="text-[11px] leading-5 text-slate-600">
            充值、对公付款、发票或到账问题，可以扫码添加客服微信。
          </p>
          {wechatId ? (
            <p className="mt-2 break-all font-mono text-sm font-semibold text-slate-900">
              微信号：{wechatId}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function PaymentMethodInfo({
  hasAccountInfo,
  paymentMethod,
  selectedQrCode,
}: {
  hasAccountInfo: boolean
  paymentMethod: string
  selectedQrCode?: (typeof RECHARGE_PAYMENT_INFO.qrCodes)[number]
}) {
  if (paymentMethod === "manual_transfer") {
    return (
      <div className="mt-3 rounded-xl bg-emerald-50/70 px-4 py-3 text-xs leading-5 text-slate-700 ring-1 ring-emerald-100">
        <div className="mb-2 flex items-center gap-1.5 font-semibold text-slate-900">
          <Building2 className="h-3.5 w-3.5 text-emerald-700" />
          对公转账账户
        </div>
        {hasAccountInfo ? (
          <div className="grid gap-1 rounded-lg bg-white/80 px-3 py-2 text-[11px] text-slate-700 ring-1 ring-emerald-100">
            {RECHARGE_PAYMENT_INFO.accountName && <div>账户名称：{RECHARGE_PAYMENT_INFO.accountName}</div>}
            {RECHARGE_PAYMENT_INFO.creditCode && <div>统一社会信用代码：{RECHARGE_PAYMENT_INFO.creditCode}</div>}
            {RECHARGE_PAYMENT_INFO.registeredAddress && <div>注册地址：{RECHARGE_PAYMENT_INFO.registeredAddress}</div>}
            {RECHARGE_PAYMENT_INFO.accountNo && (
              <div className="break-all font-mono">账户号码：{RECHARGE_PAYMENT_INFO.accountNo}</div>
            )}
            {RECHARGE_PAYMENT_INFO.bankName && <div>开户银行：{RECHARGE_PAYMENT_INFO.bankName}</div>}
            {RECHARGE_PAYMENT_INFO.bankCode && <div className="font-mono">行号：{RECHARGE_PAYMENT_INFO.bankCode}</div>}
            {RECHARGE_PAYMENT_INFO.contact && <div>联系：{RECHARGE_PAYMENT_INFO.contact}</div>}
          </div>
        ) : (
          <div className="rounded-lg bg-white/80 px-3 py-2 text-[11px] text-rose-600 ring-1 ring-rose-100">
            当前未配置对公账户信息，请联系管理员。
          </div>
        )}
        <p className="mt-2 text-[11px] text-slate-500">
          转账备注建议填写注册邮箱和充值套餐，提交申请时同步填写付款人或流水号。
        </p>
      </div>
    )
  }

  if (paymentMethod === "wechat" || paymentMethod === "alipay") {
    return (
      <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-700 ring-1 ring-slate-200">
        <div className="mb-2 flex items-center gap-1.5 font-semibold text-slate-900">
          <QrCode className="h-3.5 w-3.5 text-[#0077B6]" />
          {paymentMethod === "wechat" ? "微信收款码" : "支付宝收款码"}
        </div>
        {selectedQrCode ? (
          <div className="mx-auto max-w-sm rounded-xl bg-white p-2 ring-1 ring-slate-200">
            <div className="mb-2 text-center text-xs font-semibold text-slate-900">{selectedQrCode.label}</div>
            <Image
              src={selectedQrCode.imageUrl}
              alt={`${selectedQrCode.label}收款码`}
              width={360}
              height={520}
              className="max-h-[36dvh] min-h-[180px] w-full rounded-lg object-contain sm:max-h-[360px]"
              sizes="(max-width: 640px) 82vw, 320px"
              priority={false}
            />
            {selectedQrCode.description && (
              <div className="mt-2 text-center text-[11px] text-slate-500">{selectedQrCode.description}</div>
            )}
          </div>
        ) : (
          <div className="rounded-lg bg-white px-3 py-2 text-[11px] text-rose-600 ring-1 ring-rose-100">
            当前未配置该付款方式的收款码，请切换其他方式或联系管理员。
          </div>
        )}
        <p className="mt-2 text-[11px] text-slate-500">
          付款后请在下方填写付款人、交易号或付款截图链接，便于后台核对到账。
        </p>
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600 ring-1 ring-slate-200">
      请选择微信、支付宝或对公转账。其他付款方式需先与管理员确认后再提交申请。
    </div>
  )
}
