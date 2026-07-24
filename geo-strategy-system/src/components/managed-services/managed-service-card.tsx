"use client"

import Image from "next/image"
import Link from "next/link"
import { createPortal } from "react-dom"
import { useEffect, useMemo, useState } from "react"
import {
  ArrowRight,
  Building2,
  Check,
  ChevronLeft,
  CircleCheckBig,
  Gem,
  Headphones,
  Loader2,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react"
import {
  MANAGED_SERVICE_PLANS,
  type ManagedServicePlanKey,
} from "@/lib/managed-service-plans"
import { formatYuan } from "@/lib/pricing"
import { RECHARGE_PAYMENT_INFO } from "@/lib/recharge-payment"

type PaymentMethod = "wechat" | "alipay" | "manual_transfer"
type DialogStep = "plan" | "payment" | "result"

type PaymentOptions = {
  alipay: boolean
  wechat: { enabled: boolean; native: boolean; h5: boolean }
  manualTransfer: boolean
}

type CheckoutResult = {
  serviceOrderId: string
  orderId: string
  outTradeNo: string
  provider: PaymentMethod
  channel?: "native" | "h5"
  paymentUrl?: string
  qrCodeDataUrl?: string
  expiresAt?: number
  status?: string
}

export function ManagedServiceCard({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <section className={`relative overflow-hidden border border-[#69B1FF] bg-[linear-gradient(118deg,#001D66_0%,#0958D9_48%,#00B8D9_100%)] text-white shadow-[0_16px_38px_-22px_rgba(9,88,217,.75)] ${compact ? "rounded-lg px-4 py-4" : "rounded-lg px-5 py-5 sm:px-6"}`}>
        <div className="pointer-events-none absolute inset-0 opacity-25" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.13) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.1) 1px,transparent 1px)", backgroundSize: "30px 30px" }} />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-white/12 px-2 py-1 text-[10px] font-semibold ring-1 ring-white/20">
              <Sparkles className="h-3.5 w-3.5 text-cyan-200" />
              官方团队全程交付
            </span>
            <h3 className="mt-2 text-lg font-bold text-white sm:text-xl">专业 GEO 全链路运营团队套餐</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-blue-50/85">
              不想自己操作时，由势途官方团队负责策略、内容执行、监测和周期复盘。每份套餐对应 1 个品牌、公司或个人 IP。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="text-xs text-cyan-100">季度 ¥9,998 起</span>
            <button type="button" onClick={() => setOpen(true)} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-white px-4 text-sm font-semibold text-[#0958D9] shadow-lg transition hover:bg-cyan-50">
              查看运营方案
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>
      {open ? <ManagedServiceDialog onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function ManagedServiceDialog({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<DialogStep>("plan")
  const [planKey, setPlanKey] = useState<ManagedServicePlanKey>("quarterly")
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("wechat")
  const [paymentOptions, setPaymentOptions] = useState<PaymentOptions>({
    alipay: false,
    wechat: { enabled: false, native: false, h5: false },
    manualTransfer: true,
  })
  const [checkout, setCheckout] = useState<CheckoutResult | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [payerName, setPayerName] = useState("")
  const [paymentReference, setPaymentReference] = useState("")
  const [contact, setContact] = useState("")
  const [note, setNote] = useState("")
  const selectedPlan = useMemo(
    () => MANAGED_SERVICE_PLANS.find(plan => plan.key === planKey) || MANAGED_SERVICE_PLANS[0],
    [planKey],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    fetch("/api/recharge/payment-options", { cache: "no-store", credentials: "same-origin" })
      .then(response => response.ok ? response.json() : null)
      .then(value => { if (value) setPaymentOptions(value as PaymentOptions) })
      .catch(() => undefined)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [onClose])

  useEffect(() => {
    if (!checkout?.qrCodeDataUrl || checkout.provider !== "wechat" || checkout.status === "credited" || step !== "result") return
    const timer = window.setInterval(() => void syncWechat(checkout), 3_000)
    return () => window.clearInterval(timer)
  }, [checkout, step])

  async function startCheckout() {
    setPending(true)
    setError("")
    try {
      const response = await fetch("/api/managed-services/checkout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planKey,
          provider: paymentMethod,
          channel: paymentMethod === "wechat"
            && paymentOptions.wechat.h5
            && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || !paymentOptions.wechat.native)
            ? "h5"
            : "native",
          payerName,
          paymentReference,
          contact,
          note,
        }),
      })
      const payload = await response.json() as CheckoutResult & { error?: string }
      if (!response.ok) throw new Error(payload.error || "订单创建失败")
      setCheckout(payload)
      if (payload.paymentUrl) {
        window.location.assign(payload.paymentUrl)
        return
      }
      setStep("result")
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "订单创建失败")
    } finally {
      setPending(false)
    }
  }

  async function syncWechat(current: CheckoutResult) {
    try {
      const response = await fetch(`/api/recharge/payments/wechat/${encodeURIComponent(current.orderId)}/sync`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      })
      const payload = await response.json() as { status?: string }
      if (response.ok && payload.status === "credited") {
        setCheckout(value => value ? { ...value, status: "credited" } : value)
      }
    } catch {
      // Keep polling while the payment page remains open.
    }
  }

  const methods = [
    { id: "wechat" as const, label: "微信支付", enabled: paymentOptions.wechat.enabled },
    { id: "alipay" as const, label: "支付宝", enabled: paymentOptions.alipay },
    { id: "manual_transfer" as const, label: "银行转账", enabled: paymentOptions.manualTransfer },
  ]

  const dialog = (
    <div className="fixed inset-0 z-[11000] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label="专业 GEO 全链路运营套餐">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="关闭" onClick={onClose} />
      <div className="relative flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-lg bg-white shadow-2xl sm:rounded-lg">
        <header className="relative shrink-0 overflow-hidden bg-[linear-gradient(115deg,#001D66,#0958D9_55%,#00B8D9)] px-5 py-4 text-white sm:px-7">
          <button type="button" onClick={onClose} className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/20" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-3 pr-12">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/12 ring-1 ring-white/20"><Gem className="h-5 w-5 text-cyan-100" /></span>
            <div>
              <h2 className="text-lg font-bold">专业 GEO 全链路运营</h2>
              <p className="mt-0.5 text-[11px] text-blue-100">官方团队执行 · 项目独立管理 · 周期复盘</p>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          {step === "plan" ? (
            <>
              <div className="flex items-end justify-between gap-4">
                <div><h3 className="text-base font-semibold text-slate-950">选择服务周期</h3><p className="mt-1 text-xs text-slate-500">服务期从资料确认并正式立项之日起计算。</p></div>
                <span className="hidden text-[10px] text-slate-400 sm:block">每份套餐对应 1 个服务主体</span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {MANAGED_SERVICE_PLANS.map(plan => {
                  const selected = plan.key === planKey
                  return (
                    <button key={plan.key} type="button" onClick={() => setPlanKey(plan.key)} aria-pressed={selected} className={`relative min-h-[176px] rounded-lg border p-4 text-left transition ${selected ? "border-[#1677FF] bg-[#EEF6FF] ring-2 ring-[#1677FF]/15" : "border-slate-200 bg-white hover:border-[#69B1FF] hover:bg-[#F7FBFF]"}`}>
                      {selected ? <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[#1677FF] text-white"><Check className="h-3 w-3" /></span> : null}
                      <span className="text-sm font-semibold text-slate-950">{plan.name}</span>
                      <span className="mt-1 block text-[10px] font-semibold text-[#0958D9]">{plan.badge}</span>
                      <span className="mt-4 block font-mono text-2xl font-bold text-slate-950">{formatYuan(plan.priceCents)}</span>
                      <span className="mt-3 block text-[11px] leading-5 text-slate-500">{plan.description}</span>
                    </button>
                  )
                })}
              </div>
              <div className="mt-4 grid gap-2 rounded-lg bg-slate-50 p-3 text-[11px] text-slate-600 ring-1 ring-slate-200 sm:grid-cols-3">
                <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-[#1677FF]" />官方项目负责人</span>
                <span className="flex items-center gap-1.5"><CircleCheckBig className="h-3.5 w-3.5 text-emerald-600" />专属项目与资料档案</span>
                <span className="flex items-center gap-1.5"><Headphones className="h-3.5 w-3.5 text-cyan-700" />客服与交付进度跟踪</span>
              </div>
              <button type="button" onClick={() => setStep("payment")} className="mt-5 flex h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEF] text-sm font-semibold text-white hover:brightness-105">
                下一步 · 选择付款方式 <ArrowRight className="h-4 w-4" />
              </button>
            </>
          ) : step === "payment" ? (
            <>
              <div className="rounded-lg bg-[#EEF6FF] p-3 ring-1 ring-[#BAE0FF]"><p className="text-[10px] text-[#0958D9]">已选服务</p><div className="mt-1 flex items-baseline justify-between gap-3"><span className="text-sm font-semibold text-slate-950">{selectedPlan.name}</span><span className="font-mono text-lg font-bold text-slate-950">{formatYuan(selectedPlan.priceCents)}</span></div></div>
              <h3 className="mt-5 text-base font-semibold text-slate-950">选择付款方式</h3>
              <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
                {methods.map(method => (
                  <button key={method.id} type="button" disabled={!method.enabled} onClick={() => setPaymentMethod(method.id)} className={`relative flex min-h-24 flex-col items-start justify-between rounded-lg border p-3 text-left transition ${paymentMethod === method.id ? "border-[#1677FF] bg-[#F3F8FF] ring-2 ring-[#1677FF]/10" : "border-slate-200 hover:border-[#69B1FF]"} disabled:cursor-not-allowed disabled:opacity-45`}>
                    <PaymentBrand method={method.id} />
                    <span className="text-[10px] text-slate-500">{method.enabled ? (method.id === "manual_transfer" ? "对公账户转账，人工确认" : "官方在线支付，到账后自动立项") : "暂不可用"}</span>
                  </button>
                ))}
              </div>
              {paymentMethod === "manual_transfer" ? <ManualTransferFields values={{ payerName, paymentReference, contact, note }} setters={{ setPayerName, setPaymentReference, setContact, setNote }} /> : null}
              {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">{error}</p> : null}
              <div className="mt-5 flex gap-2">
                <button type="button" onClick={() => setStep("plan")} className="flex h-11 flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"><ChevronLeft className="h-4 w-4" />上一步</button>
                <button type="button" onClick={() => void startCheckout()} disabled={pending || !methods.find(item => item.id === paymentMethod)?.enabled} className="flex h-11 flex-[1.6] items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEF] px-4 text-sm font-semibold text-white disabled:opacity-50">
                  {pending ? <><Loader2 className="h-4 w-4 animate-spin" />正在创建订单</> : `${paymentMethod === "manual_transfer" ? "提交转账订单" : "立即支付"} · ${formatYuan(selectedPlan.priceCents)}`}
                </button>
              </div>
            </>
          ) : checkout ? (
            <CheckoutResultPanel checkout={checkout} onSync={() => void syncWechat(checkout)} />
          ) : null}
        </div>
      </div>
    </div>
  )
  return typeof document === "undefined" ? null : createPortal(dialog, document.body)
}

function PaymentBrand({ method }: { method: PaymentMethod }) {
  if (method === "wechat") return <Image src="/recharge/wechat-pay-official.png" alt="微信支付" width={264} height={34} className="h-6 w-auto max-w-full object-contain" />
  if (method === "alipay") return <Image src="/recharge/alipay-official.png" alt="支付宝" width={302} height={68} className="h-7 w-auto max-w-full object-contain" />
  return <span className="flex items-center gap-2"><span className="relative h-8 w-12 overflow-hidden"><Image src="/recharge/unionpay-official.png" alt="银联" fill className="scale-150 object-contain" sizes="48px" /></span><span className="text-sm font-semibold text-slate-950">银行转账</span></span>
}

function ManualTransferFields({ values, setters }: {
  values: { payerName: string; paymentReference: string; contact: string; note: string }
  setters: { setPayerName: (value: string) => void; setPaymentReference: (value: string) => void; setContact: (value: string) => void; setNote: (value: string) => void }
}) {
  return <div className="mt-4 rounded-lg bg-emerald-50/70 p-4 ring-1 ring-emerald-200">
    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900"><Building2 className="h-4 w-4 text-emerald-700" />对公转账账户</div>
    <div className="mt-2 grid gap-1 rounded-lg bg-white p-3 text-[11px] leading-5 text-slate-700 ring-1 ring-emerald-100">
      <span>账户名称：{RECHARGE_PAYMENT_INFO.accountName}</span><span className="break-all">账号：{RECHARGE_PAYMENT_INFO.accountNo}</span><span>开户行：{RECHARGE_PAYMENT_INFO.bankName}</span><span>行号：{RECHARGE_PAYMENT_INFO.bankCode}</span>
    </div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <input value={values.payerName} onChange={event => setters.setPayerName(event.target.value)} placeholder="付款账户名" className="h-10 rounded-lg border border-emerald-200 bg-white px-3 text-xs outline-none focus:border-emerald-500" />
      <input value={values.paymentReference} onChange={event => setters.setPaymentReference(event.target.value)} placeholder="转账流水号或凭证说明" className="h-10 rounded-lg border border-emerald-200 bg-white px-3 text-xs outline-none focus:border-emerald-500" />
      <input value={values.contact} onChange={event => setters.setContact(event.target.value)} placeholder="联系电话或微信" className="h-10 rounded-lg border border-emerald-200 bg-white px-3 text-xs outline-none focus:border-emerald-500" />
      <input value={values.note} onChange={event => setters.setNote(event.target.value)} placeholder="备注（选填）" className="h-10 rounded-lg border border-emerald-200 bg-white px-3 text-xs outline-none focus:border-emerald-500" />
    </div>
  </div>
}

function CheckoutResultPanel({ checkout, onSync }: { checkout: CheckoutResult; onSync: () => void }) {
  const paid = checkout.status === "credited"
  return <div className="mx-auto max-w-xl py-2 text-center">
    <span className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${paid ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-[#0958D9]"}`}>{paid ? <CircleCheckBig className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}</span>
    <h3 className="mt-3 text-lg font-bold text-slate-950">{paid ? "支付成功，专属项目已创建" : checkout.provider === "manual_transfer" ? "转账订单已提交" : "请完成微信支付"}</h3>
    <p className="mt-1 text-xs leading-5 text-slate-500">订单号：<span className="font-mono text-slate-700">{checkout.outTradeNo}</span></p>
    {checkout.qrCodeDataUrl && !paid ? <><Image src={checkout.qrCodeDataUrl} alt="微信官方付款码" width={420} height={420} unoptimized className="mx-auto mt-4 h-auto w-full max-w-[250px] rounded-lg ring-1 ring-slate-200" /><button type="button" onClick={onSync} className="mt-3 text-xs font-semibold text-[#0958D9]">我已付款，立即刷新</button></> : null}
    <div className="mt-5 rounded-lg bg-emerald-50/70 p-4 text-left ring-1 ring-emerald-100">
      <div className="flex items-center gap-3"><Image src={RECHARGE_PAYMENT_INFO.serviceWechatQrImageUrl || "/recharge/service-wechat.png"} alt="势途 GEO 客服微信二维码" width={144} height={144} className="h-24 w-24 rounded-lg bg-white object-contain" /><div><p className="text-xs font-semibold text-slate-900">添加项目客服</p><p className="mt-1 text-[11px] leading-5 text-slate-600">微信号：<span className="font-mono font-semibold">{RECHARGE_PAYMENT_INFO.serviceWechatId}</span><br />扫码沟通合同、发票和项目启动事项。</p></div></div>
    </div>
    <Link href={`/account/services/${encodeURIComponent(checkout.serviceOrderId)}`} className="mt-4 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEF] text-sm font-semibold text-white">{paid ? "填写项目资料" : "查看订单与项目资料"}<ArrowRight className="h-4 w-4" /></Link>
  </div>
}
