import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowLeft, Download, ReceiptText, ShieldCheck } from "lucide-react"
import { isAdminUser } from "@/lib/admin"
import { getCurrentUser, listUsers } from "@/lib/auth"
import { listAllCreditLedger, type CreditLedgerEntry } from "@/lib/credit-ledger"
import { getFeaturePrice } from "@/lib/pricing"
import SiteFooter from "@/components/site-footer"

export const dynamic = "force-dynamic"
export const revalidate = 0

const TYPE_LABEL: Record<CreditLedgerEntry["type"], string> = {
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

const TYPE_CLASS: Record<CreditLedgerEntry["type"], string> = {
  trial_grant: "bg-blue-50 text-blue-700 ring-blue-200",
  bootstrap_grant: "bg-blue-50 text-blue-700 ring-blue-200",
  recharge_requested: "bg-amber-50 text-amber-700 ring-amber-200",
  recharge_approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  recharge_rejected: "bg-rose-50 text-rose-700 ring-rose-200",
  admin_adjust: "bg-slate-50 text-slate-700 ring-slate-200",
  usage_reserved: "bg-orange-50 text-orange-700 ring-orange-200",
  usage_refund: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  usage_extra: "bg-violet-50 text-violet-700 ring-violet-200",
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false })
}

function entryLabel(entry: CreditLedgerEntry): string {
  if (entry.description) return entry.description
  if (entry.featureKey) return getFeaturePrice(entry.featureKey).label
  return TYPE_LABEL[entry.type] || "积分变动"
}

export default async function AdminLedgerPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect("/sign-in?redirect_url=/admin/ledger")

  if (!isAdminUser(currentUser)) {
    return (
      <div className="min-h-screen flex items-center justify-center geo-saturated-bg px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl ring-1 ring-slate-200">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 ring-1 ring-rose-200">
            <ShieldCheck className="h-7 w-7 text-rose-500" />
          </div>
          <h1 className="text-lg font-bold text-slate-900">无权限访问</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            该页面仅限管理员访问。如认为是配置问题，请检查管理员配置。
          </p>
        </div>
      </div>
    )
  }

  const [entries, users] = await Promise.all([
    listAllCreditLedger(500),
    listUsers(),
  ])
  const userMap = new Map(users.map(user => [user.id, user]))
  const usageCredits = entries
    .filter(entry => entry.type === "usage_reserved" || entry.type === "usage_extra")
    .reduce((sum, entry) => sum + Math.abs(entry.delta), 0)
  const rechargeCredits = entries
    .filter(entry => entry.type === "recharge_approved")
    .reduce((sum, entry) => sum + entry.delta, 0)

  return (
    <div className="min-h-screen geo-saturated-bg">
      <header className="sticky top-0 z-30 border-b border-slate-200/60 bg-white/90 shadow-sm shadow-slate-200/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#087F9C] shadow-sm">
              <ReceiptText className="h-5 w-5 text-white" />
            </span>
            <div>
              <div className="geo-brand-title text-lg text-[#12343C]">
                势途 GEO · 积分流水审计
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">最近 500 条积分变动</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/metrics"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
            >
              运营监控
            </Link>
            <Link
              href="/admin/ledger/export"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              导出流水
            </Link>
            <Link
              href="/admin/recharge"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回后台
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 md:px-8 md:py-8">
        <section className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg bg-white/92 p-4 shadow-lg shadow-slate-900/8 ring-1 ring-white/70">
            <div className="text-xs text-slate-500">流水条数</div>
            <div className="mt-2 font-mono text-2xl font-bold text-slate-900">{entries.length}</div>
          </div>
          <div className="rounded-lg bg-white/92 p-4 shadow-lg shadow-slate-900/8 ring-1 ring-white/70">
            <div className="text-xs text-orange-700">累计功能扣费</div>
            <div className="mt-2 font-mono text-2xl font-bold text-orange-700">{usageCredits}</div>
          </div>
          <div className="rounded-lg bg-white/92 p-4 shadow-lg shadow-slate-900/8 ring-1 ring-white/70">
            <div className="text-xs text-emerald-700">累计充值到账</div>
            <div className="mt-2 font-mono text-2xl font-bold text-emerald-700">{rechargeCredits}</div>
          </div>
          <div className="rounded-lg bg-white/92 p-4 shadow-lg shadow-slate-900/8 ring-1 ring-white/70">
            <div className="text-xs text-slate-500">涉及用户</div>
            <div className="mt-2 font-mono text-2xl font-bold text-slate-900">{userMap.size}</div>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="border-b border-slate-100 px-5 py-4">
            <h1 className="text-sm font-semibold text-slate-900">积分流水</h1>
            <p className="mt-1 text-xs text-slate-500">用于核对每一次功能扣费、失败退回、充值到账和人工调账。</p>
          </div>
          {entries.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-slate-400">暂无积分流水</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-left">
                <thead className="bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">时间</th>
                    <th className="px-5 py-3">用户</th>
                    <th className="px-5 py-3">类型</th>
                    <th className="px-5 py-3">说明</th>
                    <th className="px-5 py-3">变动</th>
                    <th className="px-5 py-3">余额</th>
                    <th className="px-5 py-3">来源</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(entry => {
                    const user = userMap.get(entry.userId)
                    return (
                      <tr key={entry.id} className="border-t border-slate-100 text-sm">
                        <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">{formatTime(entry.createdAt)}</td>
                        <td className="px-5 py-3">
                          <Link href={`/admin/users/${entry.userId}`} className="font-medium text-slate-900 hover:text-[#0077B6]">
                            {user?.name || user?.email || entry.userId}
                          </Link>
                          <div className="mt-0.5 text-[11px] text-slate-400">{user?.email || entry.userId}</div>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex rounded-lg px-2 py-1 text-xs font-medium ring-1 ${TYPE_CLASS[entry.type]}`}>
                            {TYPE_LABEL[entry.type]}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-900">{entryLabel(entry)}</td>
                        <td className={`px-5 py-3 font-mono font-semibold ${entry.delta > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                        </td>
                        <td className="px-5 py-3 font-mono text-slate-700">
                          {typeof entry.balanceAfter === "number" ? entry.balanceAfter : "-"}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-500">
                          {entry.source || "-"}
                          {entry.sourceId ? <div className="mt-0.5 font-mono text-[10px] text-slate-400">{entry.sourceId}</div> : null}
                        </td>
                      </tr>
                    )
                  })}
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
