import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowLeft, KeyRound } from "lucide-react"
import { isAdminUser } from "@/lib/admin"
import { getCurrentUser, listPasswordResetRequests } from "@/lib/auth"
import SiteFooter from "@/components/site-footer"
import { PasswordResetRow } from "./password-reset-row"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdminPasswordResetsPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect("/sign-in?redirect_url=/admin/password-resets")
  if (!isAdminUser(currentUser)) redirect("/admin")

  const requests = await listPasswordResetRequests(120)
  const pendingCount = requests.filter(request => request.status === "pending").length
  const unmatchedCount = requests.filter(request => (request.userStatus || (request.userId ? "active" : "missing")) === "missing").length

  return (
    <div className="min-h-screen geo-saturated-bg">
      <header className="sticky top-0 z-30 border-b border-slate-200/60 bg-white/90 shadow-sm shadow-slate-200/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#004B73] to-[#0077B6] shadow-lg shadow-blue-300/40">
              <KeyRound className="h-5 w-5 text-white" />
            </span>
            <div>
              <div className="text-sm font-bold tracking-wide text-slate-900">密码重置申请</div>
              <div className="mt-0.5 text-[11px] text-slate-500">生成一次性重置链接</div>
            </div>
          </div>
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回后台
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
        <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="border-b border-slate-100 px-5 py-4">
            <h1 className="text-sm font-semibold text-slate-900">最近密码重置申请</h1>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              用户提交申请后，管理员在这里生成一次性链接并发给用户。链接 30 分钟内有效，使用一次后失效。
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-lg bg-amber-50 px-2.5 py-1 font-medium text-amber-700 ring-1 ring-amber-200">
                待处理 {pendingCount}
              </span>
              <span className="rounded-lg bg-slate-50 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
                未匹配邮箱 {unmatchedCount}
              </span>
            </div>
          </div>
          {requests.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-400">暂无密码重置申请</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left">
                <thead className="bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">用户</th>
                    <th className="px-5 py-3">匹配状态</th>
                    <th className="px-5 py-3">状态</th>
                    <th className="px-5 py-3">申请时间</th>
                    <th className="px-5 py-3">链接过期时间</th>
                    <th className="px-5 py-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map(request => (
                    <PasswordResetRow key={request.id} request={request} />
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
