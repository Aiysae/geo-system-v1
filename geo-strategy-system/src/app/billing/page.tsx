import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowLeft, CreditCard, ReceiptText, Sparkles } from "lucide-react"
import { getCurrentUser } from "@/lib/auth"
import { getCredits } from "@/lib/credits"
import { listCreditLedgerForUser, type CreditLedgerEntry } from "@/lib/credit-ledger"
import { formatYuan, getFeaturePrice, RECHARGE_PACKAGES } from "@/lib/pricing"
import { listRequestsForUser, type RechargeRequest } from "@/lib/recharge"
import { RechargeButton } from "@/components/credits/recharge-button"
import SiteFooter from "@/components/site-footer"

export const dynamic = "force-dynamic"
export const revalidate = 0

const STATUS_LABEL: Record<RechargeRequest["status"], string> = {
  pending: "待审批",
  approved: "已到账",
  rejected: "已拒绝",
}

const STATUS_CLASS: Record<RechargeRequest["status"], string> = {
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200",
}

const LEDGER_TYPE_LABEL: Record<CreditLedgerEntry["type"], string> = {
  trial_grant: "试用赠送",
  bootstrap_grant: "历史补足",
  recharge_requested: "充值申请",
  recharge_approved: "充值到账",
  recharge_rejected: "充值拒绝",
  admin_adjust: "管理员调整",
  usage_reserved: "功能扣费",
  usage_refund: "积分退回",
  usage_extra: "超额结算",
}

function formatTime(value?: number): string {
  if (!value) return "-"
  return new Date(value).toLocaleString("zh-CN", { hour12: false })
}

function featureLabel(entry: CreditLedgerEntry): string {
  if (entry.description) return entry.description
  if (entry.featureKey) return getFeaturePrice(entry.featureKey).label
  return LEDGER_TYPE_LABEL[entry.type] || "积分变动"
}

function paymentLabel(value?: string): string {
  if (value === "wechat") return "微信"
  if (value === "alipay") return "支付宝"
  if (value === "other") return "其他"
  return "人工转账"
}

export default async function BillingPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/sign-in?redirect_url=/billing")

  const [credits, recharges, ledger] = await Promise.all([
    getCredits(user.id),
    listRequestsForUser(user.id, 80),
    listCreditLedgerForUser(user.id, 120),
  ])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/30">
      <header className="sticky top-0 z-30 border-b border-slate-200/60 bg-white/90 shadow-sm shadow-slate-200/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#004B73] to-[#0077B6] shadow-lg shadow-blue-300/40">
              <ReceiptText className="h-5 w-5 text-white" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-bold tracking-wide text-slate-900">账单与积分记录</div>
              <div className="mt-0.5 truncate text-[11px] text-slate-500">{user.email}</div>
            </div>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回系统
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-8 md:py-8">
        <section className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Sparkles className="h-4 w-4 text-amber-500" />
              当前积分
            </div>
            <div className="font-mono text-4xl font-bold tracking-tight text-slate-900">{credits}</div>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              所有功能扣费、失败退回、充值到账都会进入下方消费流水。
            </p>
            <div className="mt-5">
              <RechargeButton />
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <CreditCard className="h-4 w-4 text-[#0077B6]" />
              当前充值套餐
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {RECHARGE_PACKAGES.map(pkg => (
                <div key={pkg.key} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <div className="text-sm font-semibold text-slate-900">{pkg.name}</div>
                  <div className="mt-1 font-mono text-lg font-bold text-slate-900">{formatYuan(pkg.priceCents)}</div>
                  <div className="font-mono text-xs font-medium text-[#006AA3]">+{pkg.credits} 积分</div>
                  <p className="mt-2 text-[11px] leading-4 text-slate-500">{pkg.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">充值记录</h2>
            <p className="mt-1 text-xs text-slate-500">展示你提交过的充值申请、套餐金额和审批状态。</p>
          </div>
          {recharges.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-400">暂无充值记录</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead className="bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">套餐</th>
                    <th className="px-5 py-3">金额</th>
                    <th className="px-5 py-3">积分</th>
                    <th className="px-5 py-3">付款方式</th>
                    <th className="px-5 py-3">状态</th>
                    <th className="px-5 py-3">提交时间</th>
                    <th className="px-5 py-3">处理时间</th>
                  </tr>
                </thead>
                <tbody>
                  {recharges.map(record => (
                    <tr key={record.id} className="border-t border-slate-100 text-sm">
                      <td className="px-5 py-3 font-medium text-slate-900">{record.packageName || "历史充值申请"}</td>
                      <td className="px-5 py-3 font-mono text-slate-700">
                        {record.priceCents ? formatYuan(record.priceCents) : "-"}
                      </td>
                      <td className="px-5 py-3 font-mono font-semibold text-slate-900">
                        +{record.credits ?? record.amount}
                      </td>
                      <td className="px-5 py-3 text-slate-600">{paymentLabel(record.paymentMethod)}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex rounded-lg px-2 py-1 text-xs font-medium ring-1 ${STATUS_CLASS[record.status]}`}>
                          {STATUS_LABEL[record.status]}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-500">{formatTime(record.createdAt)}</td>
                      <td className="px-5 py-3 text-xs text-slate-500">{formatTime(record.processedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">消费流水</h2>
            <p className="mt-1 text-xs text-slate-500">扣费、退回、充值到账和管理员调整都会保留记录。</p>
          </div>
          {ledger.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-400">暂无消费流水</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead className="bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">时间</th>
                    <th className="px-5 py-3">类型</th>
                    <th className="px-5 py-3">说明</th>
                    <th className="px-5 py-3">变动</th>
                    <th className="px-5 py-3">余额</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map(entry => (
                    <tr key={entry.id} className="border-t border-slate-100 text-sm">
                      <td className="px-5 py-3 text-xs text-slate-500">{formatTime(entry.createdAt)}</td>
                      <td className="px-5 py-3 text-slate-600">{LEDGER_TYPE_LABEL[entry.type]}</td>
                      <td className="px-5 py-3 text-slate-900">{featureLabel(entry)}</td>
                      <td className={`px-5 py-3 font-mono font-semibold ${entry.delta > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                      </td>
                      <td className="px-5 py-3 font-mono text-slate-700">
                        {typeof entry.balanceAfter === "number" ? entry.balanceAfter : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
