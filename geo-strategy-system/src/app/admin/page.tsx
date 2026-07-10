import Link from "next/link"
import { redirect } from "next/navigation"
import { Inbox, KeyRound, ReceiptText, ShieldCheck, Sparkles, UsersRound } from "lucide-react"
import { isAdminUser } from "@/lib/admin"
import { getCurrentUser, listPasswordResetRequests, listUsers } from "@/lib/auth"
import { getCredits } from "@/lib/credits"
import { hasUnlimitedCreditAccess } from "@/lib/with-credits"
import SiteFooter from "@/components/site-footer"
import { CreditsAdjustForm } from "./credits-adjust-form"
import { UserStatusForm } from "./user-status-form"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdminPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect("/sign-in?redirect_url=/admin")

  if (!isAdminUser(currentUser)) {
    return (
      <div className="min-h-screen flex items-center justify-center geo-saturated-bg px-4">
        <div className="w-full max-w-md rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 p-8 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-50 ring-1 ring-rose-200 flex items-center justify-center mb-5">
            <ShieldCheck className="h-7 w-7 text-rose-500" />
          </div>
          <h1 className="text-lg font-bold text-slate-900">无权限访问</h1>
          <p className="text-sm text-slate-500 mt-2 leading-relaxed">
            该页面仅限管理员访问。如认为是配置问题，请检查 `ADMIN_EMAILS` 环境变量。
          </p>
        </div>
      </div>
    )
  }

  const [users, passwordResetRequests] = await Promise.all([
    listUsers(),
    listPasswordResetRequests(120),
  ])
  const rows = await Promise.all(
    users.map(async user => ({
      user,
      credits: await getCredits(user.id),
      unlimited: hasUnlimitedCreditAccess(user),
    }))
  )
  const totalCredits = rows.reduce((sum, row) => sum + (row.unlimited ? 0 : row.credits), 0)
  const adminCount = rows.filter(row => row.user.role === "admin").length
  const pendingPasswordResetCount = passwordResetRequests.filter(request => request.status === "pending").length

  return (
    <div className="min-h-screen geo-saturated-bg">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200/60 shadow-sm shadow-slate-200/40">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#004B73] to-[#0077B6] flex items-center justify-center shadow-lg shadow-blue-300/40">
              <ShieldCheck className="h-5 w-5 text-white" />
            </span>
            <div>
              <div className="text-sm font-bold tracking-wide bg-gradient-to-r from-[#004B73] to-[#0077B6] bg-clip-text text-transparent">
                势途 GEO · 管理后台
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">用户与积分管理</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/metrics"
              className="text-xs font-medium px-3 py-2 rounded-lg bg-white ring-1 ring-slate-200 text-slate-700 hover:bg-slate-50 transition"
            >
              运营监控
            </Link>
            <Link
              href="/admin/recharge"
              className="text-xs font-medium px-3 py-2 rounded-lg bg-white ring-1 ring-slate-200 text-slate-700 hover:bg-slate-50 transition"
            >
              充值审批 / 模型配置
            </Link>
            <Link
              href="/admin/ledger"
              className="text-xs font-medium px-3 py-2 rounded-lg bg-white ring-1 ring-slate-200 text-slate-700 hover:bg-slate-50 transition"
            >
              积分流水
            </Link>
            <Link
              href="/admin/password-resets"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-white ring-1 ring-slate-200 text-slate-700 hover:bg-slate-50 transition"
            >
              <KeyRound className="h-3.5 w-3.5 text-[#0077B6]" />
              密码重置
              {pendingPasswordResetCount > 0 && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] text-amber-700">
                  {pendingPasswordResetCount}
                </span>
              )}
            </Link>
            <Link
              href="/"
              className="text-xs font-medium px-3 py-2 rounded-lg bg-white ring-1 ring-slate-200 text-slate-700 hover:bg-slate-50 transition"
            >
              返回主页
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-8">
        <div className="mb-6 flex items-end justify-between gap-3">
          <div>
            <div className="text-[11px] text-slate-400 mb-1.5 tracking-[0.18em] uppercase font-medium">
              Users
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-transparent">
              用户列表
            </h1>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white ring-1 ring-slate-200 text-xs text-slate-600">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            共 <span className="font-mono font-bold text-slate-900">{rows.length}</span> 个用户
          </span>
        </div>

        <div className="mb-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg bg-white/92 p-4 shadow-lg shadow-slate-900/8 ring-1 ring-white/70">
            <div className="text-xs text-slate-500">用户总数</div>
            <div className="mt-2 font-mono text-2xl font-bold text-slate-900">{rows.length}</div>
          </div>
          <div className="rounded-lg bg-white/92 p-4 shadow-lg shadow-slate-900/8 ring-1 ring-white/70">
            <div className="flex items-center gap-1.5 text-xs text-amber-700">
              <Sparkles className="h-3.5 w-3.5" />
              可计费用户总积分
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-amber-700">{totalCredits}</div>
          </div>
          <div className="rounded-lg bg-white/92 p-4 shadow-lg shadow-slate-900/8 ring-1 ring-white/70">
            <div className="flex items-center gap-1.5 text-xs text-blue-700">
              <ShieldCheck className="h-3.5 w-3.5" />
              管理员
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-blue-700">{adminCount}</div>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-12 text-center">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-50 ring-1 ring-slate-200 flex items-center justify-center mb-4">
              <Inbox className="h-7 w-7 text-slate-400" />
            </div>
            <p className="text-sm text-slate-500">暂无用户</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm">
            <table className="w-full min-w-[920px]">
              <thead>
                <tr className="bg-slate-50/60 text-left text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                  <th className="px-4 py-3">用户</th>
                  <th className="px-4 py-3">角色</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">积分</th>
                  <th className="px-4 py-3">注册时间</th>
                  <th className="px-4 py-3">积分操作</th>
                  <th className="px-4 py-3">明细</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ user, credits, unlimited }) => (
                  <tr key={user.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-4">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-[#006AA3] ring-1 ring-blue-100">
                          <UsersRound className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900">{user.name}</div>
                          <div className="text-xs text-slate-500">{user.email}</div>
                          <div className="mt-1 font-mono text-[10px] text-slate-400">{user.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={user.role === "admin" ? "rounded-lg bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-100" : "rounded-lg bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200"}>
                        {user.role === "admin" ? "管理员" : "用户"}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <UserStatusForm userId={user.id} status={user.status} />
                    </td>
                    <td className="px-4 py-4 text-sm font-bold text-slate-900">
                      {unlimited ? (
                        <div>
                          <span className="rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-700 ring-1 ring-blue-100">无限</span>
                          <div className="mt-1 font-mono text-[10px] font-normal text-slate-400">账面 {credits}</div>
                        </div>
                      ) : (
                        <span className="font-mono">{credits}</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-xs text-slate-500">
                      {new Date(user.createdAt).toLocaleString("zh-CN", { hour12: false })}
                    </td>
                    <td className="px-4 py-4">
                      <CreditsAdjustForm userId={user.id} disabled={unlimited} />
                    </td>
                    <td className="px-4 py-4">
                      <Link
                        href={`/admin/users/${user.id}`}
                        className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-[#0077B6]"
                      >
                        <ReceiptText className="h-3.5 w-3.5" />
                        查看
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  )
}
