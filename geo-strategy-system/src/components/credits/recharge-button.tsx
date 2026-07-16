"use client"

import Image from "next/image"
import Link from "next/link"
import { useActionState, useCallback, useState, useEffect, type ReactNode } from "react"
import { createPortal } from "react-dom"
import {
  ArrowRight,
  BadgePercent,
  Building2,
  Check,
  ChevronLeft,
  CreditCard,
  FileBadge2,
  Gem,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react"
import { requestRechargeAction, type RequestRechargeResult } from "@/app/actions/recharge"
import { useCredits } from "./credits-provider"
import {
  estimatePackageFeatureUses,
  formatYuan,
  rechargeSavingsPercent,
  rechargeUnitPrice,
  RECHARGE_PACKAGES,
  type ActiveRechargePackageKey,
} from "@/lib/pricing"
import { RECHARGE_PAYMENT_INFO } from "@/lib/recharge-payment"

type PaymentOptions = {
  alipay: boolean
  wechat: {
    enabled: boolean
    native: boolean
    h5: boolean
  }
  manualTransfer: boolean
  firstPurchase: {
    available: boolean
    reason: "signed_out" | "completed_purchase" | "active_intro_order" | null
  }
}

type WechatCheckout = {
  orderId: string
  outTradeNo: string
  qrCodeDataUrl: string
  expiresAt: number
  status: "waiting" | "credited" | "expired"
}

type RechargeStep = "package" | "payment"
type RechargePaymentMethod = "wechat" | "alipay" | "manual_transfer"

type RechargeButtonProps = {
  initialPackageKey?: ActiveRechargePackageKey
  triggerClassName?: string
  children?: ReactNode
  processPaymentReturn?: boolean
}

export function RechargeButton({
  initialPackageKey = "trial_990",
  triggerClassName,
  children,
  processPaymentReturn = true,
}: RechargeButtonProps = {}) {
  const { refresh } = useCredits()
  const [open, setOpen] = useState(false)
  const [paymentReturn, setPaymentReturn] = useState<"idle" | "syncing" | "credited" | "pending" | "failed">("idle")

  useEffect(() => {
    if (!processPaymentReturn) return
    const url = new URL(window.location.href)
    const orderId = url.searchParams.get("order_id")
    const provider = url.searchParams.get("payment_return")
    if ((provider !== "alipay" && provider !== "wechat") || !orderId) return

    queueMicrotask(() => setPaymentReturn("syncing"))
    fetch(`/api/recharge/payments/${provider}/${encodeURIComponent(orderId)}/sync`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async response => ({
        ok: response.ok,
        payload: await response.json() as { status?: string },
      }))
      .then(({ ok, payload }) => {
        if (!ok) throw new Error("支付状态查询失败")
        if (payload.status === "credited") {
          setPaymentReturn("credited")
          refresh()
        } else {
          setPaymentReturn("pending")
        }
      })
      .catch(() => setPaymentReturn("failed"))
      .finally(() => {
        url.searchParams.delete("payment_return")
        url.searchParams.delete("order_id")
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
      })
  }, [processPaymentReturn, refresh])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={children ? undefined : "申请充值积分"}
        className={triggerClassName || "inline-flex items-center gap-1 rounded-lg border border-[#1677FF] bg-gradient-to-r from-[#1677FF] to-[#00C8FF] px-2.5 py-1.5 text-[11px] font-medium text-white shadow-sm shadow-blue-500/20 transition hover:brightness-105"}
      >
        {children || (
          <>
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">申请充值</span>
          </>
        )}
      </button>
      {open && <RechargeDialog initialPackageKey={initialPackageKey} onClose={() => setOpen(false)} />}
      {processPaymentReturn && paymentReturn !== "idle" && (
        <div
          role="status"
          className={`fixed right-4 bottom-4 z-[10000] max-w-sm rounded-lg px-4 py-3 text-sm font-medium text-white shadow-xl ${
            paymentReturn === "credited"
              ? "bg-emerald-600"
              : paymentReturn === "failed"
                ? "bg-rose-600"
                : "bg-[#0958D9]"
          }`}
        >
          {paymentReturn === "syncing" && "正在确认支付到账状态..."}
          {paymentReturn === "credited" && "支付成功，积分已到账，VIP1 权益已同步。"}
          {paymentReturn === "pending" && "支付结果仍在确认中，请稍后刷新积分。"}
          {paymentReturn === "failed" && "暂未确认到账，请稍后在账单中刷新支付状态。"}
        </div>
      )}
    </>
  )
}

function RechargeDialog({
  initialPackageKey,
  onClose,
}: {
  initialPackageKey: ActiveRechargePackageKey
  onClose: () => void
}) {
  const { refresh, membership } = useCredits()
  const requestedPackage = RECHARGE_PACKAGES.find(pkg => pkg.key === initialPackageKey)
  const resolvedInitialPackageKey: ActiveRechargePackageKey = membership.active && requestedPackage?.firstPurchaseOnly
    ? "growth_298"
    : initialPackageKey
  const [step, setStep] = useState<RechargeStep>("package")
  const [requestedPackageKey, setRequestedPackageKey] = useState<ActiveRechargePackageKey>(resolvedInitialPackageKey)
  const [paymentMethod, setPaymentMethod] = useState<RechargePaymentMethod>("wechat")
  const [paymentOptions, setPaymentOptions] = useState<PaymentOptions>({
    alipay: false,
    wechat: { enabled: false, native: false, h5: false },
    manualTransfer: true,
    firstPurchase: {
      available: !membership.active,
      reason: membership.active ? "completed_purchase" : null,
    },
  })
  const [checkoutPending, setCheckoutPending] = useState(false)
  const [checkoutError, setCheckoutError] = useState("")
  const [wechatCheckout, setWechatCheckout] = useState<WechatCheckout | null>(null)
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
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("recharge-dialog-scroll")?.scrollTo({ top: 0, behavior: "auto" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [step])

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/recharge/payment-options", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(response => response.ok ? response.json() as Promise<PaymentOptions> : null)
      .then(options => {
        if (options) setPaymentOptions(options)
      })
      .catch(error => {
        if (error instanceof Error && error.name !== "AbortError") {
          console.warn("Failed to load payment options", error)
        }
      })
    return () => controller.abort()
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
  const requestedSelection = RECHARGE_PACKAGES.find(pkg => pkg.key === requestedPackageKey)
  const packageKey: ActiveRechargePackageKey = requestedSelection?.firstPurchaseOnly
    && !paymentOptions.firstPurchase.available
    ? "growth_298"
    : requestedPackageKey
  const selectedPackage = RECHARGE_PACKAGES.find(pkg => pkg.key === packageKey) ?? RECHARGE_PACKAGES[0]
  const wechatAvailable = paymentOptions.wechat.enabled
    || RECHARGE_PAYMENT_INFO.qrCodes.some(code => code.method === "wechat")
  const alipayAvailable = paymentOptions.alipay
    || RECHARGE_PAYMENT_INFO.qrCodes.some(code => code.method === "alipay")
  const bankAvailable = paymentOptions.manualTransfer && hasAccountInfo
  const officialAlipay = paymentMethod === "alipay" && paymentOptions.alipay
  const officialWechat = paymentMethod === "wechat" && paymentOptions.wechat.enabled
  const officialPayment = officialAlipay || officialWechat

  function goToPaymentStep() {
    setCheckoutError("")
    if (paymentMethod === "wechat" && !wechatAvailable) {
      setPaymentMethod(alipayAvailable ? "alipay" : "manual_transfer")
    } else if (paymentMethod === "alipay" && !alipayAvailable) {
      setPaymentMethod(wechatAvailable ? "wechat" : "manual_transfer")
    } else if (paymentMethod === "manual_transfer" && !bankAvailable) {
      setPaymentMethod(wechatAvailable ? "wechat" : "alipay")
    }
    setStep("payment")
  }

  function selectPaymentMethod(method: RechargePaymentMethod) {
    if (wechatCheckout) return
    setCheckoutError("")
    setPaymentMethod(method)
  }

  async function startAlipayCheckout() {
    setCheckoutPending(true)
    setCheckoutError("")
    try {
      const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
      const response = await fetch("/api/recharge/payments/alipay", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageKey, channel: mobile ? "wap" : "page" }),
      })
      const payload = await response.json() as { paymentUrl?: string; error?: string }
      if (!response.ok || !payload.paymentUrl) {
        throw new Error(payload.error || "支付宝下单失败")
      }
      window.location.assign(payload.paymentUrl)
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "支付宝下单失败，请稍后重试")
      setCheckoutPending(false)
    }
  }

  const syncWechatCheckout = useCallback(async (orderId: string, silent = false) => {
    try {
      const response = await fetch(`/api/recharge/payments/wechat/${encodeURIComponent(orderId)}/sync`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      })
      const payload = await response.json() as { status?: string; error?: string }
      if (!response.ok) throw new Error(payload.error || "微信支付状态查询失败")
      if (payload.status === "credited") {
        setWechatCheckout(current => current?.orderId === orderId
          ? { ...current, status: "credited" }
          : current)
        await refresh()
      }
    } catch (error) {
      if (!silent) {
        setCheckoutError(error instanceof Error ? error.message : "微信支付状态查询失败")
      }
    }
  }, [refresh])

  useEffect(() => {
    if (!wechatCheckout || wechatCheckout.status !== "waiting") return
    let stopped = false
    let timer = 0
    const poll = async () => {
      if (Date.now() >= wechatCheckout.expiresAt) {
        setWechatCheckout(current => current?.orderId === wechatCheckout.orderId
          ? { ...current, status: "expired" }
          : current)
        return
      }
      await syncWechatCheckout(wechatCheckout.orderId, true)
      if (!stopped) timer = window.setTimeout(poll, 3_000)
    }
    timer = window.setTimeout(poll, 2_500)
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [wechatCheckout, syncWechatCheckout])

  useEffect(() => {
    if (!wechatCheckout) return
    const frame = window.requestAnimationFrame(() => {
      const container = document.getElementById("recharge-dialog-scroll")
      const target = document.getElementById("wechat-official-checkout")
      if (!container || !target) return
      const top = target.getBoundingClientRect().top
        - container.getBoundingClientRect().top
        + container.scrollTop
        - 12
      container.scrollTo({ top, behavior: "auto" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [wechatCheckout])

  async function startWechatCheckout() {
    setCheckoutPending(true)
    setCheckoutError("")
    setWechatCheckout(null)
    try {
      const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
      const channel = mobile && paymentOptions.wechat.h5
        ? "h5"
        : paymentOptions.wechat.native
          ? "native"
          : "h5"
      const response = await fetch("/api/recharge/payments/wechat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageKey, channel }),
      })
      const payload = await response.json() as {
        orderId?: string
        outTradeNo?: string
        qrCodeDataUrl?: string
        paymentUrl?: string
        expiresAt?: number
        error?: string
      }
      if (!response.ok || !payload.orderId || !payload.expiresAt) {
        throw new Error(payload.error || "微信支付下单失败")
      }
      if (payload.paymentUrl) {
        window.location.assign(payload.paymentUrl)
        return
      }
      if (!payload.qrCodeDataUrl || !payload.outTradeNo) {
        throw new Error("微信支付下单结果不完整")
      }
      setWechatCheckout({
        orderId: payload.orderId,
        outTradeNo: payload.outTradeNo,
        qrCodeDataUrl: payload.qrCodeDataUrl,
        expiresAt: payload.expiresAt,
        status: "waiting",
      })
      setCheckoutPending(false)
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "微信支付下单失败，请稍后重试")
      setCheckoutPending(false)
    }
  }

  const paymentMethods = [
    {
      id: "wechat" as const,
      label: "微信支付",
      description: paymentOptions.wechat.enabled ? "微信官方支付" : "扫码后提交",
      enabled: wechatAvailable,
    },
    {
      id: "alipay" as const,
      label: "支付宝",
      description: paymentOptions.alipay ? "支付宝官方收银台" : "扫码后提交",
      enabled: alipayAvailable,
    },
    {
      id: "manual_transfer" as const,
      label: "银行支付",
      description: "企业对公转账",
      enabled: bankAvailable,
    },
  ]

  const dialog = (
    <div
      className="fixed inset-0 z-[9999] overflow-hidden bg-black/50 px-3 py-3 backdrop-blur-sm animate-fade-in sm:px-6 sm:py-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="flex min-h-full items-center justify-center">
        <div
          className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl ring-1 ring-slate-200 sm:max-h-[92dvh]"
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-10 p-1.5 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="relative shrink-0 overflow-hidden border-b border-cyan-200/20 bg-[linear-gradient(112deg,#001D66_0%,#003EB3_46%,#1677FF_78%,#00AEEF_100%)] px-5 py-4 text-white sm:px-7 sm:py-5">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-20"
              style={{
                backgroundImage: "linear-gradient(rgba(255,255,255,.18) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.14) 1px, transparent 1px)",
                backgroundSize: "26px 26px",
              }}
            />
            <div className="relative flex items-center gap-3 pr-10">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/14 ring-1 ring-white/25 shadow-[0_12px_30px_-16px_rgba(0,200,255,0.9)]">
                <Gem className="h-5 w-5 text-cyan-100" />
              </span>
              <div className="min-w-0">
                <h2 className="geo-display-title text-xl text-white">积分充值</h2>
                <p className="mt-0.5 text-xs text-blue-50">首充 ¥9.9 解锁 VIP1，积分到账后立即可用</p>
              </div>
              <div className="ml-auto hidden shrink-0 items-baseline gap-2 rounded-lg bg-white/12 px-3 py-2 ring-1 ring-white/20 sm:flex">
                <span className="text-[10px] font-semibold text-cyan-100">首购专享</span>
                <span className="font-mono text-xl font-bold text-white">4.5 折</span>
              </div>
            </div>
          </div>

          <div className="shrink-0 border-b border-slate-100 bg-white px-5 py-3 sm:px-7">
            <div className="mx-auto grid max-w-md grid-cols-[1fr_36px_1fr] items-center">
              <div className={`flex items-center gap-2 ${step === "package" ? "text-[#0958D9]" : "text-emerald-700"}`}>
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  step === "package" ? "bg-[#1677FF] text-white" : "bg-emerald-100 text-emerald-700"
                }`}>
                  {step === "payment" ? <Check className="h-3.5 w-3.5" /> : "1"}
                </span>
                <span className="text-xs font-semibold sm:text-sm">选择套餐</span>
              </div>
              <span className={`h-px ${step === "payment" ? "bg-emerald-300" : "bg-slate-200"}`} />
              <div className={`flex items-center justify-end gap-2 ${step === "payment" ? "text-[#0958D9]" : "text-slate-400"}`}>
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  step === "payment" ? "bg-[#1677FF] text-white" : "bg-slate-100 text-slate-500"
                }`}>
                  2
                </span>
                <span className="text-xs font-semibold sm:text-sm">付款方式</span>
              </div>
            </div>
          </div>

          <div
            id="recharge-dialog-scroll"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7"
          >
            {submitted ? (
              <>
                <p className="text-sm text-slate-600 leading-relaxed">
                  已提交 <span className="font-bold text-slate-900">{state!.ok && state!.packageName}</span>
                  充值申请，到账积分{" "}
                  <span className="font-mono font-bold text-slate-900">
                    {state!.ok && state!.credits}
                  </span>
                  。管理员核对到账后会审批加积分。
                  首次真实充值到账后会同时解锁 VIP1。
                </p>
                {state!.ok && state!.paymentOutTradeNo && (
                  <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
                    订单号：
                    <span className="font-mono text-slate-900">{state!.paymentOutTradeNo}</span>
                  </div>
                )}
                <button
                  onClick={onClose}
                  className="mt-6 w-full rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00C8FF] py-2.5 text-sm font-medium text-white transition hover:brightness-105"
                >
                  好的
                </button>
              </>
            ) : (
            <form action={formAction} className="min-h-0">
              <input type="hidden" name="packageKey" value={packageKey} />
              <input type="hidden" name="paymentMethod" value={paymentMethod} />

              {step === "package" ? (
                <>
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <h3 className="text-base font-semibold text-slate-950">选择充值套餐</h3>
                      <p className="mt-1 text-xs leading-5 text-slate-500">套餐越高，每积分价格越低。</p>
                    </div>
                    <span className="hidden text-right font-mono text-[10px] text-slate-400 sm:block">
                      所有到账积分永久有效
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-lg bg-[linear-gradient(110deg,#FFF7E6_0%,#F0F7FF_48%,#E8FBFF_100%)] ring-1 ring-[#B7D7FF]">
                    <div className="flex min-h-16 flex-col items-center justify-center gap-1 border-r border-white/80 px-2 py-2 text-center sm:flex-row sm:text-left">
                      <BadgePercent className="h-4 w-4 shrink-0 text-amber-600" />
                      <span className="text-[10px] font-semibold leading-4 text-amber-900 sm:text-[11px]">首购省 55%</span>
                    </div>
                    <div className="flex min-h-16 flex-col items-center justify-center gap-1 border-r border-white/80 px-2 py-2 text-center sm:flex-row sm:text-left">
                      <ShieldCheck className="h-4 w-4 shrink-0 text-[#1677FF]" />
                      <span className="text-[10px] font-semibold leading-4 text-[#003EB3] sm:text-[11px]">到账解锁 VIP1</span>
                    </div>
                    <div className="flex min-h-16 flex-col items-center justify-center gap-1 px-2 py-2 text-center sm:flex-row sm:text-left">
                      <FileBadge2 className="h-4 w-4 shrink-0 text-cyan-700" />
                      <span className="text-[10px] font-semibold leading-4 text-cyan-900 sm:text-[11px]">白标报告 9 积分</span>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {RECHARGE_PACKAGES.map(pkg => {
                      const selected = packageKey === pkg.key
                      const locked = pkg.firstPurchaseOnly && !paymentOptions.firstPurchase.available
                      const savings = rechargeSavingsPercent(pkg)
                      const reportUses = estimatePackageFeatureUses(pkg, "reportCustomBranding")
                      const highlighted = pkg.kind === "intro" || pkg.recommended
                      const cardStyle = locked
                        ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-65"
                        : selected && pkg.kind === "intro"
                          ? "border-amber-400 bg-[linear-gradient(135deg,#FFF8E7_0%,#F1F8FF_100%)] shadow-[0_14px_30px_-20px_rgba(245,158,11,0.9)] ring-2 ring-amber-300/30"
                          : selected
                            ? "border-[#1677FF] bg-[#EEF6FF] shadow-[0_14px_30px_-20px_rgba(22,119,255,0.9)] ring-2 ring-[#1677FF]/15"
                            : highlighted
                              ? "border-[#91CAFF] bg-[#F7FBFF] hover:-translate-y-0.5 hover:border-[#1677FF] hover:shadow-md"
                              : "border-slate-200 bg-white hover:-translate-y-0.5 hover:border-[#69B1FF] hover:bg-[#F7FBFF] hover:shadow-md"
                      return (
                        <button
                          key={pkg.key}
                          type="button"
                          onClick={() => {
                            if (!locked) setRequestedPackageKey(pkg.key)
                          }}
                          disabled={locked}
                          aria-pressed={selected}
                          className={`relative min-h-[148px] rounded-lg border px-4 py-3.5 text-left transition ${cardStyle}`}
                        >
                          {selected ? (
                            <span className={`absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full text-white ${pkg.kind === "intro" ? "bg-amber-500" : "bg-[#1677FF]"}`}>
                              <Check className="h-3 w-3" />
                            </span>
                          ) : null}
                          <span className="flex min-h-6 items-center gap-2 pr-7">
                            <span className="text-sm font-semibold text-slate-950">{pkg.name}</span>
                            {locked ? (
                              <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                                {paymentOptions.firstPurchase.reason === "active_intro_order" ? "已有待支付" : "首购已使用"}
                              </span>
                            ) : pkg.badge ? (
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${pkg.kind === "intro" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-[#0958D9]"}`}>
                                {pkg.badge}
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-2.5 flex items-end justify-between gap-3">
                            <span className="font-mono text-2xl font-bold text-slate-950">{formatYuan(pkg.priceCents)}</span>
                            <span className="font-mono text-sm font-bold text-[#0958D9]">{pkg.credits} 积分</span>
                          </span>
                          <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-200/70 pt-2 font-mono text-[10px] text-slate-500">
                            <span>¥{rechargeUnitPrice(pkg).toFixed(3)}/积分</span>
                            <span>白标报告约 {reportUses} 份</span>
                            {savings > 0 && pkg.kind !== "intro" ? <span className="text-emerald-700">省 {savings}%</span> : null}
                          </span>
                          <span className="mt-1.5 block text-[11px] leading-4 text-slate-500">{pkg.description}</span>
                        </button>
                      )
                    })}
                  </div>

                  <p className="mt-4 text-[11px] leading-5 text-slate-500">
                    首购体验包每个账号仅限购买一次。继续即表示你同意
                    <Link href="/recharge-rules" target="_blank" className="mx-1 font-medium text-[#0958D9] hover:text-[#003EB3]">
                      充值与退款规则
                    </Link>
                    。
                  </p>

                  <div className="sticky bottom-0 -mx-5 mt-6 flex items-center gap-2 border-t border-slate-100 bg-white/95 px-5 py-3 backdrop-blur sm:-mx-7 sm:px-7">
                    <button
                      type="button"
                      onClick={onClose}
                      className="h-11 shrink-0 rounded-lg bg-white px-4 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
                    >
                      取消
                    </button>
                    <div className="hidden min-w-0 flex-1 px-2 sm:block">
                      <p className="truncate text-[10px] text-slate-400">已选 {selectedPackage.name}</p>
                      <p className="mt-0.5 font-mono text-xs font-semibold text-slate-800">
                        {selectedPackage.credits} 积分 · {formatYuan(selectedPackage.priceCents)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={goToPaymentStep}
                      className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[#1677FF] via-[#0B8DFF] to-[#00AEEF] px-4 text-sm font-semibold text-white transition hover:brightness-105 hover:shadow-lg hover:shadow-blue-300/40 sm:flex-none"
                    >
                      下一步 · 选择付款方式
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-4 rounded-lg bg-[linear-gradient(110deg,#EEF6FF_0%,#E8FBFF_100%)] px-4 py-3 ring-1 ring-[#91CAFF]">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-[#0958D9]">已选套餐</p>
                      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="text-sm font-semibold text-slate-950">{selectedPackage.name}</span>
                        <span className="text-lg font-bold text-slate-950">{formatYuan(selectedPackage.priceCents)}</span>
                        <span className="font-mono text-xs font-semibold text-[#0958D9]">+{selectedPackage.credits} 积分</span>
                      </div>
                      <p className="mt-1 font-mono text-[10px] text-slate-500">
                        ¥{rechargeUnitPrice(selectedPackage).toFixed(3)}/积分 · 白标报告约 {estimatePackageFeatureUses(selectedPackage, "reportCustomBranding")} 份
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStep("package")}
                      disabled={Boolean(wechatCheckout)}
                      className="shrink-0 text-xs font-semibold text-[#0958D9] transition hover:text-[#003EB3] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      更换套餐
                    </button>
                  </div>

                  <div className="mt-5">
                    <h3 className="text-base font-semibold text-slate-950">选择付款方式</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">微信和支付宝支付成功后自动到账，银行支付需提交付款信息。</p>
                  </div>

                  <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
                    {paymentMethods.map(method => {
                      const selected = paymentMethod === method.id
                      return (
                        <button
                          key={method.id}
                          type="button"
                          onClick={() => selectPaymentMethod(method.id)}
                          disabled={!method.enabled || Boolean(wechatCheckout)}
                          aria-pressed={selected}
                          aria-label={`${method.label}：${method.enabled ? method.description : "暂不可用"}`}
                          className={`relative flex min-h-[102px] flex-col items-start justify-between gap-2 rounded-lg border px-3.5 py-3 text-left transition ${
                            selected
                              ? "border-[#1677FF] bg-[#F3F8FF] ring-2 ring-[#1677FF]/10"
                              : "border-slate-200 bg-white hover:border-[#69B1FF] hover:bg-slate-50"
                          } disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-55`}
                        >
                          <span className="sr-only">{method.label}</span>
                          <PaymentBrandMark method={method.id} />
                          <span className="block text-[11px] leading-4 text-slate-500">
                            {method.enabled ? method.description : "暂不可用"}
                          </span>
                          {selected ? (
                            <span className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-[#1677FF] text-white">
                              <Check className="h-2.5 w-2.5" />
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>

                  <PaymentMethodInfo
                    hasAccountInfo={hasAccountInfo}
                    paymentMethod={paymentMethod}
                    officialAlipay={officialAlipay}
                    officialWechat={officialWechat}
                    wechatCheckout={wechatCheckout}
                    onWechatSync={() => {
                      if (wechatCheckout) void syncWechatCheckout(wechatCheckout.orderId)
                    }}
                    selectedQrCode={selectedQrCode}
                  />

                  {!officialPayment ? (
                    <>
                      <label className="mt-4 block text-xs font-medium text-slate-700">
                        付款人 / 付款账户名（推荐）
                      </label>
                      <input
                        name="payerName"
                        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/20"
                        placeholder="例如：公司名称、微信昵称、支付宝实名"
                      />

                      <label className="mt-4 block text-xs font-medium text-slate-700">
                        付款凭证 / 流水号（推荐）
                      </label>
                      <input
                        name="paymentReference"
                        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/20"
                        placeholder="例如：转账单号、交易号、付款截图链接"
                      />

                      <label className="mt-4 block text-xs font-medium text-slate-700">
                        联系方式（选填）
                      </label>
                      <input
                        name="contact"
                        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/20"
                        placeholder="例如：手机号、微信号、邮箱"
                      />

                      <label className="mt-4 block text-xs font-medium text-slate-700">
                        付款备注（选填）
                      </label>
                      <textarea
                        name="note"
                        rows={2}
                        className="mt-1.5 w-full resize-none rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/20"
                        placeholder="例如：已对公付款 / 微信昵称 / 转账时间"
                      />
                    </>
                  ) : null}

                  <div className="mt-4 flex gap-2.5 rounded-lg bg-slate-50 px-3.5 py-3 text-[11px] leading-5 text-slate-600 ring-1 ring-slate-200">
                    <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-[#1677FF]" />
                    <p>
                      {officialPayment
                        ? "官方支付通道会核验支付平台签名和实付金额，付款成功后积分自动到账。"
                        : RECHARGE_PAYMENT_INFO.notice}
                    </p>
                  </div>

                  <CustomerServiceInfo />

                  {state && !state.ok ? (
                    <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 ring-1 ring-rose-200">
                      {state.error}
                      {state.code === "UNAUTHENTICATED" ? (
                        <Link
                          href="/sign-in?redirect_url=/workspace"
                          className="ml-1 font-semibold underline underline-offset-2"
                        >
                          重新登录
                        </Link>
                      ) : null}
                    </div>
                  ) : null}

                  {checkoutError ? (
                    <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 ring-1 ring-rose-200">
                      {checkoutError}
                    </div>
                  ) : null}

                  <div className="sticky bottom-0 -mx-5 mt-6 flex gap-2 border-t border-slate-100 bg-white/95 px-5 py-3 backdrop-blur sm:-mx-7 sm:px-7">
                    <button
                      type="button"
                      onClick={() => setStep("package")}
                      disabled={Boolean(wechatCheckout)}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-white py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      上一步
                    </button>
                    <button
                      type={officialPayment ? "button" : "submit"}
                      onClick={officialAlipay
                        ? startAlipayCheckout
                        : officialWechat
                          ? (wechatCheckout ? () => void syncWechatCheckout(wechatCheckout.orderId) : startWechatCheckout)
                          : undefined}
                      disabled={pending || checkoutPending || wechatCheckout?.status === "credited"}
                      className="flex flex-1 items-center justify-center whitespace-nowrap rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEF] px-2 py-2.5 text-xs font-semibold text-white transition-all hover:brightness-105 hover:shadow-lg hover:shadow-blue-300/40 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
                    >
                      {officialAlipay
                        ? (checkoutPending ? "正在创建订单..." : `支付宝支付 · ${formatYuan(selectedPackage.priceCents)}`)
                        : officialWechat
                          ? (checkoutPending
                              ? "正在创建订单..."
                              : wechatCheckout?.status === "credited"
                                ? "支付成功"
                                : wechatCheckout
                                  ? "刷新支付状态"
                                  : `微信支付 · ${formatYuan(selectedPackage.priceCents)}`)
                          : (pending ? "提交中..." : `提交申请 · ${formatYuan(selectedPackage.priceCents)}`)}
                    </button>
                  </div>
                </>
              )}
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

function WechatPayBrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex min-w-0 shrink-0 items-center">
      <Image
        src="/recharge/wechat-pay-official.png"
        alt="微信支付"
        width={264}
        height={34}
        className={`${compact ? "h-[18px]" : "h-6"} w-auto max-w-full object-contain`}
        sizes={compact ? "140px" : "187px"}
      />
    </span>
  )
}

function AlipayBrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`flex shrink-0 items-center ${compact ? "gap-1.5" : "gap-2"}`}>
      <span className={`relative block shrink-0 overflow-hidden ${compact ? "h-5 w-6" : "h-8 w-10"}`}>
        <Image
          src="/recharge/alipay-official.png"
          alt=""
          width={302}
          height={68}
          className={`${compact ? "h-5 w-[89px]" : "h-8 w-[142px]"} max-w-none object-left`}
          sizes={compact ? "89px" : "142px"}
        />
      </span>
      <span className={`${compact ? "text-xs" : "text-sm"} font-semibold text-[#1677FF]`}>
        支付宝
      </span>
    </span>
  )
}

function PaymentBrandMark({ method }: { method: RechargePaymentMethod }) {
  if (method === "wechat") return <WechatPayBrandMark />
  if (method === "alipay") return <AlipayBrandMark />

  return (
    <span className="flex shrink-0 items-center gap-2">
      <span className="relative block h-9 w-14 shrink-0 overflow-hidden bg-white">
        <Image
          src="/recharge/unionpay-official.png"
          alt="银联"
          fill
          className="scale-[1.72] object-contain"
          sizes="56px"
        />
      </span>
      <span className="text-sm font-semibold text-slate-950">银行支付</span>
    </span>
  )
}

function CustomerServiceInfo() {
  const wechatId = RECHARGE_PAYMENT_INFO.serviceWechatId
  const qrImageUrl = RECHARGE_PAYMENT_INFO.serviceWechatQrImageUrl

  if (!wechatId && !qrImageUrl) return null

  return (
    <div className="mt-3 rounded-xl bg-emerald-50/70 px-4 py-3 text-xs leading-5 text-slate-700 ring-1 ring-emerald-100">
      <div className="mb-2 flex items-center gap-1.5 font-semibold text-slate-900">
        <Image
          src="/recharge/wechat-official.png"
          alt="微信"
          width={256}
          height={256}
          className="h-5 w-5 rounded-[5px]"
          sizes="20px"
        />
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
  officialAlipay,
  officialWechat,
  wechatCheckout,
  onWechatSync,
  selectedQrCode,
}: {
  hasAccountInfo: boolean
  paymentMethod: string
  officialAlipay: boolean
  officialWechat: boolean
  wechatCheckout: WechatCheckout | null
  onWechatSync: () => void
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

  if (officialWechat) {
    return (
      <div
        id="wechat-official-checkout"
        className="mt-3 scroll-mt-4 scroll-mb-24 rounded-xl bg-emerald-50/70 px-4 py-3 text-xs leading-5 text-slate-700 ring-1 ring-emerald-200"
      >
        <div className="mb-1.5 flex items-center gap-2 font-semibold text-slate-900">
          <WechatPayBrandMark compact />
          <span className="text-[11px] text-emerald-800">官方在线支付</span>
        </div>
        {!wechatCheckout ? (
          <>
            <p>点击下方按钮生成本次订单的微信官方付款码。系统会验证微信签名和实付金额，无需上传付款截图。</p>
            <p className="mt-1 text-[11px] text-slate-500">手机端在 H5 通道审核通过后会自动进入微信收银台。</p>
          </>
        ) : (
          <div className="mt-3 rounded-xl bg-white p-3 ring-1 ring-emerald-200">
            <Image
              src={wechatCheckout.qrCodeDataUrl}
              alt="微信官方支付码"
              width={420}
              height={420}
              unoptimized
              className="mx-auto h-auto w-full max-w-[260px] rounded-lg object-contain"
            />
            <div className="mt-2 text-center">
              {wechatCheckout.status === "waiting" && (
                <>
                  <p className="font-semibold text-emerald-800">请使用微信扫码付款</p>
                  <p className="mt-1 text-[11px] text-slate-500">支付后积分会自动到账，本页将自动刷新状态。</p>
                </>
              )}
              {wechatCheckout.status === "credited" && (
                <p className="font-semibold text-emerald-700">支付成功，积分已自动到账。</p>
              )}
              {wechatCheckout.status === "expired" && (
                <p className="font-semibold text-amber-700">付款码已过期，请关闭窗口后重新发起。</p>
              )}
              <p className="mt-2 break-all font-mono text-[10px] text-slate-400">
                订单号：{wechatCheckout.outTradeNo}
              </p>
              {wechatCheckout.status === "waiting" && (
                <button
                  type="button"
                  onClick={onWechatSync}
                  className="mt-2 text-[11px] font-semibold text-[#0958D9] hover:text-[#003EB3]"
                >
                  我已付款，立即刷新
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (officialAlipay) {
    return (
      <div className="mt-3 rounded-xl bg-[#EEF6FF] px-4 py-3 text-xs leading-5 text-slate-700 ring-1 ring-[#BAE0FF]">
        <div className="mb-1.5 flex items-center gap-2 font-semibold text-slate-900">
          <AlipayBrandMark compact />
          <span className="text-[11px] text-[#0958D9]">官方在线支付</span>
        </div>
        <p>点击下方按钮进入支付宝官方收银台。系统以支付平台签名回调和订单主动查询双重确认到账，不需要上传付款截图。</p>
        <p className="mt-1 text-[11px] text-slate-500">支付成功后请返回本系统，积分通常会在数秒内自动到账。</p>
      </div>
    )
  }

  if (paymentMethod === "wechat" || paymentMethod === "alipay") {
    return (
      <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-700 ring-1 ring-slate-200">
        <div className="mb-2 flex items-center gap-2 font-semibold text-slate-900">
          {paymentMethod === "wechat" ? <WechatPayBrandMark compact /> : <AlipayBrandMark compact />}
          <span className="text-[11px] text-slate-600">收款码</span>
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
