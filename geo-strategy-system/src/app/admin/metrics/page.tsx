import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Clock3,
  CreditCard,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UsersRound,
  WalletCards,
} from "lucide-react"
import { isAdminUser } from "@/lib/admin"
import { getCurrentUser } from "@/lib/auth"
import { getAdminOperationsMetrics, type DailyOperationsMetric } from "@/lib/admin-metrics"
import { formatYuan } from "@/lib/pricing"
import SiteFooter from "@/components/site-footer"

export const dynamic = "force-dynamic"
export const revalidate = 0

function formatInt(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(Math.round(value))
}

function formatTime(value?: number | string): string {
  if (!value) return "-"
  return new Date(value).toLocaleString("zh-CN", { hour12: false })
}

function formatDateLabel(date: string): string {
  const [, month, day] = date.split("-")
  return `${month}/${day}`
}

function usageBarWidth(metric: DailyOperationsMetric, maxUsage: number): string {
  if (maxUsage <= 0) return "0%"
  return `${Math.max(4, Math.round((metric.usageNet / maxUsage) * 100))}%`
}

export default async function AdminMetricsPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect("/sign-in?redirect_url=/admin/metrics")

  if (!isAdminUser(currentUser)) {
    return (
      <div className="min-h-screen flex items-center justify-center geo-saturated-bg px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl ring-1 ring-slate-200">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 ring-1 ring-rose-200">
            <ShieldCheck className="h-7 w-7 text-rose-500" />
          </div>
          <h1 className="text-lg font-bold text-slate-900">无权限访问</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">该页面仅限管理员访问。</p>
        </div>
      </div>
    )
  }

  const metrics = await getAdminOperationsMetrics()
  const maxDailyUsage = Math.max(...metrics.daily.map(item => item.usageNet), 0)

  return (
    <div className="min-h-screen geo-saturated-bg">
      <header className="sticky top-0 z-30 border-b border-slate-200/60 bg-white/90 shadow-sm shadow-slate-200/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#087F9C] shadow-sm">
              <BarChart3 className="h-5 w-5 text-white" />
            </span>
            <div>
              <div className="geo-brand-title text-lg text-[#12343C]">
                势途 GEO · 运营监控
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">积分消耗、充值到账与模块使用排行</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Link
              href="/admin/recharge"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
            >
              <CreditCard className="h-3.5 w-3.5" />
              充值审批
            </Link>
            <Link
              href="/admin/ledger"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
            >
              <ReceiptText className="h-3.5 w-3.5" />
              积分流水
            </Link>
            <Link
              href="/admin"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              用户管理
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 md:px-8 md:py-8">
        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="今日净消耗"
            value={formatInt(metrics.today.usageNet)}
            note={`扣费 ${formatInt(metrics.today.usageGross)} / 退回 ${formatInt(metrics.today.usageRefund)}`}
            tone="orange"
          />
          <MetricCard
            icon={<Activity className="h-4 w-4" />}
            label="今日功能使用"
            value={formatInt(metrics.today.usageCount)}
            note={`今日活跃用户 ${formatInt(metrics.today.activeUserCount)}`}
            tone="blue"
          />
          <MetricCard
            icon={<WalletCards className="h-4 w-4" />}
            label="今日充值到账"
            value={formatInt(metrics.today.rechargeCredits)}
            note={`${formatYuan(metrics.today.rechargeAmountCents)} / ${formatInt(metrics.today.approvedRechargeCount)} 笔`}
            tone="emerald"
          />
          <MetricCard
            icon={<Clock3 className="h-4 w-4" />}
            label="待审批充值"
            value={formatInt(metrics.totals.pendingRechargeCount)}
            note="需要人工核对到账"
            tone="amber"
          />
        </section>

        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard
            icon={<Sparkles className="h-4 w-4" />}
            label="近 7 天净消耗"
            value={formatInt(metrics.last7Days.usageNet)}
            note={`${formatInt(metrics.last7Days.usageCount)} 次功能使用`}
            tone="slate"
          />
          <MetricCard
            icon={<CreditCard className="h-4 w-4" />}
            label="近 7 天充值"
            value={formatInt(metrics.last7Days.rechargeCredits)}
            note={`${formatYuan(metrics.last7Days.rechargeAmountCents)} / ${formatInt(metrics.last7Days.approvedRechargeCount)} 笔`}
            tone="slate"
          />
          <MetricCard
            icon={<UsersRound className="h-4 w-4" />}
            label="近 7 天活跃用户"
            value={formatInt(metrics.last7Days.activeUserCount)}
            note={`总用户 ${formatInt(metrics.totals.users)} / 停用 ${formatInt(metrics.totals.disabledUsers)}`}
            tone="slate"
          />
          <MetricCard
            icon={<WalletCards className="h-4 w-4" />}
            label="当前总余额"
            value={formatInt(metrics.totals.currentOutstandingCredits)}
            note={`累计到账 ${formatInt(metrics.totals.rechargeCredits)} 积分`}
            tone="slate"
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="border-b border-slate-100 px-5 py-4">
              <h1 className="text-sm font-semibold text-slate-900">近 14 天运营趋势</h1>
              <p className="mt-1 text-xs text-slate-500">按北京时间聚合功能净消耗、使用次数、充值到账和活跃用户。</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left">
                <thead className="bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">日期</th>
                    <th className="px-5 py-3">净消耗</th>
                    <th className="px-5 py-3">使用次数</th>
                    <th className="px-5 py-3">充值到账</th>
                    <th className="px-5 py-3">活跃用户</th>
                    <th className="px-5 py-3">待审批</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.daily.map(item => (
                    <tr key={item.date} className="border-t border-slate-100 text-sm">
                      <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-slate-500">{formatDateLabel(item.date)}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-orange-400" style={{ width: usageBarWidth(item, maxDailyUsage) }} />
                          </div>
                          <span className="font-mono font-semibold text-orange-700">{formatInt(item.usageNet)}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 font-mono text-slate-700">{formatInt(item.usageCount)}</td>
                      <td className="px-5 py-3">
                        <div className="font-mono font-semibold text-emerald-700">+{formatInt(item.rechargeCredits)}</div>
                        <div className="mt-0.5 text-[11px] text-slate-400">{formatYuan(item.rechargeAmountCents)}</div>
                      </td>
                      <td className="px-5 py-3 font-mono text-slate-700">{formatInt(item.activeUserCount)}</td>
                      <td className="px-5 py-3 font-mono text-amber-700">{formatInt(item.pendingRechargeCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">模块扣费排行</h2>
              <p className="mt-1 text-xs text-slate-500">按净消耗积分排序，用于判断成本和收入贡献。</p>
            </div>
            {metrics.features.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-slate-400">暂无功能扣费</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {metrics.features.slice(0, 10).map(feature => (
                  <div key={feature.key} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{feature.label}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          使用 {formatInt(feature.usageCount)} 次 · 退回 {formatInt(feature.usageRefund)} 积分
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-lg font-bold text-orange-700">{formatInt(feature.usageNet)}</div>
                        <div className="text-[11px] text-slate-400">净消耗</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">用户价值排行</h2>
              <p className="mt-1 text-xs text-slate-500">优先看净消耗、充值到账和当前余额，识别高价值客户。</p>
            </div>
            {metrics.users.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-slate-400">暂无用户数据</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left">
                  <thead className="bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-5 py-3">用户</th>
                      <th className="px-5 py-3">净消耗</th>
                      <th className="px-5 py-3">充值</th>
                      <th className="px-5 py-3">余额</th>
                      <th className="px-5 py-3">最近活动</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.users.map(user => (
                      <tr key={user.userId} className="border-t border-slate-100 text-sm">
                        <td className="px-5 py-3">
                          <Link href={`/admin/users/${user.userId}`} className="font-medium text-slate-900 hover:text-[#0077B6]">
                            {user.name}
                          </Link>
                          <div className="mt-0.5 text-[11px] text-slate-400">{user.email}</div>
                        </td>
                        <td className="px-5 py-3">
                          <div className="font-mono font-semibold text-orange-700">{formatInt(user.usageNet)}</div>
                          <div className="mt-0.5 text-[11px] text-slate-400">{formatInt(user.usageCount)} 次</div>
                        </td>
                        <td className="px-5 py-3">
                          <div className="font-mono font-semibold text-emerald-700">+{formatInt(user.rechargeCredits)}</div>
                          <div className="mt-0.5 text-[11px] text-slate-400">{formatYuan(user.rechargeAmountCents)}</div>
                        </td>
                        <td className="px-5 py-3 font-mono font-semibold text-slate-900">{formatInt(user.balance)}</td>
                        <td className="px-5 py-3 text-xs text-slate-500">{formatTime(user.lastActivityAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="space-y-5">
            <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-sm font-semibold text-slate-900">待审批充值</h2>
                <p className="mt-1 text-xs text-slate-500">按提交时间倒序显示最近 10 条。</p>
              </div>
              {metrics.pendingRecharges.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-slate-400">暂无待审批充值</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {metrics.pendingRecharges.map(record => (
                    <div key={record.id} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{record.username}</div>
                          <div className="mt-0.5 text-xs text-slate-500">{record.email}</div>
                          <div className="mt-1 text-[11px] text-slate-400">{formatTime(record.createdAt)}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-sm font-bold text-amber-700">+{formatInt(record.credits ?? record.amount)}</div>
                          <div className="text-[11px] text-slate-400">{record.priceCents ? formatYuan(record.priceCents) : "-"}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-sm font-semibold text-slate-900">最近积分流水</h2>
                <p className="mt-1 text-xs text-slate-500">用于快速发现刚发生的扣费、退回或充值到账。</p>
              </div>
              {metrics.latestLedger.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-slate-400">暂无积分流水</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {metrics.latestLedger.map(entry => (
                    <div key={entry.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div>
                        <div className="text-sm font-medium text-slate-900">{entry.description || entry.featureKey || entry.type}</div>
                        <div className="mt-0.5 text-[11px] text-slate-400">{formatTime(entry.createdAt)}</div>
                      </div>
                      <div className={`font-mono text-sm font-bold ${entry.delta > 0 ? "text-emerald-700" : "text-rose-700"}`}>
                        {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-4 text-xs leading-6 text-slate-500 shadow-sm ring-1 ring-slate-200">
          数据更新时间：{formatTime(metrics.generatedAt)}。统计口径：功能使用次数按 `usage_reserved` 流水计算；净消耗 = 功能扣费 - 失败/未使用退回；充值金额只统计已审批到账的固定套餐金额。
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}

function MetricCard({
  icon,
  label,
  value,
  note,
  tone,
}: {
  icon: ReactNode
  label: string
  value: string
  note: string
  tone: "orange" | "blue" | "emerald" | "amber" | "slate"
}) {
  const toneClass = {
    orange: "from-[#F97316] to-[#F43F5E]",
    blue: "from-[#0077B6] to-[#00A6FB]",
    emerald: "from-[#10B981] to-[#00D4FF]",
    amber: "from-[#F59E0B] to-[#F97316]",
    slate: "from-[#061826] to-[#334155]",
  }[tone]

  return (
    <div className={`rounded-lg bg-gradient-to-br ${toneClass} p-4 text-white shadow-lg shadow-slate-900/12 ring-1 ring-white/20`}>
      <div className="inline-flex items-center gap-1.5 rounded-lg bg-white/13 px-2 py-1 text-xs font-medium text-white ring-1 ring-white/18">
        {icon}
        {label}
      </div>
      <div className="mt-3 font-mono text-3xl font-bold text-white">{value}</div>
      <div className="mt-1 text-xs text-white/72">{note}</div>
    </div>
  )
}
