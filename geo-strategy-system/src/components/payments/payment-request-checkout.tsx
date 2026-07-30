"use client"

import Image from "next/image"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import {
  ArrowLeft,
  BadgeCheck,
  Banknote,
  CheckCircle2,
  Clock3,
  Copy,
  Loader2,
  LockKeyhole,
  Mail,
  ReceiptText,
  ShieldCheck,
} from "lucide-react"
import type { AdminPaymentRequest } from "@/lib/admin-payment-request-types"
import type { PaymentOrderStatus, PaymentProvider } from "@/lib/payment-types"
import { useCredits } from "@/components/credits/credits-provider"
import SiteFooter from "@/components/site-footer"

type PaymentOptions = {
  alipay: boolean
  wechat: {
    enabled: boolean
    native: boolean
    h5: boolean
  }
  manualTransfer: boolean
}

type BankInfo = {
  accountName?: string
  creditCode?: string
  accountNo?: string
  bankName?: string
  bankCode?: string
  serviceWechatId?: string
}

type CheckoutPayload = {
  requestId?: string
  orderId?: string
  provider?: string
  paymentUrl?: string
  qrCodeDataUrl?: string
  expiresAt?: number
  error?: string
}

type PublicOrder = {
  id: string
  provider: PaymentProvider
  status: PaymentOrderStatus
  creditedAt?: number
}

function formatTime(value?: number): string {
  if (!value) return "-"
  return new Date(value).toLocaleString("zh-CN", { hour12: false })
}

function providerLabel(provider?: AdminPaymentRequest["selectedProvider"]): string {
  if (provider === "wechat") return "微信支付"
  if (provider === "alipay") return "支付宝"
  if (provider === "manual_transfer") return "银行转账"
  return "待选择"
}

export function PaymentRequestCheckout({
  initialRequest,
  initialOrder,
  paymentOptions,
  bankInfo,
}: {
  initialRequest: AdminPaymentRequest
  initialOrder: PublicOrder | null
  paymentOptions: PaymentOptions
  bankInfo: BankInfo
}) {
  const { refresh: refreshCredits } = useCredits()
  const [now, setNow] = useState(0)
  const [requestRecord, setRequestRecord] = useState(initialRequest)
  const [order, setOrder] = useState(initialOrder)
  const [selected, setSelected] = useState<Exclude<PaymentProvider, "other"> | null>(
    initialRequest.selectedProvider || null,
  )
  const [checkout, setCheckout] = useState<CheckoutPayload | null>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null)
  const [copied, setCopied] = useState("")

  const status = requestRecord.status
  const canPay = status === "pending" && (now === 0 || requestRecord.expiresAt > now)
  const lockedProvider = Boolean(requestRecord.selectedProvider)
  const availableMethods = useMemo(() => [
    {
      id: "wechat" as const,
      label: "微信支付",
      detail: paymentOptions.wechat.enabled ? "微信官方安全收银" : "暂不可用",
      enabled: paymentOptions.wechat.enabled,
      logo: "/recharge/wechat-pay-official.png",
    },
    {
      id: "alipay" as const,
      label: "支付宝",
      detail: paymentOptions.alipay ? "支付宝官方收银台" : "暂不可用",
      enabled: paymentOptions.alipay,
      logo: "/recharge/alipay-official.png",
    },
    {
      id: "manual_transfer" as const,
      label: "银行转账",
      detail: "企业对公账户",
      enabled: paymentOptions.manualTransfer,
      logo: "/recharge/unionpay-official.png",
    },
  ], [paymentOptions])

  useEffect(() => {
    const initial = window.setTimeout(() => setNow(Date.now()), 0)
    const interval = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(interval)
    }
  }, [])

  const syncPayment = useCallback(async (
    provider: "wechat" | "alipay",
    orderId: string,
    silent = false,
  ) => {
    try {
      const response = await fetch(
        `/api/recharge/payments/${provider}/${encodeURIComponent(orderId)}/sync`,
        { method: "POST", credentials: "same-origin", cache: "no-store" },
      )
      const payload = await response.json() as {
        status?: PaymentOrderStatus
        creditedAt?: number
        error?: string
      }
      if (!response.ok) throw new Error(payload.error || "支付状态查询失败")
      if (payload.status === "credited") {
        setOrder(current => current ? {
          ...current,
          status: "credited",
          creditedAt: payload.creditedAt,
        } : current)
        setRequestRecord(current => ({
          ...current,
          status: "credited",
          creditedAt: payload.creditedAt || Date.now(),
        }))
        setMessage({ kind: "success", text: "支付成功，积分已到账，VIP 等级已同步更新。" })
        await refreshCredits()
        return true
      }
      if (!silent) setMessage({ kind: "info", text: "暂未查询到付款结果，请完成付款后再次确认。" })
      return false
    } catch (error) {
      if (!silent) {
        setMessage({ kind: "error", text: error instanceof Error ? error.message : "支付状态查询失败" })
      }
      return false
    }
  }, [refreshCredits])

  useEffect(() => {
    const url = new URL(window.location.href)
    const returnProvider = url.searchParams.get("payment_return")
    const orderId = url.searchParams.get("order_id")
    if ((returnProvider !== "wechat" && returnProvider !== "alipay") || !orderId) return
    url.searchParams.delete("payment_return")
    url.searchParams.delete("order_id")
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
    queueMicrotask(() => {
      setMessage({ kind: "info", text: "正在确认付款结果..." })
      void syncPayment(returnProvider, orderId)
    })
  }, [syncPayment])

  useEffect(() => {
    if (
      !checkout?.orderId
      || checkout.provider !== "wechat"
      || !checkout.qrCodeDataUrl
      || order?.status === "credited"
    ) return
    let stopped = false
    let timer = 0
    const poll = async () => {
      if (checkout.expiresAt && checkout.expiresAt <= Date.now()) {
        if (!stopped) setMessage({ kind: "info", text: "当前二维码已过期，请重新生成。" })
        return
      }
      const credited = await syncPayment("wechat", checkout.orderId || "", true)
      if (!stopped && !credited) timer = window.setTimeout(poll, 3_000)
    }
    timer = window.setTimeout(poll, 2_500)
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [checkout, order?.status, syncPayment])

  async function startCheckout() {
    if (!selected) {
      setMessage({ kind: "error", text: "请先选择付款方式" })
      return
    }
    setPending(true)
    setMessage(null)
    try {
      const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
      const response = await fetch(
        `/api/payment-requests/${encodeURIComponent(requestRecord.id)}/checkout`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: selected,
            channel: selected === "alipay"
              ? mobile ? "wap" : "page"
              : selected === "wechat" && mobile ? "h5" : "native",
          }),
        },
      )
      const payload = await response.json() as CheckoutPayload
      if (!response.ok || !payload.orderId) throw new Error(payload.error || "支付下单失败")
      setOrder({
        id: payload.orderId,
        provider: selected,
        status: "pending",
      })
      setRequestRecord(current => ({
        ...current,
        selectedProvider: selected,
        activePaymentOrderId: payload.orderId,
      }))
      setCheckout(payload)
      if (payload.paymentUrl) {
        window.location.assign(payload.paymentUrl)
        return
      }
      if (selected === "manual_transfer") {
        setMessage({ kind: "info", text: "请完成对公转账，并在下方提交付款信息。" })
      }
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "支付下单失败" })
    } finally {
      setPending(false)
    }
  }

  async function submitBankTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setMessage(null)
    const formData = new FormData(event.currentTarget)
    try {
      const response = await fetch(
        `/api/payment-requests/${encodeURIComponent(requestRecord.id)}/bank-transfer`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payerName: formData.get("payerName"),
            paymentReference: formData.get("paymentReference"),
            contact: formData.get("contact"),
          }),
        },
      )
      const payload = await response.json() as {
        request?: AdminPaymentRequest
        message?: string
        error?: string
      }
      if (!response.ok || !payload.request) throw new Error(payload.error || "转账信息提交失败")
      setRequestRecord(payload.request)
      setMessage({ kind: "success", text: payload.message || "转账信息已提交，等待管理员核对。" })
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "转账信息提交失败" })
    } finally {
      setPending(false)
    }
  }

  async function copy(value: string | undefined, label: string) {
    if (!value) return
    await navigator.clipboard.writeText(value)
    setCopied(label)
    window.setTimeout(() => setCopied(""), 1_500)
  }

  return (
    <div className="min-h-screen bg-[#F2F7FD] text-slate-900">
      <header className="sticky top-0 z-30 border-b border-[#CFE4FA] bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/account?tab=billing" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-[#69B1FF] hover:text-[#0958D9]">
            <ArrowLeft className="h-4 w-4" />
            返回我的主页
          </Link>
          <Image src="/brand/shitu-lockup-transparent-v2.png" alt="势途 GEO" width={150} height={45} className="h-9 w-auto object-contain" priority />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-9">
        <section className="overflow-hidden rounded-xl border border-[#B7D9FF] bg-white shadow-[0_24px_70px_-40px_rgba(9,88,217,.6)]">
          <div className="bg-[linear-gradient(118deg,#001D66_0%,#0958D9_48%,#00AEEA_100%)] px-5 py-6 text-white sm:px-8 sm:py-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-cyan-100">
                  <ShieldCheck className="h-4 w-4" />
                  势途 GEO 安全付款订单
                </div>
                <h1 className="mt-3 text-xl font-bold sm:text-2xl">{requestRecord.title}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100/85">
                  {requestRecord.note || "完成付款后，积分将自动加入当前账号，并同步计算 VIP 累计充值等级。"}
                </p>
              </div>
              <div className="shrink-0">
                <div className="text-xs text-cyan-100/75">应付金额</div>
                <div className="mt-1 font-mono text-4xl font-bold">¥{(requestRecord.priceCents / 100).toFixed(2)}</div>
              </div>
            </div>
          </div>

          <div className="grid gap-px bg-[#DCEAF8] sm:grid-cols-4">
            <OrderMetric icon={ReceiptText} label="到账积分" value={`${requestRecord.credits} 积分`} />
            <OrderMetric icon={Clock3} label="有效期至" value={formatTime(requestRecord.expiresAt)} />
            <OrderMetric icon={Banknote} label="付款方式" value={providerLabel(requestRecord.selectedProvider)} />
            <OrderMetric icon={Mail} label="接收账号" value={requestRecord.email} />
          </div>

          <div className="p-4 sm:p-7">
            {status === "credited" || order?.status === "credited" ? (
              <ResultState
                icon={<CheckCircle2 className="h-8 w-8" />}
                title="付款成功，积分已到账"
                detail={`${requestRecord.credits} 积分已经加入当前账号，VIP 等级也已同步更新。`}
                tone="success"
              />
            ) : status === "canceled" ? (
              <ResultState
                icon={<LockKeyhole className="h-8 w-8" />}
                title="该付款订单已取消"
                detail={requestRecord.cancelReason || "无需继续付款，如有疑问请联系管理员。"}
                tone="muted"
              />
            ) : status === "expired" || requestRecord.expiresAt <= now ? (
              <ResultState
                icon={<Clock3 className="h-8 w-8" />}
                title="该付款订单已过期"
                detail="请联系管理员重新发送付款订单，避免向过期订单付款。"
                tone="warning"
              />
            ) : (
              <>
                <div className="mb-4">
                  <h2 className="text-sm font-bold text-slate-950">
                    {lockedProvider ? "已选择付款方式" : "选择付款方式"}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {lockedProvider
                      ? "为保证支付核对准确，本订单的付款方式确认后不可切换。"
                      : "选择后进入对应官方收银台，银行转账需提交流水号等待核对。"}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  {availableMethods.map(method => {
                    const active = selected === method.id
                    const disabled = !method.enabled || (lockedProvider && requestRecord.selectedProvider !== method.id)
                    return (
                      <button
                        key={method.id}
                        type="button"
                        onClick={() => !disabled && setSelected(method.id)}
                        disabled={disabled}
                        className={`flex min-h-20 items-center gap-3 rounded-lg border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1677FF] focus-visible:ring-offset-2 ${active ? "border-[#1677FF] bg-[#EEF7FF] shadow-sm ring-1 ring-[#1677FF]/25" : "border-slate-200 bg-white hover:border-[#91CAFF] hover:bg-[#F7FBFF]"} disabled:cursor-not-allowed disabled:opacity-45`}
                      >
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
                          <Image src={method.logo} alt="" width={72} height={72} className="h-8 w-8 object-contain" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-slate-900">{method.label}</span>
                          <span className="mt-1 block text-[11px] text-slate-500">{method.detail}</span>
                        </span>
                        {active ? <BadgeCheck className="ml-auto h-5 w-5 shrink-0 text-[#1677FF]" /> : null}
                      </button>
                    )
                  })}
                </div>

                {!checkout?.qrCodeDataUrl && selected !== "manual_transfer" ? (
                  <button
                    type="button"
                    onClick={() => void startCheckout()}
                    disabled={!selected || pending || !canPay}
                    className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-5 text-sm font-bold text-white shadow-sm shadow-blue-500/20 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                  >
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
                    前往安全付款
                  </button>
                ) : null}

                {selected === "wechat" && checkout?.qrCodeDataUrl ? (
                  <div className="mt-5 grid gap-5 border-t border-slate-100 pt-5 sm:grid-cols-[220px_1fr] sm:items-center">
                    <div className="mx-auto overflow-hidden rounded-lg border border-[#B7D9FF] bg-white p-3 shadow-sm">
                      <Image src={checkout.qrCodeDataUrl} alt="微信支付二维码" width={420} height={420} unoptimized className="h-48 w-48" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-950">请使用微信扫码支付</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-500">系统会自动确认到账，无需提交截图。二维码有效期至 {formatTime(checkout.expiresAt)}。</p>
                      <button type="button" onClick={() => checkout.orderId && void syncPayment("wechat", checkout.orderId)} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#91CAFF] bg-[#EEF7FF] px-3 text-xs font-semibold text-[#0958D9]">
                        <Loader2 className="h-3.5 w-3.5" />
                        我已支付，立即确认
                      </button>
                    </div>
                  </div>
                ) : null}

                {selected === "manual_transfer" ? (
                  <div className="mt-5 border-t border-slate-100 pt-5">
                    {!order || order.provider !== "manual_transfer" ? (
                      <button type="button" onClick={() => void startCheckout()} disabled={pending} className="inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-bold text-white disabled:opacity-50">
                        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
                        确认使用银行转账
                      </button>
                    ) : (
                      <div className="grid gap-5 lg:grid-cols-2">
                        <div className="rounded-lg border border-[#CFE4FA] bg-[#F6FAFF] p-4">
                          <h3 className="text-sm font-bold text-slate-950">对公收款账户</h3>
                          <div className="mt-3 divide-y divide-[#DCEAF8]">
                            <BankLine label="账户名称" value={bankInfo.accountName} onCopy={() => void copy(bankInfo.accountName, "账户名称")} copied={copied === "账户名称"} />
                            <BankLine label="账号" value={bankInfo.accountNo} onCopy={() => void copy(bankInfo.accountNo, "账号")} copied={copied === "账号"} />
                            <BankLine label="开户行" value={bankInfo.bankName} onCopy={() => void copy(bankInfo.bankName, "开户行")} copied={copied === "开户行"} />
                            <BankLine label="行号" value={bankInfo.bankCode} onCopy={() => void copy(bankInfo.bankCode, "行号")} copied={copied === "行号"} />
                            <BankLine label="统一信用代码" value={bankInfo.creditCode} onCopy={() => void copy(bankInfo.creditCode, "统一信用代码")} copied={copied === "统一信用代码"} />
                          </div>
                        </div>
                        <form onSubmit={submitBankTransfer} className="rounded-lg border border-slate-200 bg-white p-4">
                          <h3 className="text-sm font-bold text-slate-950">提交付款信息</h3>
                          <div className="mt-3 space-y-3">
                            <Field name="payerName" label="付款人 / 付款企业" defaultValue={requestRecord.payerName} required placeholder="填写实际付款账户名称" />
                            <Field name="paymentReference" label="银行流水号 / 凭证编号" defaultValue={requestRecord.paymentReference} required placeholder="用于管理员核对到账" />
                            <Field name="contact" label="联系电话（选填）" defaultValue={requestRecord.contact} placeholder="核对异常时便于联系" />
                          </div>
                          <button type="submit" disabled={pending} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-bold text-white disabled:opacity-50">
                            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                            {requestRecord.transferSubmittedAt ? "更新付款信息" : "提交并通知管理员"}
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                ) : null}
              </>
            )}

            {message ? (
              <div role="status" className={`mt-5 rounded-lg px-4 py-3 text-sm ${message.kind === "success" ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" : message.kind === "error" ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200" : "bg-blue-50 text-blue-700 ring-1 ring-blue-200"}`}>
                {message.text}
              </div>
            ) : null}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}

function OrderMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ReceiptText
  label: string
  value: string
}) {
  return (
    <div className="min-w-0 bg-[#F8FBFF] px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] text-slate-400"><Icon className="h-3.5 w-3.5" />{label}</div>
      <div className="mt-1 truncate text-xs font-semibold text-slate-800" title={value}>{value}</div>
    </div>
  )
}

function ResultState({
  icon,
  title,
  detail,
  tone,
}: {
  icon: React.ReactNode
  title: string
  detail: string
  tone: "success" | "muted" | "warning"
}) {
  const color = tone === "success"
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : tone === "warning"
      ? "bg-amber-50 text-amber-700 ring-amber-200"
      : "bg-slate-100 text-slate-600 ring-slate-200"
  return (
    <div className="py-8 text-center">
      <span className={`mx-auto flex h-16 w-16 items-center justify-center rounded-xl ring-1 ${color}`}>{icon}</span>
      <h2 className="mt-5 text-xl font-bold text-slate-950">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">{detail}</p>
    </div>
  )
}

function BankLine({
  label,
  value,
  onCopy,
  copied,
}: {
  label: string
  value?: string
  onCopy: () => void
  copied: boolean
}) {
  if (!value) return null
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="w-24 shrink-0 text-xs text-slate-500">{label}</span>
      <span className="min-w-0 flex-1 break-all font-mono text-xs font-semibold text-slate-800">{value}</span>
      <button type="button" onClick={onCopy} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-white hover:text-[#1677FF]" title={`复制${label}`}>
        {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  )
}

function Field({
  name,
  label,
  defaultValue,
  required,
  placeholder,
}: {
  name: string
  label: string
  defaultValue?: string
  required?: boolean
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-700">{label}</span>
      <input name={name} defaultValue={defaultValue} required={required} placeholder={placeholder} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-[#1677FF] focus:bg-white focus:ring-2 focus:ring-[#1677FF]/15" />
    </label>
  )
}
