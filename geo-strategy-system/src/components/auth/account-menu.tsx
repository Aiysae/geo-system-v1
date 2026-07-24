"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Crown, House, LogOut, ShieldCheck, UserRound } from "lucide-react"
import type { MembershipSnapshot } from "@/types"

type MeResponse = {
  user?: {
    id: string
    email: string
    name: string
    role: "admin" | "user"
  }
  membership?: MembershipSnapshot
  isAdmin?: boolean
}

export function AccountMenu() {
  const [user, setUser] = useState<MeResponse["user"] | null>(null)
  const [membership, setMembership] = useState<MembershipSnapshot>({ tier: "free", active: false, paidCents: 0, qualifyingOrderCount: 0, clientAccountLimit: 0 })
  const [isAdmin, setIsAdmin] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    fetch("/api/me", { cache: "no-store" })
      .then(res => (res.ok ? res.json() : null))
      .then((data: MeResponse | null) => {
        if (alive) {
          setUser(data?.user ?? null)
          setIsAdmin(data?.isAdmin === true || data?.user?.role === "admin")
          setMembership(data?.membership?.active === true
            ? data.membership
            : { tier: "free", active: false, paidCents: 0, qualifyingOrderCount: 0, clientAccountLimit: 0 })
        }
      })
      .catch(() => {
        if (alive) setUser(null)
      })
    return () => {
      alive = false
    }
  }, [])

  async function signOut() {
    await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => null)
    window.location.assign("/")
  }

  const initials = (user?.name || user?.email || "我").trim().slice(0, 2).toUpperCase()

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
        aria-label="账号菜单"
      >
        <span className="text-[11px] font-bold text-[#0958D9]">{initials}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-64 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-slate-200">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="truncate text-sm font-semibold text-slate-900">
              {user?.name || "当前账号"}
            </div>
            <div className="mt-0.5 truncate text-xs text-slate-500">{user?.email || "已登录"}</div>
            <div className="mt-2">
              <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold ring-1 ${
                isAdmin || membership.active
                  ? "bg-amber-50 text-amber-700 ring-amber-200"
                  : "bg-slate-50 text-slate-500 ring-slate-200"
              }`}>
                <Crown className="h-3 w-3" />
                {isAdmin ? "管理员权益" : membership.active ? `${membership.tier.toUpperCase()} 会员` : "普通用户"}
              </span>
            </div>
          </div>

          <Link
            href="/account"
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            onClick={() => setOpen(false)}
          >
            <UserRound className="h-4 w-4 text-[#1677FF]" />
            我的主页
          </Link>

          {isAdmin && (
            <Link
              href="/admin"
              className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 transition hover:bg-slate-50"
              onClick={() => setOpen(false)}
            >
              <ShieldCheck className="h-4 w-4 text-[#1677FF]" />
              管理后台
            </Link>
          )}

          <Link
            href="/"
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 transition hover:bg-slate-50"
            onClick={() => setOpen(false)}
          >
            <House className="h-4 w-4 text-[#1677FF]" />
            品牌主页
          </Link>

          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50"
          >
            <LogOut className="h-4 w-4 text-slate-400" />
            退出登录
          </button>
        </div>
      )}
    </div>
  )
}
