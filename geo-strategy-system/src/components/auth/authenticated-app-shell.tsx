"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { LockKeyhole } from "lucide-react"
import AppShell from "@/components/app-shell"
import { AccountMenu } from "@/components/auth/account-menu"
import { AdminRechargeNotifier } from "@/components/admin/admin-recharge-notifier"
import { useCredits } from "@/components/credits/credits-provider"
import { GlobalTaskCenter } from "@/components/tasks/global-task-center"
import { UserNotificationCenter } from "@/components/notifications/user-notification-center"
import type { PublicUser } from "@/lib/auth"
import type { WorkspaceAccountAccess } from "@/types"
import type { OnboardingSummary } from "@/types/onboarding"
import { toUserFacingError } from "@/lib/user-facing-errors"
import type { WorkspaceNavigationTarget } from "@/lib/workspace-navigation"

type AuthState = "checking" | "authenticated" | "error"

export function AuthenticatedAppShell({
  initialNavigation,
}: {
  initialNavigation?: WorkspaceNavigationTarget
}) {
  const [state, setState] = useState<AuthState>("checking")
  const [message, setMessage] = useState("")
  const [user, setUser] = useState<PublicUser | null>(null)
  const [access, setAccess] = useState<WorkspaceAccountAccess | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const { refresh } = useCredits()

  useEffect(() => {
    let cancelled = false

    async function checkSession() {
      try {
        const res = await fetch("/api/me", {
          cache: "no-store",
          credentials: "same-origin",
        })
        if (cancelled) return
        if (res.ok) {
          const body = await res.json() as {
            user?: PublicUser
            access?: WorkspaceAccountAccess
            isAdmin?: boolean
            onboarding?: OnboardingSummary
          }
          if (!body.user?.id) throw new Error("登录账号信息不完整")
          let resolvedAccess: WorkspaceAccountAccess = body.access || {
            mode: "standard",
            status: "active",
            canCreateClients: true,
            canManageClientIdentity: true,
            canRunPenetration: true,
            canRunOtherModules: true,
            canCreateReports: true,
            canViewFeedbackReports: true,
            canManageFeedbackReports: true,
          }
          const currentUrl = new URL(window.location.href)
          const teamId = String(initialNavigation?.teamId || currentUrl.searchParams.get("teamId") || "").trim()
          const clientId = String(initialNavigation?.clientId || currentUrl.searchParams.get("clientId") || "").trim()
          if (teamId && clientId) {
            const teamResponse = await fetch(
              `/api/teams/access?teamId=${encodeURIComponent(teamId)}&clientId=${encodeURIComponent(clientId)}`,
              { cache: "no-store", credentials: "same-origin" },
            )
            const teamPayload = await teamResponse.json().catch(() => ({})) as {
              access?: WorkspaceAccountAccess
              error?: string
            }
            if (!teamResponse.ok || !teamPayload.access) {
              throw new Error(teamPayload.error || "团队客户权限读取失败")
            }
            resolvedAccess = teamPayload.access
          }
          if (cancelled) return
          const accountIsSuspended = resolvedAccess.mode === "client"
            && resolvedAccess.status === "suspended"
          if (
            body.onboarding?.autoLaunch
            && !body.user.mustChangePassword
            && !accountIsSuspended
          ) {
            window.location.replace("/workspace/tutorial")
            return
          }
          setUser(body.user)
          setIsAdmin(body.isAdmin === true || body.user.role === "admin")
          setAccess(resolvedAccess)
          setState("authenticated")
          void refresh()
          return
        }
        if (res.status === 401) {
          window.location.replace("/sign-in?redirect_url=/workspace")
          return
        }
        setMessage(toUserFacingError("", {
          status: res.status,
          fallback: "登录状态确认失败，请刷新后重试。",
          subject: "登录状态确认",
        }))
        setState("error")
      } catch (error) {
        if (cancelled) return
        setMessage(toUserFacingError(error, {
          fallback: "登录状态确认失败，请刷新后重试。",
          subject: "登录状态确认",
        }))
        setState("error")
      }
    }

    checkSession()
    return () => {
      cancelled = true
    }
  }, [initialNavigation, refresh])

  if (state === "authenticated" && user && access) {
    if (user.mustChangePassword) {
      return (
        <div className="flex min-h-screen items-center justify-center geo-saturated-bg px-4">
          <div className="w-full max-w-lg rounded-lg bg-white/96 p-6 text-center shadow-2xl ring-1 ring-white/80 sm:p-8">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-[#EAF5FF] text-[#0958D9] ring-1 ring-[#B7DBFF]">
              <LockKeyhole className="h-7 w-7" />
            </span>
            <h1 className="mt-5 text-xl font-semibold text-slate-900">请先设置自己的登录密码</h1>
            <p className="mt-3 text-sm leading-7 text-slate-500">
              当前使用的是主账号生成的临时密码。请通过 {user.email} 接收验证码并设置新密码，完成后再进入客户工作台。
            </p>
            <Link
              href={`/forgot-password?email=${encodeURIComponent(user.email)}&managed=1`}
              className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-5 text-xs font-semibold text-white shadow-sm"
            >
              验证邮箱并设置密码
            </Link>
          </div>
        </div>
      )
    }
    if (access.mode === "client" && access.status === "suspended") {
      return (
        <div className="flex min-h-screen items-center justify-center geo-saturated-bg px-4">
          <div className="w-full max-w-lg rounded-xl bg-white/95 p-6 text-center shadow-2xl ring-1 ring-white/80 sm:p-8">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-200">
              <LockKeyhole className="h-7 w-7" />
            </span>
            <h1 className="mt-5 text-xl font-semibold text-slate-900">客户专属账号已暂停</h1>
            <p className="mt-3 text-sm leading-7 text-slate-500">
              当前账号关联的「{access.clientName || "客户面板"}」已暂停使用。历史数据不会删除，请联系管理员恢复授权。
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Link
                href="/billing"
                className="inline-flex h-10 items-center justify-center rounded-lg bg-[#EAF3FF] px-4 text-xs font-semibold text-[#0958D9] ring-1 ring-[#B7D9FF] transition hover:bg-[#DCEEFF]"
              >
                查看账单
              </Link>
              <AccountMenu />
            </div>
          </div>
        </div>
      )
    }
    return (
      <AppShell
        userId={user.id}
        access={access}
        initialNavigation={initialNavigation}
        taskNotifier={<GlobalTaskCenter userId={user.id} />}
        userNotifier={<UserNotificationCenter variant="workspace" />}
        adminNotifier={isAdmin
          ? <AdminRechargeNotifier variant="workspace" />
          : null}
      />
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center geo-saturated-bg px-4">
      <div className="rounded-lg bg-white/92 px-6 py-5 text-center text-sm text-slate-600 shadow-xl ring-1 ring-white/70">
        {state === "checking" ? "正在确认登录状态..." : message}
      </div>
    </div>
  )
}
