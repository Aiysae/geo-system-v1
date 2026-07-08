"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, Loader2, LockKeyhole } from "lucide-react"

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
        setError(data?.error || "密码重置失败")
        return
      }
      setSuccess(true)
    } catch {
      setError("网络连接失败，请稍后重试")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl bg-white px-7 py-8 shadow-xl ring-1 ring-slate-200">
      <div className="mb-7">
        <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#004B73] to-[#0077B6] shadow-lg shadow-blue-300/40">
          <LockKeyhole className="h-5 w-5 text-white" />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-950">设置新密码</h1>
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
            className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#004B73] to-[#0077B6] text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-300/40"
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
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-[#0077B6] focus:ring-4 focus:ring-blue-100"
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
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-[#0077B6] focus:ring-4 focus:ring-blue-100"
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
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#004B73] to-[#0077B6] text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-300/40 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            确认重置密码
          </button>
        </form>
      )}
    </div>
  )
}
