import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowLeft, ArrowUpRight, CreditCard, Crown, ReceiptText, Sparkles } from "lucide-react"
import { getCurrentUser } from "@/lib/auth"
import {
  mergeBillingRechargeRecords,
  type BillingRechargeStatus,
} from "@/lib/billing-records"
import { getCredits } from "@/lib/credits"
import { listPaymentOrdersForUser } from "@/lib/payment-orders"
import { getFirstPurchaseBlockReason } from "@/lib/payment-lifecycle"
import { hasUnlimitedCreditAccess } from "@/lib/with-credits"
import { listCreditLedgerForUser, type CreditLedgerEntry } from "@/lib/credit-ledger"
import {
  estimatePackageFeatureUses,
  formatYuan,
  getFeaturePrice,
  rechargeSavingsPercent,
  rechargeUnitPrice,
  RECHARGE_PACKAGES,
} from "@/lib/pricing"
import { RECHARGE_PAYMENT_INFO } from "@/lib/recharge-payment"
import { listRequestsForUser } from "@/lib/recharge"
import {
  getMembershipWithPaymentRepair,
  membershipTierLabel,
  MEMBERSHIP_LEVELS,
} from "@/lib/membership"
import { InvoiceSupportButton } from "@/components/billing/invoice-support-button"
import { RechargeButton } from "@/components/credits/recharge-button"
import SiteFooter from "@/components/site-footer"

export const dynamic = "force-dynamic"
export const revalidate = 0

const STATUS_LABEL: Record<BillingRechargeStatus, string> = {
  pending_review: "待审批",
  pending_payment: "待支付",
  processing: "支付处理中",
  credited: "已到账",
  rejected: "已拒绝",
  canceled: "已取消",
  failed: "支付失败",
  refunding: "退款中",
  refunded: "已退款",
}

const STATUS_CLASS: Record<BillingRechargeStatus, string> = {
  pending_review: "bg-amber-50 text-amber-700 ring-amber-200",
  pending_payment: "bg-amber-50 text-amber-700 ring-amber-200",
  processing: "bg-blue-50 text-blue-700 ring-blue-200",
  credited: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200",
  canceled: "bg-slate-100 text-slate-600 ring-slate-200",
  failed: "bg-rose-50 text-rose-700 ring-rose-200",
  refunding: "bg-amber-50 text-amber-700 ring-amber-200",
  refunded: "bg-slate-100 text-slate-600 ring-slate-200",
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
  client_monthly_grant: "客户月度额度",
  client_monthly_adjust: "客户额度调整",
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

  const [credits, rechargeRequests, paymentOrders, ledger, membership] = await Promise.all([
    getCredits(user.id),
    listRequestsForUser(user.id, 80),
    listPaymentOrdersForUser(user.id, 80),
    listCreditLedgerForUser(user.id, 120),
    getMembershipWithPaymentRepair(user.id),
  ])
  const recharges = mergeBillingRechargeRecords(rechargeRequests, paymentOrders, 80)
  const unlimited = hasUnlimitedCreditAccess(user)
  const introPackage = RECHARGE_PACKAGES.find(item => item.firstPurchaseOnly)
  const firstPurchaseBlockReason = membership.active
    ? "completed_purchase"
    : introPackage
      ? getFirstPurchaseBlockReason(paymentOrders, introPackage.key)
      : null
  const whiteLabelCredits = getFeaturePrice("reportCustomBranding").credits
  const membershipLabel = membershipTierLabel(membership.tier)
  const currentLevel = MEMBERSHIP_LEVELS.find(level => level.tier === membership.tier)
  const nextLevel = MEMBERSHIP_LEVELS.find(level => level.tier === membership.nextTier)
  const progressStart = currentLevel?.minPaidCents || 0
  const progressEnd = nextLevel?.minPaidCents || Math.max(progressStart, membership.paidCents)
  const membershipProgress = progressEnd > progressStart
    ? Math.max(0, Math.min(100, Math.round(
        ((membership.paidCents - progressStart) / (progressEnd - progressStart)) * 100,
      )))
    : 100

  return (
    <div className="min-h-screen geo-saturated-bg">
      <header className="geo-utility-header sticky top-0 z-30 border-b backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="geo-utility-header-icon flex h-10 w-10 items-center justify-center rounded-xl shadow-sm">
              <ReceiptText className="h-5 w-5 text-white" />
            </span>
            <div className="min-w-0">
              <div className="geo-utility-header-title text-sm font-bold tracking-wide">账单与积分记录</div>
              <div className="geo-utility-header-subtitle mt-0.5 truncate text-[11px]">{user.email}</div>
            </div>
          </div>
          <Link
            href="/workspace"
            className="geo-utility-header-action inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回工作台
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
            <div className="text-4xl font-bold tracking-tight text-slate-900">{unlimited ? "无限" : credits}</div>
            {unlimited && <div className="mt-1 font-mono text-[11px] text-slate-400">账面余额 {credits}</div>}
            <p className="mt-2 text-xs leading-5 text-slate-500">
              所有积分消耗、失败退回和充值到账都会记录在下方积分明细中。
            </p>
            <div className={`mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ring-1 ${
              unlimited || membership.active
                ? "bg-amber-50 text-amber-800 ring-amber-200"
                : "bg-slate-50 text-slate-600 ring-slate-200"
            }`}>
              <Crown className="h-4 w-4" />
              {unlimited
                ? "管理员权益已解锁"
                : membership.active
                  ? `${membershipLabel} 已解锁 · 累计充值 ¥${(membership.paidCents / 100).toFixed(2)}`
                  : "充值任意套餐到账后解锁 VIP1"}
            </div>
            {membership.nextTier && membership.nextTierPaidCents ? (
              <div className="mt-4">
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>距离 {membershipTierLabel(membership.nextTier)} 还差 ¥{((membership.amountToNextTierCents || 0) / 100).toFixed(2)}</span>
                  <span>{membershipProgress}%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#1677FF] via-[#00AEEA] to-[#13C2C2]" style={{ width: `${membershipProgress}%` }} />
                </div>
              </div>
            ) : null}
            {membership.clientAccountLimit > 0 ? (
              <Link href="/client-accounts" className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#0958D9] hover:underline">
                管理客户子账号 · {membership.clientAccountLimit} 个名额
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            ) : null}
            <div className="mt-5">
              <RechargeButton />
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <CreditCard className="h-4 w-4 text-[#1677FF]" />
              当前充值套餐
            </div>
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-[#EEF6FF] px-3 py-2.5 text-xs leading-5 text-[#003EB3] ring-1 ring-[#BAE0FF]">
              <Crown className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span>首次真实充值到账即升级 VIP1；等级按累计实际到账金额自动提升。白标专业报告 {whiteLabelCredits} 积分/份，VIP2 起可创建客户专属账号。</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {RECHARGE_PACKAGES.map(pkg => {
                const locked = pkg.firstPurchaseOnly && firstPurchaseBlockReason !== null
                const savings = rechargeSavingsPercent(pkg)
                const card = (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold text-slate-900">{pkg.name}</div>
                      {locked ? (
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          {firstPurchaseBlockReason === "active_intro_order" ? "已有待支付" : "首购已使用"}
                        </span>
                      ) : pkg.badge ? (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${pkg.kind === "intro" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-[#0958D9]"}`}>
                          {pkg.badge}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex items-baseline justify-between gap-2">
                      <span className="font-mono text-lg font-bold text-slate-900">{formatYuan(pkg.priceCents)}</span>
                      <span className="font-mono text-xs font-semibold text-[#0958D9]">{pkg.credits} 积分</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 font-mono text-[10px] text-slate-500">
                      <span>¥{rechargeUnitPrice(pkg).toFixed(3)}/积分</span>
                      <span>报告约 {estimatePackageFeatureUses(pkg, "reportCustomBranding")} 份</span>
                      {savings > 0 && pkg.kind !== "intro" ? <span className="text-emerald-700">省 {savings}%</span> : null}
                    </div>
                    <p className="mt-2 text-[11px] leading-4 text-slate-500">{pkg.description}</p>
                    <span className={`mt-2 inline-flex items-center gap-1 text-[11px] font-semibold ${locked ? "text-slate-400" : "text-[#0958D9]"}`}>
                      {locked ? "不可重复购买" : "购买"}
                      {!locked ? <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /> : null}
                    </span>
                  </>
                )
                if (locked) {
                  return (
                    <div
                      key={pkg.key}
                      className="relative w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 p-3 text-left opacity-70"
                    >
                      {card}
                    </div>
                  )
                }
                return (
                  <RechargeButton
                    key={pkg.key}
                    initialPackageKey={pkg.key}
                    processPaymentReturn={false}
                    triggerClassName={`group relative w-full rounded-lg border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1677FF] focus-visible:ring-offset-2 ${pkg.kind === "intro" ? "border-amber-300 bg-[linear-gradient(135deg,#FFF8E7_0%,#F1F8FF_100%)]" : pkg.recommended ? "border-[#69B1FF] bg-[#F0F7FF]" : "border-slate-200 bg-slate-50/70 hover:border-[#69B1FF] hover:bg-[#F7FBFF]"}`}
                  >
                    {card}
                  </RechargeButton>
                )
              })}
            </div>
            <p className="mt-4 rounded-xl bg-blue-50/70 px-3 py-2 text-xs leading-5 text-slate-600 ring-1 ring-blue-100">
              {RECHARGE_PAYMENT_INFO.notice}
              <Link href="/recharge-rules" className="ml-1 font-medium text-[#0958D9] hover:text-[#003EB3]">
                查看充值与退款规则
              </Link>
            </p>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">VIP 等级与客户账号权益</h2>
              <p className="mt-1 text-xs text-slate-500">只累计实际支付并已到账的金额；退款订单不计入等级。</p>
            </div>
            <span className="rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-3 py-1.5 text-xs font-bold text-white">{membershipLabel}</span>
          </div>
          <div className="grid gap-px bg-[#E4ECF4] sm:grid-cols-2 lg:grid-cols-6">
            {MEMBERSHIP_LEVELS.map(level => {
              const reached = membership.active && membership.paidCents >= level.minPaidCents
              return (
                <div key={level.tier} className={`p-4 ${reached ? "bg-[#F0F8FF]" : "bg-white"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm font-bold ${reached ? "text-[#0958D9]" : "text-slate-700"}`}>{membershipTierLabel(level.tier)}</span>
                    {reached ? <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">✓</span> : null}
                  </div>
                  <p className="mt-2 font-mono text-xs text-slate-500">累计 ¥{(level.minPaidCents / 100).toFixed(0)}</p>
                  <p className="mt-2 text-[11px] leading-4 text-slate-500">
                    {level.clientAccountLimit > 0 ? `最多 ${level.clientAccountLimit} 个客户子账号` : "白标报告付费权限"}
                  </p>
                </div>
              )
            })}
          </div>
        </section>

        <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">充值记录</h2>
            <p className="mt-1 text-xs text-slate-500">查看每笔充值的付款方式和到账状态。</p>
          </div>
          {recharges.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-400">暂无充值记录</div>
          ) : (
            <>
              <div className="divide-y divide-slate-100 md:hidden">
                {recharges.map(record => (
                  <article key={record.id} className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-slate-950">
                          {record.packageName || "历史充值申请"}
                        </h3>
                        <p className="mt-1 break-all font-mono text-[10px] text-slate-400">
                          {record.paymentOutTradeNo || record.id}
                        </p>
                      </div>
                      <span className={`inline-flex shrink-0 rounded-lg px-2 py-1 text-xs font-medium ring-1 ${STATUS_CLASS[record.status]}`}>
                        {STATUS_LABEL[record.status]}
                      </span>
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-4 rounded-lg bg-slate-50 px-3 py-2.5">
                      <div>
                        <p className="text-[10px] text-slate-400">充值金额</p>
                        <p className="mt-0.5 font-mono text-base font-bold text-slate-950">
                          {record.priceCents ? formatYuan(record.priceCents) : "-"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-slate-400">到账积分</p>
                        <p className="mt-0.5 font-mono text-sm font-semibold text-[#0958D9]">+{record.credits}</p>
                      </div>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <div>
                        <dt className="text-[10px] text-slate-400">付款方式</dt>
                        <dd className="mt-0.5 text-slate-700">{paymentLabel(record.paymentMethod)}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] text-slate-400">提交时间</dt>
                        <dd className="mt-0.5 text-slate-700">{formatTime(record.createdAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] text-slate-400">处理时间</dt>
                        <dd className="mt-0.5 text-slate-700">{formatTime(record.processedAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] text-slate-400">付款人</dt>
                        <dd className="mt-0.5 truncate text-slate-700">{record.payerName || "未填写"}</dd>
                      </div>
                    </dl>
                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                      <span className="text-[11px] text-slate-500">电子发票请联系微信客服办理</span>
                      <InvoiceSupportButton
                        status={record.status}
                        orderNo={record.paymentOutTradeNo || record.id}
                        packageName={record.packageName || "历史充值申请"}
                        priceCents={record.priceCents}
                        paymentMethod={paymentLabel(record.paymentMethod)}
                        createdAt={record.createdAt}
                        processedAt={record.processedAt}
                      />
                    </div>
                  </article>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1160px] text-left">
                <thead className="bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">套餐</th>
                    <th className="px-5 py-3">订单号</th>
                    <th className="px-5 py-3">金额</th>
                    <th className="px-5 py-3">积分</th>
                    <th className="px-5 py-3">付款方式</th>
                    <th className="px-5 py-3">付款核对信息</th>
                    <th className="px-5 py-3">状态</th>
                    <th className="px-5 py-3">提交时间</th>
                    <th className="px-5 py-3">处理时间</th>
                    <th className="px-5 py-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {recharges.map(record => (
                    <tr key={record.id} className="border-t border-slate-100 text-sm">
                      <td className="px-5 py-3 font-medium text-slate-900">{record.packageName || "历史充值申请"}</td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-500">
                        {record.paymentOutTradeNo || "-"}
                      </td>
                      <td className="px-5 py-3 font-mono text-slate-700">
                        {record.priceCents ? formatYuan(record.priceCents) : "-"}
                      </td>
                      <td className="px-5 py-3 font-mono font-semibold text-slate-900">
                        +{record.credits}
                      </td>
                      <td className="px-5 py-3 text-slate-600">{paymentLabel(record.paymentMethod)}</td>
                      <td className="px-5 py-3 text-xs leading-5 text-slate-600">
                        {record.paymentReference || record.payerName || record.contact ? (
                          <>
                            {record.payerName && <div>付款人：{record.payerName}</div>}
                            {record.paymentReference && <div>凭证：{record.paymentReference}</div>}
                            {record.contact && <div>联系：{record.contact}</div>}
                          </>
                        ) : (
                          <span className="text-slate-400">未填写</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex rounded-lg px-2 py-1 text-xs font-medium ring-1 ${STATUS_CLASS[record.status]}`}>
                          {STATUS_LABEL[record.status]}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-500">{formatTime(record.createdAt)}</td>
                      <td className="px-5 py-3 text-xs text-slate-500">{formatTime(record.processedAt)}</td>
                      <td className="px-5 py-3">
                        <InvoiceSupportButton
                          status={record.status}
                          orderNo={record.paymentOutTradeNo || record.id}
                          packageName={record.packageName || "历史充值申请"}
                          priceCents={record.priceCents}
                          paymentMethod={paymentLabel(record.paymentMethod)}
                          createdAt={record.createdAt}
                          processedAt={record.processedAt}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </section>

        <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">积分明细</h2>
            <p className="mt-1 text-xs text-slate-500">扣费、退回、充值到账和管理员调整都会保留记录。</p>
          </div>
          {ledger.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-400">暂无积分记录</div>
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
