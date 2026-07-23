"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import InteractiveTutorial from "@/components/tutorial/interactive-tutorial"
import { toUserFacingError } from "@/lib/user-facing-errors"
import type { PublicUser } from "@/lib/auth"
import type { WorkspaceAccountAccess } from "@/types"
import type { OnboardingSummary } from "@/types/onboarding"

type GateState =
  | { phase: "loading" }
  | { phase: "ready"; user: PublicUser; access: WorkspaceAccountAccess; onboarding: OnboardingSummary }
  | { phase: "error"; message: string }

export default function TutorialGate() {
  const searchParams = useSearchParams()
  const manual = searchParams.get("manual") === "1"
  const [state, setState] = useState<GateState>({ phase: "loading" })

  useEffect(() => {
    let active = true

    async function loadSession() {
      try {
        const response = await fetch("/api/me", {
          cache: "no-store",
          credentials: "same-origin",
        })
        if (!active) return
        if (response.status === 401) {
          window.location.replace(
            `/sign-in?redirect_url=${encodeURIComponent("/workspace/tutorial")}`,
          )
          return
        }
        if (!response.ok) {
          throw new Error("登录状态确认失败")
        }
        const body = await response.json() as {
          user?: PublicUser
          access?: WorkspaceAccountAccess
          onboarding?: OnboardingSummary
        }
        if (!body.user?.id || !body.access || !body.onboarding) {
          throw new Error("教程所需的账号信息不完整")
        }
        if (
          body.user.mustChangePassword
          || (body.access.mode === "client" && body.access.status === "suspended")
        ) {
          window.location.replace("/workspace")
          return
        }
        setState({
          phase: "ready",
          user: body.user,
          access: body.access,
          onboarding: body.onboarding,
        })
      } catch (error) {
        if (!active) return
        setState({
          phase: "error",
          message: toUserFacingError(error, {
            fallback: "教程加载失败，请刷新后重试。",
            subject: "新手教程",
          }),
        })
      }
    }

    void loadSession()
    return () => {
      active = false
    }
  }, [])

  if (state.phase === "ready") {
    return (
      <InteractiveTutorial
        userName={state.user.name}
        access={state.access}
        onboarding={state.onboarding}
        manual={manual}
      />
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F3F8FF] px-4">
      <div className="max-w-md rounded-lg border border-[#CFE0F2] bg-white px-6 py-5 text-center text-sm text-slate-600 shadow-lg">
        {state.phase === "loading" ? "正在准备体验教程..." : state.message}
      </div>
    </main>
  )
}
