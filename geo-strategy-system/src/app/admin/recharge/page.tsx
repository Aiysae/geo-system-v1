import { redirect } from "next/navigation"
import Link from "next/link"
import { Download, Inbox, ReceiptText, ShieldCheck, Sparkles } from "lucide-react"
import { isAdminUser } from "@/lib/admin"
import { getCurrentUser } from "@/lib/auth"
import { listAllRequests } from "@/lib/recharge"
import SiteFooter from "@/components/site-footer"
import { AdminHeader } from "@/components/admin/admin-header"
import { RechargeRow } from "./recharge-row"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdminRechargePage() {
  const user = await getCurrentUser()
  if (!user) redirect("/sign-in?redirect_url=/admin/recharge")
  if (!isAdminUser(user)) {
    return (
      <div className="min-h-screen flex items-center justify-center geo-saturated-bg px-4">
        <div className="w-full max-w-md rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 p-8 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-50 ring-1 ring-rose-200 flex items-center justify-center mb-5">
            <ShieldCheck className="h-7 w-7 text-rose-500" />
          </div>
          <h1 className="text-lg font-bold text-slate-900">无权限访问</h1>
          <p className="text-sm text-slate-500 mt-2 leading-relaxed">
            该页面仅限管理员访问。如认为是配置问题请联系系统管理员。
          </p>
        </div>
      </div>
    )
  }

  const requests = await listAllRequests(300)
  const pending = requests.filter(item => item.status === "pending")
  const approved = requests.filter(item => item.status === "approved")
  const rejected = requests.filter(item => item.status === "rejected")
  const approvedCredits = approved.reduce((sum, item) => sum + (item.credits ?? item.amount), 0)

  return (
    <div className="min-h-screen geo-saturated-bg">
      <AdminHeader
        title="势途 GEO · 管理后台"
        subtitle="积分充值申请与到账审批"
        icon={<ShieldCheck className="h-5 w-5 text-white" />}
        active="recharge"
      />

      <main className="max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[11px] text-slate-400 mb-1.5 tracking-[0.18em] uppercase font-medium">
              待审批
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-transparent">
              积分充值申请
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Link
              href="/admin/recharge/export"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white ring-1 ring-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              <Download className="h-3.5 w-3.5" />
              导出充值记录
            </Link>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white ring-1 ring-slate-200 text-xs text-slate-600">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              待审批 <span className="font-mono font-bold text-slate-900">{pending.length}</span> 条
            </span>
          </div>
        </div>

        <div className="mb-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg bg-white/92 p-4 shadow-lg shadow-slate-900/8 ring-1 ring-white/70">
            <div className="text-xs text-slate-500">总申请</div>
            <div className="mt-2 font-mono text-2xl font-bold text-slate-900">{requests.length}</div>
          </div>
          <div className="rounded-lg bg-white/92 p-4 shadow-lg shadow-slate-900/8 ring-1 ring-white/70">
            <div className="text-xs text-amber-700">待审批</div>
            <div className="mt-2 font-mono text-2xl font-bold text-amber-700">{pending.length}</div>
          </div>
          <div className="rounded-lg bg-white/92 p-4 shadow-lg shadow-slate-900/8 ring-1 ring-white/70">
            <div className="text-xs text-emerald-700">已到账</div>
            <div className="mt-2 font-mono text-2xl font-bold text-emerald-700">{approved.length}</div>
          </div>
          <div className="rounded-lg bg-white/92 p-4 shadow-lg shadow-slate-900/8 ring-1 ring-white/70">
            <div className="text-xs text-slate-500">到账积分</div>
            <div className="mt-2 font-mono text-2xl font-bold text-slate-900">{approvedCredits}</div>
          </div>
        </div>

        {requests.length === 0 ? (
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-12 text-center">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-50 ring-1 ring-slate-200 flex items-center justify-center mb-4">
              <Inbox className="h-7 w-7 text-slate-400" />
            </div>
            <p className="text-sm text-slate-500">暂无充值申请</p>
          </div>
        ) : (
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ReceiptText className="h-4 w-4 text-[#1677FF]" />
                最近充值申请
              </div>
              <span className="text-xs text-slate-400">已拒绝 {rejected.length} 条</span>
            </div>
            <div className="md:overflow-x-auto">
              <table className="admin-responsive-table w-full min-w-[820px]">
              <thead>
                <tr className="bg-slate-50/60 text-left text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                  <th className="px-4 py-3">用户</th>
                  <th className="px-4 py-3">套餐 / 金额 / 积分</th>
                  <th className="px-4 py-3">提交时间</th>
                  <th className="px-4 py-3">状态 / 操作</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(req => (
                  <RechargeRow key={req.id} req={req} />
                ))}
              </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  )
}
