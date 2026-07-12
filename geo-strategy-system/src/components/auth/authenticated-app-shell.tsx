"use client"

import { useEffect, useState } from "react"
import AppShell from "@/components/app-shell"
import { useCredits } from "@/components/credits/credits-provider"
import type { PublicUser } from "@/lib/auth"

type AuthState = "checking" | "authenticated" | "error"

export function AuthenticatedAppShell() {
  const [state, setState] = useState<AuthState>("checking")
  const [message, setMessage] = useState("")
  const [user, setUser] = useState<PublicUser | null>(null)
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
          const body = await res.json() as { user?: PublicUser }
          if (!body.user?.id) throw new Error("登录账号信息不完整")
          setUser(body.user)
          setState("authenticated")
          void refresh()
          return
        }
        if (res.status === 401) {
          window.location.replace("/sign-in?redirect_url=/workspace")
          return
        }
        setMessage(`登录状态确认失败（HTTP ${res.status}），请刷新后重试。`)
        setState("error")
      } catch (error) {
        if (cancelled) return
        setMessage(error instanceof Error ? error.message : "登录状态确认失败，请刷新后重试。")
        setState("error")
      }
    }

    checkSession()
    return () => {
      cancelled = true
    }
  }, [refresh])

  if (state === "authenticated" && user) return <AppShell userId={user.id} />

  return (
    <div className="flex min-h-screen items-center justify-center geo-saturated-bg px-4">
      <div className="rounded-lg bg-white/92 px-6 py-5 text-center text-sm text-slate-600 shadow-xl ring-1 ring-white/70">
        {state === "checking" ? "正在确认登录状态..." : message}
      </div>
    </div>
  )
}
