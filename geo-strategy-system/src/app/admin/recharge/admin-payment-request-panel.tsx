"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState, type FormEvent } from "react"
import {
  BadgeCheck,
  Ban,
  Banknote,
  CheckCircle2,
  Clock3,
  Loader2,
  MailCheck,
  RefreshCw,
  Search,
  Send,
  UserRoundCheck,
} from "lucide-react"
import type { AdminPaymentRequest } from "@/lib/admin-payment-request-types"

type TargetPreview = {
  id: string
  name: string
  email: string
  status: string
}

export type AdminPaymentRequestSummary = Pick<
  AdminPaymentRequest,
  | "id"
  | "title"
  | "status"
  | "emailStatus"
  | "username"
  | "email"
  | "priceCents"
  | "credits"
  | "selectedProvider"
  | "createdAt"
  | "expiresAt"
  | "creditedAt"
  | "transferSubmittedAt"
>

const STATUS_COPY: Record<AdminPaymentRequest["status"], { label: string; className: string }> = {
  pending: { label: "待付款", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  paid: { label: "结算中", className: "bg-blue-50 text-blue-700 ring-blue-200" },
  credited: { label: "已到账", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  canceled: { label: "已取消", className: "bg-slate-100 text-slate-600 ring-slate-200" },
  expired: { label: "已过期", className: "bg-rose-50 text-rose-700 ring-rose-200" },
}

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `adminpay_${crypto.randomUUID().replaceAll("-", "")}`
  }
  return `adminpay_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function formatTime(value?: number): string {
  if (!value) return "-"
  return new Date(value).toLocaleString("zh-CN", { hour12: false })
}

function paymentLabel(provider?: AdminPaymentRequest["selectedProvider"]): string {
  if (provider === "wechat") return "微信支付"
  if (provider === "alipay") return "支付宝"
  if (provider === "manual_transfer") return "银行转账"
  return "用户尚未选择"
}

export function AdminPaymentRequestPanel({
  initialRequests,
}: {
  initialRequests: AdminPaymentRequestSummary[]
}) {
  const router = useRouter()
  const [account, setAccount] = useState("")
  const [target, setTarget] = useState<TargetPreview | null>(null)
  const [title, setTitle] = useState("专属积分充值订单")
  const [amountYuan, setAmountYuan] = useState("")
  const [credits, setCredits] = useState("")
  const [expiryDays, setExpiryDays] = useState("7")
  const [note, setNote] = useState("")
  const [checking, setChecking] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null)
  const [rowPending, setRowPending] = useState<string | null>(null)
  const [localRequests, setLocalRequests] = useState<AdminPaymentRequestSummary[]>([])
  const requests = useMemo(
    () => Array.from(
      new Map(
        [...localRequests, ...initialRequests].map(record => [record.id, record]),
      ).values(),
    ).sort((left, right) => right.createdAt - left.createdAt),
    [initialRequests, localRequests],
  )

  async function previewTarget() {
    setChecking(true)
    setMessage(null)
    try {
      const response = await fetch("/api/admin/payment-requests", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", targetAccount: account }),
      })
      const payload = await response.json() as { target?: TargetPreview; error?: string }
      if (!response.ok || !payload.target) throw new Error(payload.error || "账号核对失败")
      setTarget(payload.target)
    } catch (error) {
      setTarget(null)
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "账号核对失败" })
    } finally {
      setChecking(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!target) {
      setMessage({ kind: "error", text: "请先核对收款账号" })
      return
    }
    setSubmitting(true)
    setMessage(null)
    try {
      const response = await fetch("/api/admin/payment-requests", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          targetAccount: target.id,
          title,
          note,
          amountYuan,
          credits,
          expiryDays,
          idempotencyKey: newIdempotencyKey(),
        }),
      })
      const payload = await response.json() as {
        request?: AdminPaymentRequestSummary
        error?: string
      }
      if (!response.ok || !payload.request) throw new Error(payload.error || "付款订单发送失败")
      const createdRequest = payload.request
      setLocalRequests(current => [
        createdRequest,
        ...current.filter(record => record.id !== createdRequest.id),
      ])
      setMessage({
        kind: "success",
        text: `付款订单已发送给 ${target.name}，站内消息已生成，邮件正在投递。`,
      })
      setAmountYuan("")
      setCredits("")
      setNote("")
      router.refresh()
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "付款订单发送失败" })
    } finally {
      setSubmitting(false)
    }
  }

  async function runRowAction(
    requestId: string,
    action: "cancel" | "resend" | "credit",
  ) {
    if (action === "cancel" && !window.confirm("确认取消这笔付款订单？取消后用户将无法继续付款。")) {
      return
    }
    if (action === "credit" && !window.confirm("确认银行款项已经实际到账，并立即发放积分？")) {
      return
    }
    setRowPending(`${requestId}:${action}`)
    setMessage(null)
    try {
      const response = await fetch(`/api/admin/payment-requests/${encodeURIComponent(requestId)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const payload = await response.json() as { message?: string; error?: string }
      if (!response.ok) throw new Error(payload.error || "操作失败")
      setMessage({ kind: "success", text: payload.message || "操作成功" })
      router.refresh()
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "操作失败" })
    } finally {
      setRowPending(null)
    }
  }

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-[#B7D9FF] bg-white shadow-[0_18px_48px_-34px_rgba(9,88,217,.55)]">
      <div className="border-b border-[#DCEAF8] bg-[linear-gradient(110deg,#F4FAFF_0%,#E8F5FF_56%,#ECFFFC_100%)] px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-slate-950">
              <Send className="h-4 w-4 text-[#1677FF]" />
              向指定账号发送付款订单
            </div>
            <p className="mt-1 text-xs text-slate-500">
              用户将在信息中心和注册邮箱收到订单，可选择微信、支付宝或银行转账。
            </p>
          </div>
          <span className="rounded-lg bg-white/80 px-3 py-1.5 text-[11px] font-semibold text-[#0958D9] ring-1 ring-[#B7D9FF]">
            默认 7 天有效
          </span>
        </div>
      </div>

      <form onSubmit={submit} className="grid gap-4 p-4 sm:p-5 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <label htmlFor="payment-target-account" className="text-xs font-semibold text-slate-700">
            收款账号
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="payment-target-account"
              value={account}
              onChange={event => {
                setAccount(event.target.value)
                setTarget(null)
              }}
              placeholder="输入注册邮箱或用户 ID"
              className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-[#1677FF] focus:bg-white focus:ring-2 focus:ring-[#1677FF]/15"
            />
            <button
              type="button"
              onClick={() => void previewTarget()}
              disabled={checking || !account.trim()}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-[#91CAFF] bg-[#EEF7FF] px-3 text-xs font-semibold text-[#0958D9] transition hover:bg-[#E1F1FF] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              核对
            </button>
          </div>
          {target ? (
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200">
              <UserRoundCheck className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate">{target.name} · {target.email}</span>
              <BadgeCheck className="ml-auto h-4 w-4 shrink-0" />
            </div>
          ) : null}
        </div>

        <div className="lg:col-span-3">
          <label htmlFor="payment-request-title" className="text-xs font-semibold text-slate-700">订单名称</label>
          <input
            id="payment-request-title"
            value={title}
            onChange={event => setTitle(event.target.value)}
            maxLength={80}
            className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-[#1677FF] focus:bg-white focus:ring-2 focus:ring-[#1677FF]/15"
          />
        </div>

        <div className="lg:col-span-2">
          <label htmlFor="payment-request-amount" className="text-xs font-semibold text-slate-700">金额（元）</label>
          <input
            id="payment-request-amount"
            type="number"
            min="1"
            max="1000000"
            step="0.01"
            value={amountYuan}
            onChange={event => setAmountYuan(event.target.value)}
            placeholder="例如 299"
            required
            className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-sm outline-none transition focus:border-[#1677FF] focus:bg-white focus:ring-2 focus:ring-[#1677FF]/15"
          />
        </div>

        <div className="lg:col-span-2">
          <label htmlFor="payment-request-credits" className="text-xs font-semibold text-slate-700">到账积分</label>
          <input
            id="payment-request-credits"
            type="number"
            min="1"
            max="10000000"
            step="1"
            value={credits}
            onChange={event => setCredits(event.target.value)}
            placeholder="例如 1500"
            required
            className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-sm outline-none transition focus:border-[#1677FF] focus:bg-white focus:ring-2 focus:ring-[#1677FF]/15"
          />
        </div>

        <div className="lg:col-span-8">
          <label htmlFor="payment-request-note" className="text-xs font-semibold text-slate-700">订单说明（选填）</label>
          <textarea
            id="payment-request-note"
            value={note}
            onChange={event => setNote(event.target.value)}
            maxLength={500}
            rows={2}
            placeholder="填写套餐约定、服务说明或付款备注"
            className="mt-1.5 min-h-20 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 outline-none transition focus:border-[#1677FF] focus:bg-white focus:ring-2 focus:ring-[#1677FF]/15"
          />
        </div>

        <div className="lg:col-span-2">
          <label htmlFor="payment-request-expiry" className="text-xs font-semibold text-slate-700">有效天数</label>
          <input
            id="payment-request-expiry"
            type="number"
            min="1"
            max="30"
            value={expiryDays}
            onChange={event => setExpiryDays(event.target.value)}
            required
            className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-sm outline-none transition focus:border-[#1677FF] focus:bg-white focus:ring-2 focus:ring-[#1677FF]/15"
          />
        </div>

        <div className="flex items-end lg:col-span-2">
          <button
            type="submit"
            disabled={submitting || !target}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-4 text-xs font-bold text-white shadow-sm shadow-blue-500/20 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            发送付款订单
          </button>
        </div>
      </form>

      {message ? (
        <div className={`mx-4 mb-4 rounded-lg px-3 py-2 text-xs sm:mx-5 ${message.kind === "success" ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-1 ring-rose-200"}`}>
          {message.text}
        </div>
      ) : null}

      <div className="border-t border-[#DCEAF8]">
        <div className="flex items-center justify-between px-4 py-3 sm:px-5">
          <div className="text-sm font-bold text-slate-900">已发送的付款订单</div>
          <span className="text-xs text-slate-400">共 {requests.length} 笔</span>
        </div>
        {requests.length === 0 ? (
          <div className="border-t border-slate-100 px-5 py-10 text-center text-sm text-slate-400">
            暂无管理员付款订单
          </div>
        ) : (
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {requests.map(record => {
              const status = STATUS_COPY[record.status]
              const canCancel = record.status === "pending" || record.status === "expired"
              const canResend = record.status === "pending"
              const canCredit = record.status === "pending"
                && record.selectedProvider === "manual_transfer"
                && Boolean(record.transferSubmittedAt)
              return (
                <article key={record.id} className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,.9fr)_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-slate-950">{record.title}</h3>
                      <span className={`inline-flex rounded-md px-2 py-1 text-[10px] font-semibold ring-1 ${status.className}`}>
                        {status.label}
                      </span>
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium ring-1 ${record.emailStatus === "sent" ? "bg-cyan-50 text-cyan-700 ring-cyan-200" : record.emailStatus === "failed" ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-slate-50 text-slate-600 ring-slate-200"}`}>
                        <MailCheck className="h-3 w-3" />
                        {record.emailStatus === "sent" ? "邮件已送达" : record.emailStatus === "failed" ? "邮件待重试" : "邮件投递中"}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-600">
                      {record.username} · {record.email}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-slate-400">{record.id}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-2">
                    <div><span className="block text-[10px] text-slate-400">金额</span><strong className="mt-0.5 block font-mono text-slate-900">¥{(record.priceCents / 100).toFixed(2)}</strong></div>
                    <div><span className="block text-[10px] text-slate-400">积分</span><strong className="mt-0.5 block font-mono text-[#0958D9]">{record.credits}</strong></div>
                    <div><span className="block text-[10px] text-slate-400">付款方式</span><span className="mt-0.5 block text-slate-700">{paymentLabel(record.selectedProvider)}</span></div>
                    <div><span className="block text-[10px] text-slate-400">有效期</span><span className="mt-0.5 block text-slate-700">{formatTime(record.expiresAt)}</span></div>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:max-w-[250px] lg:justify-end">
                    {canCredit ? (
                      <button type="button" onClick={() => void runRowAction(record.id, "credit")} disabled={Boolean(rowPending)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">
                        {rowPending === `${record.id}:credit` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Banknote className="h-3.5 w-3.5" />}
                        确认银行到账
                      </button>
                    ) : null}
                    {canResend ? (
                      <button type="button" onClick={() => void runRowAction(record.id, "resend")} disabled={Boolean(rowPending)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#91CAFF] bg-[#EEF7FF] px-3 text-xs font-semibold text-[#0958D9] transition hover:bg-[#E1F1FF] disabled:opacity-50">
                        {rowPending === `${record.id}:resend` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        重发提醒
                      </button>
                    ) : null}
                    {canCancel ? (
                      <button type="button" onClick={() => void runRowAction(record.id, "cancel")} disabled={Boolean(rowPending)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50">
                        {rowPending === `${record.id}:cancel` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                        取消
                      </button>
                    ) : null}
                    {record.status === "credited" ? (
                      <span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {formatTime(record.creditedAt)}
                      </span>
                    ) : record.transferSubmittedAt ? (
                      <span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-50 px-3 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                        <Clock3 className="h-3.5 w-3.5" />
                        转账待核对
                      </span>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
