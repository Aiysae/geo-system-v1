import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@clerk/nextjs/server"
import { ShieldCheck, Sparkles, Inbox } from "lucide-react"
import { isAdminUserId } from "@/lib/admin"
import { listPending } from "@/lib/recharge"
import { RechargeRow } from "./recharge-row"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdminRechargePage() {
  const { userId } = await auth()
  if (!userId) redirect("/sign-in?redirect_url=/admin/recharge")
  if (!isAdminUserId(userId)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/30 px-4">
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

  const pending = await listPending()

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/30">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200/60 shadow-sm shadow-slate-200/40">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#004B73] to-[#0077B6] flex items-center justify-center shadow-lg shadow-blue-300/40">
              <ShieldCheck className="h-5 w-5 text-white" />
            </span>
            <div>
              <div className="text-sm font-bold tracking-wide bg-gradient-to-r from-[#004B73] to-[#0077B6] bg-clip-text text-transparent">
                势途 GEO · 管理后台
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">积分充值审批</div>
            </div>
          </div>
          <Link
            href="/"
            className="text-xs font-medium px-3 py-2 rounded-lg bg-white ring-1 ring-slate-200 text-slate-700 hover:bg-slate-50 transition"
          >
            返回主页
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-8">
        <div className="mb-6 flex items-end justify-between gap-3">
          <div>
            <div className="text-[11px] text-slate-400 mb-1.5 tracking-[0.18em] uppercase font-medium">
              待审批
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-transparent">
              积分充值申请
            </h1>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white ring-1 ring-slate-200 text-xs text-slate-600">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            共 <span className="font-mono font-bold text-slate-900">{pending.length}</span> 条
          </span>
        </div>

        {pending.length === 0 ? (
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-12 text-center">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-50 ring-1 ring-slate-200 flex items-center justify-center mb-4">
              <Inbox className="h-7 w-7 text-slate-400" />
            </div>
            <p className="text-sm text-slate-500">暂无待审批申请</p>
          </div>
        ) : (
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50/60 text-left text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                  <th className="px-4 py-3">用户</th>
                  <th className="px-4 py-3">申请积分</th>
                  <th className="px-4 py-3">提交时间</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {pending.map(req => (
                  <RechargeRow key={req.id} req={req} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
