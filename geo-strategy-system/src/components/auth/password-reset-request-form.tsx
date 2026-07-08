"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2, Mail } from "lucide-react"

export function PasswordResetRequestForm() {
  const [email, setEmail] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setMessage("")
    setPending(true)

    try {
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || "提交失败，请稍后再试")
        return
      }
      setMessage(data?.message || "如果该邮箱已注册，系统已提交密码重置申请。")
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
          <Mail className="h-5 w-5 text-white" />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-950">找回密码</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          输入注册邮箱后，系统会创建一条密码重置申请。管理员确认后会提供一次性重置链接。
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">注册邮箱</span>
          <span className="relative block">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={email}
              onChange={event => setEmail(event.target.value)}
              type="email"
              required
              autoComplete="email"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#0077B6] focus:ring-4 focus:ring-blue-100"
              placeholder="name@example.com"
            />
          </span>
        </label>

        {error && (
          <div className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">
            {error}
          </div>
        )}
        {message && (
          <div className="rounded-xl bg-emerald-50 px-3 py-2.5 text-sm leading-6 text-emerald-700 ring-1 ring-emerald-200">
            {message}
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#004B73] to-[#0077B6] text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-300/40 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          提交重置申请
        </button>
      </form>

      <div className="mt-6 text-center text-sm text-slate-500">
        <Link href="/sign-in" className="inline-flex items-center gap-1 font-medium text-[#006AA3] hover:text-[#004B73]">
          <ArrowLeft className="h-3.5 w-3.5" />
          返回登录
        </Link>
      </div>
    </div>
  )
}
