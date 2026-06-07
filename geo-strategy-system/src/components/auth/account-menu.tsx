"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { LogOut, ShieldCheck, UserRound } from "lucide-react"

type MeResponse = {
  user?: {
    id: string
    email: string
    name: string
    role: "admin" | "user"
  }
}

export function AccountMenu() {
  const [user, setUser] = useState<MeResponse["user"] | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    fetch("/api/me", { cache: "no-store" })
      .then(res => (res.ok ? res.json() : null))
      .then((data: MeResponse | null) => {
        if (alive) setUser(data?.user ?? null)
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
    window.location.assign("/sign-in")
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
        aria-label="账号菜单"
      >
        <UserRound className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-64 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-slate-200">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="truncate text-sm font-semibold text-slate-900">
              {user?.name || "当前账号"}
            </div>
            <div className="mt-0.5 truncate text-xs text-slate-500">{user?.email || "已登录"}</div>
          </div>

          {user?.role === "admin" && (
            <Link
              href="/admin"
              className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 transition hover:bg-slate-50"
              onClick={() => setOpen(false)}
            >
              <ShieldCheck className="h-4 w-4 text-[#0077B6]" />
              管理后台
            </Link>
          )}

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
