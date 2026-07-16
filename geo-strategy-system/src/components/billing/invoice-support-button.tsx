"use client"

import Image from "next/image"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Check, Clock3, Copy, MessageCircle, ReceiptText, X } from "lucide-react"
import type { BillingRechargeStatus } from "@/lib/billing-records"
import { RECHARGE_PAYMENT_INFO } from "@/lib/recharge-payment"

type InvoiceSupportButtonProps = {
  status: BillingRechargeStatus
  orderNo: string
  packageName: string
  priceCents?: number
  paymentMethod: string
  createdAt: number
  processedAt?: number
}

function formatYuan(priceCents?: number): string {
  if (!priceCents) return "-"
  return `¥${(priceCents / 100).toFixed(priceCents % 100 === 0 ? 0 : 2)}`
}

function formatTime(value?: number): string {
  if (!value) return "-"
  return new Date(value).toLocaleString("zh-CN", { hour12: false })
}

function pendingInvoice(status: BillingRechargeStatus): boolean {
  return status === "pending_review" || status === "pending_payment" || status === "processing"
}

function invoiceUnavailable(status: BillingRechargeStatus): boolean {
  return status !== "credited"
}

export function InvoiceSupportButton(props: InvoiceSupportButtonProps) {
  const [open, setOpen] = useState(false)
  const disabled = invoiceUnavailable(props.status)
  const pending = pendingInvoice(props.status)

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-[#91CAFF] bg-[#F0F7FF] px-2.5 py-1.5 text-xs font-semibold text-[#0958D9] transition hover:border-[#1677FF] hover:bg-[#E6F4FF] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
        title={pending ? "充值到账后即可申请发票" : disabled ? "该订单当前不可申请发票" : "联系微信客服申请发票"}
      >
        {pending ? <Clock3 className="h-3.5 w-3.5" /> : <ReceiptText className="h-3.5 w-3.5" />}
        {pending ? "到账后可申请" : disabled ? "不可开票" : "申请开票"}
      </button>
      {open ? <InvoiceSupportDialog {...props} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function InvoiceSupportDialog({
  orderNo,
  packageName,
  priceCents,
  paymentMethod,
  createdAt,
  processedAt,
  onClose,
}: InvoiceSupportButtonProps & { onClose: () => void }) {
  const [copied, setCopied] = useState<"idle" | "wechat" | "template">("idle")
  const wechatId = RECHARGE_PAYMENT_INFO.serviceWechatId || "shituGEO"
  const qrImageUrl = RECHARGE_PAYMENT_INFO.serviceWechatQrImageUrl || "/recharge/service-wechat.png"
  const invoiceTemplate = [
    "开票申请",
    `订单号：${orderNo}`,
    `充值套餐：${packageName}`,
    `支付金额：${formatYuan(priceCents)}`,
    `付款方式：${paymentMethod}`,
    `到账时间：${formatTime(processedAt || createdAt)}`,
    "发票抬头：",
    "统一社会信用代码：",
    "接收邮箱：",
    "其他开票要求：",
  ].join("\n")

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [onClose])

  async function copy(value: string, kind: "wechat" | "template") {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      window.setTimeout(() => setCopied("idle"), 1800)
    } catch {
      setCopied("idle")
    }
  }

  const dialog = (
    <div
      className="fixed inset-0 z-[10020] flex items-center justify-center overflow-y-auto bg-[#001D66]/55 px-3 py-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invoice-support-title"
      onClick={onClose}
    >
      <div
        className="relative max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-lg bg-white shadow-[0_30px_90px_-35px_rgba(0,29,102,0.75)] ring-1 ring-blue-200"
        onClick={event => event.stopPropagation()}
      >
        <header className="relative overflow-hidden bg-[linear-gradient(112deg,#001D66_0%,#0958D9_58%,#00AEEF_100%)] px-5 py-4 pr-14 text-white sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20">
              <ReceiptText className="h-5 w-5" />
            </span>
            <div>
              <h2 id="invoice-support-title" className="text-base font-semibold">联系微信客服申请发票</h2>
              <p className="mt-0.5 text-xs text-blue-100">当前订单信息已整理，可直接复制后发送</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-white/75 transition hover:bg-white/10 hover:text-white"
            aria-label="关闭开票窗口"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid gap-5 px-5 py-5 sm:grid-cols-[180px_1fr] sm:px-6">
          <div className="border-b border-slate-100 pb-5 text-center sm:border-b-0 sm:border-r sm:pb-0 sm:pr-5">
            <Image
              src={qrImageUrl}
              alt="开票客服微信二维码"
              width={320}
              height={320}
              className="mx-auto h-40 w-40 rounded-lg object-contain ring-1 ring-slate-200"
              sizes="160px"
            />
            <div className="mt-3 flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-800">
              <Image
                src="/recharge/wechat-official.png"
                alt=""
                width={256}
                height={256}
                className="h-4 w-4 rounded"
                sizes="16px"
              />
              微信客服
            </div>
            <button
              type="button"
              onClick={() => void copy(wechatId, "wechat")}
              className="mt-1 inline-flex items-center gap-1 font-mono text-xs font-semibold text-[#0958D9] hover:text-[#003EB3]"
            >
              {wechatId}
              {copied === "wechat" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <MessageCircle className="h-4 w-4 text-[#1677FF]" />
              本次开票订单
            </div>
            <dl className="mt-3 grid grid-cols-[72px_1fr] gap-x-3 gap-y-2 text-xs leading-5">
              <dt className="text-slate-400">订单号</dt>
              <dd className="break-all font-mono text-slate-800">{orderNo}</dd>
              <dt className="text-slate-400">套餐</dt>
              <dd className="text-slate-800">{packageName}</dd>
              <dt className="text-slate-400">金额</dt>
              <dd className="font-mono font-semibold text-slate-950">{formatYuan(priceCents)}</dd>
              <dt className="text-slate-400">到账时间</dt>
              <dd className="text-slate-800">{formatTime(processedAt || createdAt)}</dd>
            </dl>
            <p className="mt-4 text-[11px] leading-5 text-slate-500">
              请向客服提供发票抬头、统一社会信用代码、接收邮箱及其他开票要求。
            </p>
            <button
              type="button"
              onClick={() => void copy(invoiceTemplate, "template")}
              className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEF] px-3 text-xs font-semibold text-white transition hover:brightness-105"
            >
              {copied === "template" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === "template" ? "开票信息已复制" : "复制开票申请模板"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(dialog, document.body)
}
