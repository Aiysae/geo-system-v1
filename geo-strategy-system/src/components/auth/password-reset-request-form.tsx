"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, LockKeyhole, Mail } from "lucide-react"
import { EmailVerificationField } from "@/components/auth/email-verification-field"

export function PasswordResetRequestForm() {
  const [email, setEmail] = useState("")
  const [verificationCode, setVerificationCode] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const updateVerificationCode = useCallback((value: string) => setVerificationCode(value), [])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    if (password !== confirmPassword) {
      setError("两次输入的新密码不一致")
      return
    }
    setPending(true)

    try {
      const res = await fetch("/api/auth/password-reset/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          verificationCode,
          password,
          confirmPassword,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || "密码重置失败，请稍后重试")
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
    <div className="w-full max-w-md rounded-lg bg-white px-7 py-8 shadow-[0_24px_64px_-34px_rgba(0,0,0,0.7)] ring-1 ring-white/30">
      <div className="mb-7">
        <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-[#1677FF] to-[#00C8FF] shadow-md shadow-blue-500/20">
          {success ? <CheckCircle2 className="h-5 w-5 text-white" /> : <Mail className="h-5 w-5 text-white" />}
        </div>
        <h1 className="geo-display-title mt-4 text-3xl text-slate-950">
          {success ? "密码已重置" : "找回密码"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          {success
            ? "原有登录状态已失效，请使用新密码登录。"
            : "通过注册邮箱接收验证码，验证后设置新密码。"}
        </p>
      </div>

      {success ? (
        <Link
          href="/sign-in"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00C8FF] text-sm font-semibold text-white shadow-md shadow-blue-500/20 transition hover:brightness-105"
        >
          <ArrowRight className="h-4 w-4" />
          使用新密码登录
        </Link>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">注册邮箱</span>
            <span className="relative block">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={email}
                onChange={event => {
                  setEmail(event.target.value)
                  setVerificationCode("")
                }}
                type="email"
                required
                autoComplete="email"
                disabled={pending}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/15 disabled:bg-slate-50"
                placeholder="name@example.com"
              />
            </span>
          </label>

          <EmailVerificationField
            email={email}
            purpose="password-reset"
            code={verificationCode}
            onCodeChange={updateVerificationCode}
            disabled={pending}
          />

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">新密码</span>
            <span className="relative block">
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={password}
                onChange={event => setPassword(event.target.value)}
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                disabled={pending}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/15 disabled:bg-slate-50"
                placeholder="至少 8 位，含字母和数字"
              />
            </span>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">确认新密码</span>
            <span className="relative block">
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                disabled={pending}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/15 disabled:bg-slate-50"
                placeholder="再次输入新密码"
              />
            </span>
          </label>

          {error && (
            <div className="rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00C8FF] text-sm font-semibold text-white shadow-md shadow-blue-500/20 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            验证并重置密码
          </button>
        </form>
      )}

      <div className="mt-6 text-center text-sm text-slate-500">
        <Link href="/sign-in" className="inline-flex items-center gap-1 font-medium text-[#0958D9] hover:text-[#003EB3]">
          <ArrowLeft className="h-3.5 w-3.5" />
          返回登录
        </Link>
      </div>
    </div>
  )
}
