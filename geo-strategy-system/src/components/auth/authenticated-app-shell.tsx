"use client"

import { useEffect, useState } from "react"
import AppShell from "@/components/app-shell"
import { useCredits } from "@/components/credits/credits-provider"

type AuthState = "checking" | "authenticated" | "error"

export function AuthenticatedAppShell() {
  const [state, setState] = useState<AuthState>("checking")
  const [message, setMessage] = useState("")
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
          setState("authenticated")
          void refresh()
          return
        }
        if (res.status === 401) {
          window.location.replace("/sign-in?redirect_url=/")
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

  if (state === "authenticated") return <AppShell />

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/30 px-4">
      <div className="rounded-2xl bg-white px-6 py-5 text-center text-sm text-slate-500 shadow-xl ring-1 ring-slate-200">
        {state === "checking" ? "正在确认登录状态..." : message}
      </div>
    </div>
  )
}
