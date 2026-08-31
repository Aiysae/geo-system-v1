import {
  Crown,
  ReceiptText,
  UserRound,
  WalletCards,
} from "lucide-react"
import type { ReactNode } from "react"
import { AdminHeader } from "@/components/admin/admin-header"
import { AdminInternalDataNotice } from "@/components/admin/internal-data-notice"
import SiteFooter from "@/components/site-footer"
import type { AdminInternalUserRecord } from "@/lib/admin-internal-dataset"
import type { CreditLedgerEntry } from "@/lib/credit-ledger"
import { membershipTierLabel } from "@/lib/membership-catalog"
import { formatYuan, getFeaturePrice } from "@/lib/pricing"

const LEDGER_LABEL: Record<CreditLedgerEntry["type"], string> = {
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

function formatTime(value?: number | string): string {
  if (!value) return "-"
  return new Date(value).toLocaleString("zh-CN", { hour12: false })
}

function ledgerLabel(entry: CreditLedgerEntry): string {
  if (entry.description) return entry.description
  if (entry.featureKey) return getFeaturePrice(entry.featureKey).label
  return LEDGER_LABEL[entry.type] || "积分变动"
}

export function AdminInternalUserDetail({
  record,
}: {
  record: AdminInternalUserRecord
}) {
  const { user, membership, recharges, ledger, credits } = record
  const totalRechargeCredits = recharges.reduce(
    (sum, item) => sum + (item.credits ?? item.amount),
    0,
  )
  const totalUsageCredits = ledger
    .filter(item => item.type === "usage_reserved" || item.type === "usage_extra")
    .reduce((sum, item) => sum + Math.abs(item.delta), 0)

  return (
    <div className="min-h-screen geo-saturated-bg">
      <AdminHeader
        title={user.name}
        subtitle={user.email}
        icon={<UserRound className="h-5 w-5 text-white" />}
        active="users"
      />

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 md:px-8 md:py-8">
        <AdminInternalDataNotice />

        <section className="grid gap-3 md:grid-cols-4">
          <SummaryCard
            icon={<WalletCards className="h-3.5 w-3.5 text-amber-500" />}
            label="当前积分"
            value={credits}
            tone="text-slate-900"
          />
          <SummaryCard
            label="累计充值到账"
            value={totalRechargeCredits}
            tone="text-emerald-700"
          />
          <SummaryCard
            label="累计功能扣费"
            value={totalUsageCredits}
            tone="text-orange-700"
          />
          <div className="rounded-lg bg-white/92 p-4 shadow-lg shadow-slate-900/8 ring-1 ring-white/70">
            <div className="text-xs text-slate-500">账号概况</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                正常
              </span>
              <span className="rounded-lg bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-100">
                用户
              </span>
              <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium ring-1 ${
                membership.active
                  ? "bg-amber-50 text-amber-700 ring-amber-200"
                  : "bg-slate-50 text-slate-500 ring-slate-200"
              }`}>
                <Crown className="h-3 w-3" />
                {membershipTierLabel(membership.tier)}
              </span>
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">账号信息</h2>
          <div className="mt-4 grid gap-2 text-xs text-slate-500 md:grid-cols-3">
            <div>用户 ID：<span className="break-all font-mono text-slate-600">{user.id}</span></div>
            <div>注册时间：{formatTime(user.createdAt)}</div>
            <div>最近活动：{formatTime(user.lastLoginAt)}</div>
          </div>
          {membership.active ? (
            <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
              {membershipTierLabel(membership.tier)} · 累计套餐金额 {formatYuan(membership.paidCents)} · {membership.qualifyingOrderCount} 笔记录
            </div>
          ) : null}
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ReceiptText className="h-4 w-4 text-[#1677FF]" />
                充值记录
              </h2>
            </div>
            {recharges.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-400">暂无充值记录</div>
            ) : (
              <div className="md:overflow-x-auto">
                <table className="admin-responsive-table w-full min-w-[680px] text-left">
                  <thead className="bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-5 py-3">套餐</th>
                      <th className="px-5 py-3">金额</th>
                      <th className="px-5 py-3">积分</th>
                      <th className="px-5 py-3">状态</th>
                      <th className="px-5 py-3">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recharges.map(item => (
                      <tr key={item.id} className="border-t border-slate-100 text-sm">
                        <td data-label="套餐" className="px-5 py-3 font-medium text-slate-900">{item.packageName}</td>
                        <td data-label="金额" className="px-5 py-3 font-mono text-slate-700">{formatYuan(item.priceCents || 0)}</td>
                        <td data-label="积分" className="px-5 py-3 font-mono font-semibold text-emerald-700">+{item.credits ?? item.amount}</td>
                        <td data-label="状态" className="px-5 py-3">
                          <span className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">已到账</span>
                        </td>
                        <td data-label="时间" className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">{formatTime(item.processedAt || item.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">积分流水</h2>
            </div>
            <div className="md:overflow-x-auto">
              <table className="admin-responsive-table w-full min-w-[700px] text-left">
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
                  {ledger.map(item => (
                    <tr key={item.id} className="border-t border-slate-100 text-sm">
                      <td data-label="时间" className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">{formatTime(item.createdAt)}</td>
                      <td data-label="类型" className="px-5 py-3 text-slate-600">{LEDGER_LABEL[item.type]}</td>
                      <td data-label="说明" className="px-5 py-3 text-slate-900">{ledgerLabel(item)}</td>
                      <td data-label="变动" className={`px-5 py-3 font-mono font-semibold ${item.delta > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {item.delta > 0 ? `+${item.delta}` : item.delta}
                      </td>
                      <td data-label="余额" className="px-5 py-3 font-mono text-slate-700">{item.balanceAfter ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon?: ReactNode
  label: string
  value: number
  tone: string
}) {
  return (
    <div className="rounded-lg bg-white/92 p-4 shadow-lg shadow-slate-900/8 ring-1 ring-white/70">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        {icon}
        {label}
      </div>
      <div className={`mt-2 font-mono text-3xl font-bold ${tone}`}>{value}</div>
    </div>
  )
}
