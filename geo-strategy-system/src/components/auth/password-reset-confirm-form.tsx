"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, Loader2, LockKeyhole } from "lucide-react"
import { toUserFacingError } from "@/lib/user-facing-errors"

export function PasswordResetConfirmForm({ token }: { token: string }) {
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setPending(true)

    try {
      const res = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(toUserFacingError(data?.error, { status: res.status, fallback: "密码重置失败，请稍后重试。", subject: "密码重置" }))
        return
      }
      setSuccess(true)
    } catch (caught) {
      setError(toUserFacingError(caught, { fallback: "网络连接失败，请稍后重试。", subject: "密码重置" }))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="w-full max-w-md rounded-lg bg-white px-7 py-8 shadow-[0_24px_64px_-34px_rgba(0,0,0,0.7)] ring-1 ring-white/30">
      <div className="mb-7">
        <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[#1677FF] shadow-sm">
          <LockKeyhole className="h-5 w-5 text-white" />
        </div>
        <h1 className="geo-display-title mt-4 text-3xl text-slate-950">设置新密码</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          新密码至少 8 位，并同时包含字母和数字。重置链接只能使用一次。
        </p>
      </div>

      {success ? (
        <div>
          <div className="rounded-xl bg-emerald-50 px-3 py-2.5 text-sm leading-6 text-emerald-700 ring-1 ring-emerald-200">
            密码已重置，请使用新密码登录。
          </div>
          <Link
            href="/sign-in"
            className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#1677FF] text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-300/40"
          >
            <ArrowRight className="h-4 w-4" />
            去登录
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">新密码</span>
            <input
              value={password}
              onChange={event => setPassword(event.target.value)}
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/15"
              placeholder="至少 8 位，含字母和数字"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">确认新密码</span>
            <input
              value={confirmPassword}
              onChange={event => setConfirmPassword(event.target.value)}
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/15"
              placeholder="再次输入新密码"
            />
          </label>

          {error && (
            <div className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#1677FF] text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-300/40 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            确认重置密码
          </button>
        </form>
      )}
    </div>
  )
}
