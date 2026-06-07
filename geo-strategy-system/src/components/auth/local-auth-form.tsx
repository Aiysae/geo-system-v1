"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, Loader2, LockKeyhole, Mail, UserRound } from "lucide-react"

type Mode = "sign-in" | "sign-up"

export function LocalAuthForm({
  mode,
  redirectUrl,
}: {
  mode: Mode
  redirectUrl?: string
}) {
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const isSignUp = mode === "sign-up"
  const target = isSignUp ? "/api/auth/sign-up" : "/api/auth/sign-in"
  const nextUrl = sanitizeRedirect(redirectUrl)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setPending(true)

    const form = new FormData(event.currentTarget)
    const payload = {
      name: String(form.get("name") || ""),
      email: String(form.get("email") || ""),
      password: String(form.get("password") || ""),
    }

    try {
      const res = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setError(data?.error || (isSignUp ? "注册失败" : "登录失败"))
        return
      }

      window.location.assign(nextUrl)
    } catch {
      setError("网络连接失败，请稍后重试")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 px-7 py-8">
      <div className="mb-7">
        <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#004B73] to-[#0077B6] shadow-lg shadow-blue-300/40">
          <LockKeyhole className="h-5 w-5 text-white" />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-950">
          {isSignUp ? "注册势途 GEO" : "登录势途 GEO"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          {isSignUp ? "使用邮箱和密码创建账号。" : "使用邮箱和密码进入系统。"}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {isSignUp && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">姓名或昵称</span>
            <span className="relative block">
              <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                name="name"
                autoComplete="name"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#0077B6] focus:ring-4 focus:ring-blue-100"
                placeholder="例如：王总"
              />
            </span>
          </label>
        )}

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">邮箱</span>
          <span className="relative block">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#0077B6] focus:ring-4 focus:ring-blue-100"
              placeholder="name@example.com"
            />
          </span>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">密码</span>
          <span className="relative block">
            <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={isSignUp ? "new-password" : "current-password"}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#0077B6] focus:ring-4 focus:ring-blue-100"
              placeholder={isSignUp ? "至少 8 位，含字母和数字" : "请输入密码"}
            />
          </span>
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
          {isSignUp ? "注册并进入系统" : "登录"}
        </button>
      </form>

      <div className="mt-6 text-center text-sm text-slate-500">
        {isSignUp ? "已有账号？" : "还没有账号？"}
        <Link
          href={`${isSignUp ? "/sign-in" : "/sign-up"}?redirect_url=${encodeURIComponent(nextUrl)}`}
          className="ml-1 font-medium text-[#006AA3] hover:text-[#004B73]"
        >
          {isSignUp ? "去登录" : "去注册"}
        </Link>
      </div>
    </div>
  )
}

function sanitizeRedirect(value?: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/"
  if (value.startsWith("/sign-in") || value.startsWith("/sign-up")) return "/"
  return value
}
