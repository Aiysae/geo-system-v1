import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft, ReceiptText, ShieldCheck, UserRound, WalletCards } from "lucide-react"
import { isAdminUser } from "@/lib/admin"
import { getCurrentUser, getUserById } from "@/lib/auth"
import { getCredits } from "@/lib/credits"
import { listCreditLedgerForUser, type CreditLedgerEntry } from "@/lib/credit-ledger"
import { formatYuan, getFeaturePrice } from "@/lib/pricing"
import { listRequestsForUser, type RechargeRequest } from "@/lib/recharge"
import SiteFooter from "@/components/site-footer"
import { CreditsAdjustForm } from "../../credits-adjust-form"
import { UserStatusForm } from "../../user-status-form"

export const dynamic = "force-dynamic"
export const revalidate = 0

type PageProps = {
  params: Promise<{ userId: string }>
}

const RECHARGE_LABEL: Record<RechargeRequest["status"], string> = {
  pending: "待审批",
  approved: "已到账",
  rejected: "已拒绝",
}

const RECHARGE_CLASS: Record<RechargeRequest["status"], string> = {
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200",
}

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

export default async function AdminUserDetailPage({ params }: PageProps) {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect("/sign-in?redirect_url=/admin")

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

  const { userId } = await params
  const user = await getUserById(userId)
  if (!user) notFound()

  const [credits, recharges, ledger] = await Promise.all([
    getCredits(user.id),
    listRequestsForUser(user.id, 100),
    listCreditLedgerForUser(user.id, 150),
  ])
  const totalRechargeCredits = recharges
    .filter(item => item.status === "approved")
    .reduce((sum, item) => sum + (item.credits ?? item.amount), 0)
  const totalUsageCredits = ledger
    .filter(item => item.type === "usage_reserved" || item.type === "usage_extra")
    .reduce((sum, item) => sum + Math.abs(item.delta), 0)

  return (
    <div className="min-h-screen geo-saturated-bg">
      <header className="sticky top-0 z-30 border-b border-slate-200/60 bg-white/90 shadow-sm shadow-slate-200/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#004B73] to-[#0077B6] shadow-lg shadow-blue-300/40">
              <UserRound className="h-5 w-5 text-white" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold tracking-wide text-slate-900">{user.name}</div>
              <div className="mt-0.5 truncate text-[11px] text-slate-500">{user.email}</div>
            </div>
          </div>
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回用户列表
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 md:px-8 md:py-8">
        <section className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg bg-white/92 p-4 shadow-lg shadow-slate-900/8 ring-1 ring-white/70">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <WalletCards className="h-3.5 w-3.5 text-amber-500" />
              当前积分
            </div>
            <div className="mt-2 font-mono text-3xl font-bold text-slate-900">{credits}</div>
          </div>
          <div className="rounded-lg bg-white/92 p-4 shadow-lg shadow-slate-900/8 ring-1 ring-white/70">
            <div className="text-xs text-emerald-700">累计充值到账</div>
            <div className="mt-2 font-mono text-3xl font-bold text-emerald-700">{totalRechargeCredits}</div>
          </div>
          <div className="rounded-lg bg-white/92 p-4 shadow-lg shadow-slate-900/8 ring-1 ring-white/70">
            <div className="text-xs text-orange-700">累计功能扣费</div>
            <div className="mt-2 font-mono text-3xl font-bold text-orange-700">{totalUsageCredits}</div>
          </div>
          <div className="rounded-lg bg-white/92 p-4 shadow-lg shadow-slate-900/8 ring-1 ring-white/70">
            <div className="text-xs text-slate-500">账号状态</div>
            <div className="mt-2">
              <span className="inline-flex rounded-lg bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                {user.status === "active" ? "正常" : "停用"}
              </span>
              <span className="ml-2 inline-flex rounded-lg bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-100">
                {user.role === "admin" ? "管理员" : "用户"}
              </span>
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <ShieldCheck className="h-4 w-4 text-[#0077B6]" />
            账号管理
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-medium text-slate-500">积分手动调整</div>
              <CreditsAdjustForm userId={user.id} />
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-slate-500">账号状态</div>
              <UserStatusForm userId={user.id} status={user.status} />
            </div>
          </div>
          <div className="mt-4 grid gap-2 text-xs text-slate-500 md:grid-cols-3">
            <div>用户 ID：<span className="font-mono text-slate-600">{user.id}</span></div>
            <div>注册时间：{formatTime(user.createdAt)}</div>
            <div>最近登录：{formatTime(user.lastLoginAt)}</div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ReceiptText className="h-4 w-4 text-[#0077B6]" />
                充值记录
              </h2>
            </div>
            {recharges.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-400">暂无充值记录</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] text-left">
                  <thead className="bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-5 py-3">套餐</th>
                      <th className="px-5 py-3">订单号</th>
                      <th className="px-5 py-3">金额</th>
                      <th className="px-5 py-3">积分</th>
                      <th className="px-5 py-3">付款核对信息</th>
                      <th className="px-5 py-3">状态</th>
                      <th className="px-5 py-3">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recharges.map(record => (
                      <tr key={record.id} className="border-t border-slate-100 text-sm">
                        <td className="px-5 py-3 font-medium text-slate-900">{record.packageName || "历史充值申请"}</td>
                        <td className="px-5 py-3 font-mono text-xs text-slate-500">
                          {record.paymentOutTradeNo || record.paymentOrderId || "-"}
                        </td>
                        <td className="px-5 py-3 font-mono text-slate-700">
                          {record.priceCents ? formatYuan(record.priceCents) : "-"}
                        </td>
                        <td className="px-5 py-3 font-mono font-semibold text-slate-900">+{record.credits ?? record.amount}</td>
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
                          <span className={`inline-flex rounded-lg px-2 py-1 text-xs font-medium ring-1 ${RECHARGE_CLASS[record.status]}`}>
                            {RECHARGE_LABEL[record.status]}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-500">{formatTime(record.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">消费流水</h2>
            </div>
            {ledger.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-400">暂无消费流水</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left">
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
                        <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">{formatTime(entry.createdAt)}</td>
                        <td className="px-5 py-3 text-slate-600">{LEDGER_LABEL[entry.type]}</td>
                        <td className="px-5 py-3 text-slate-900">{ledgerLabel(entry)}</td>
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
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
