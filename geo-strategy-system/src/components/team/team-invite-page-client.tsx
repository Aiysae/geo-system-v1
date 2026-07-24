"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  UsersRound,
} from "lucide-react"
import {
  TEAM_MODULES,
  hasTeamPermission,
  teamRoleLabel,
  type TeamPermissionKey,
} from "@/lib/team-permissions"

type InvitePayload = {
  invite: {
    id: string
    status: string
    emailMasked: string
    role: "admin" | "member"
    permissionKeys: TeamPermissionKey[]
    expiresAt: string
  }
  team: { id: string; name: string; status: string } | null
}

export function TeamInvitePageClient({ token }: { token: string }) {
  const [payload, setPayload] = useState<InvitePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState("")
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    let active = true
    fetch(`/api/teams/invites/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "邀请读取失败")
        if (active) setPayload(data)
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : "邀请读取失败")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [token])

  const visibleModules = useMemo(() => {
    if (!payload) return []
    return TEAM_MODULES.filter(module => (
      hasTeamPermission(payload.invite.permissionKeys, module.key, "view")
    ))
  }, [payload])

  async function acceptInvite() {
    setAccepting(true)
    setError("")
    try {
      const response = await fetch(`/api/teams/invites/${encodeURIComponent(token)}`, {
        method: "POST",
      })
      if (response.status === 401) {
        const redirectUrl = `/team-invite/${encodeURIComponent(token)}`
        window.location.href = `/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`
        return
      }
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "接受邀请失败")
      setAccepted(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "接受邀请失败")
    } finally {
      setAccepting(false)
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#031B4E] px-4 py-10 text-slate-900">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(0,200,255,.28),transparent_30%),radial-gradient(circle_at_82%_70%,rgba(49,94,251,.34),transparent_34%),linear-gradient(145deg,#031B4E_0%,#063F9D_52%,#001D66_100%)]" />
      <section className="relative w-full max-w-xl overflow-hidden rounded-xl border border-white/25 bg-white shadow-[0_30px_90px_rgba(0,19,65,.42)]">
        <div className="h-1.5 bg-gradient-to-r from-[#1677FF] via-[#00C8FF] to-[#13C2C2]" />
        <div className="p-6 sm:p-8">
          <Image
            src="/brand/shitu-lockup-transparent-v2.png"
            alt="势途 GEO"
            width={150}
            height={45}
            className="h-9 w-auto object-contain"
            priority
          />
          {loading ? (
            <div className="flex min-h-72 items-center justify-center text-sm text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-[#1677FF]" />
              正在读取团队邀请
            </div>
          ) : error && !payload ? (
            <div className="py-16 text-center">
              <LockKeyhole className="mx-auto h-10 w-10 text-slate-300" />
              <h1 className="mt-4 text-xl font-bold">邀请暂不可用</h1>
              <p className="mt-2 text-sm text-slate-500">{error}</p>
              <Link href="/" className="mt-6 inline-flex h-10 items-center rounded-lg bg-[#1677FF] px-4 text-sm font-semibold text-white">返回首页</Link>
            </div>
          ) : accepted ? (
            <div className="py-12 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
              <h1 className="mt-4 text-2xl font-bold">已加入团队</h1>
              <p className="mt-2 text-sm text-slate-500">共享客户与可用模块已经同步到您的账号。</p>
              <Link href="/account?tab=teams" className="mt-7 inline-flex h-11 items-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-5 text-sm font-semibold text-white">
                进入团队中心
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : payload ? (
            <>
              <div className="mt-8 flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#EAF4FF] text-[#1677FF]">
                  <UsersRound className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-xs font-semibold text-[#1677FF]">团队邀请</p>
                  <h1 className="mt-1 text-2xl font-bold text-slate-950">{payload.team?.name || "势途 GEO 团队"}</h1>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    以 {payload.invite.emailMasked} 登录后加入，角色为{teamRoleLabel(payload.invite.role)}。
                  </p>
                </div>
              </div>
              <div className="mt-6 rounded-lg border border-[#D8E7F7] bg-[#F7FBFF] p-4">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                  <ShieldCheck className="h-4 w-4 text-[#1677FF]" />
                  获得的模块访问范围
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {visibleModules.length > 0 ? visibleModules.map(module => (
                    <span key={module.key} className="rounded-md border border-[#B7DBFF] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0958D9]">{module.label}</span>
                  )) : <span className="text-xs text-slate-500">加入后由管理员配置权限</span>}
                </div>
              </div>
              {payload.invite.status !== "pending" ? (
                <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">该邀请状态为“{payload.invite.status}”，无法再次接受。</p>
              ) : null}
              {error ? <p className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p> : null}
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={acceptInvite}
                  disabled={accepting || payload.invite.status !== "pending"}
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00AEEA] px-5 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {accepting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  接受邀请
                </button>
                <Link href="/sign-up" className="inline-flex h-11 items-center justify-center rounded-lg border border-[#B7DBFF] bg-white px-5 text-sm font-semibold text-[#0958D9]">还没有账号？先注册</Link>
              </div>
              <p className="mt-4 text-center text-[11px] text-slate-400">有效期至 {new Date(payload.invite.expiresAt).toLocaleString("zh-CN", { hour12: false })}</p>
            </>
          ) : null}
        </div>
      </section>
    </main>
  )
}
