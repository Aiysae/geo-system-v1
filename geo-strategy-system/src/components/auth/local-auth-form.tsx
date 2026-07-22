"use client"

import { useCallback, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowRight, KeyRound, Loader2, LockKeyhole, Mail, MailCheck, UserRound } from "lucide-react"
import { EmailVerificationField } from "@/components/auth/email-verification-field"
import { toUserFacingError } from "@/lib/user-facing-errors"

type Mode = "sign-in" | "sign-up"

export function LocalAuthForm({
  mode,
  redirectUrl,
  inviteRequired = false,
}: {
  mode: Mode
  redirectUrl?: string
  inviteRequired?: boolean
}) {
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [email, setEmail] = useState("")
  const [verificationCode, setVerificationCode] = useState("")
  const [signInMethod, setSignInMethod] = useState<"password" | "code">("password")
  const router = useRouter()
  const isSignUp = mode === "sign-up"
  const usesVerificationCode = isSignUp || signInMethod === "code"
  const nextUrl = sanitizeRedirect(redirectUrl)
  const updateVerificationCode = useCallback((value: string) => setVerificationCode(value), [])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setPending(true)

    const form = new FormData(event.currentTarget)
    const payload = {
      name: String(form.get("name") || ""),
      email,
      password: String(form.get("password") || ""),
      inviteCode: String(form.get("inviteCode") || ""),
      verificationCode,
      termsAccepted: form.get("termsAccepted") === "on",
    }
    const target = isSignUp
      ? "/api/auth/sign-up"
      : signInMethod === "code"
        ? "/api/auth/sign-in/code"
        : "/api/auth/sign-in"

    try {
      const res = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setError(toUserFacingError(data?.error, {
          status: res.status,
          fallback: isSignUp ? "注册失败，请稍后重试。" : "登录失败，请检查账号信息。",
          subject: isSignUp ? "注册" : "登录",
        }))
        return
      }

      const sessionReady = await waitForSessionReady()
      if (!sessionReady) {
        setError("登录状态确认失败，请重新登录。")
        return
      }
      router.replace(nextUrl)
      router.refresh()
    } catch {
      setError("网络连接失败，请稍后重试")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="w-full max-w-[440px] overflow-hidden rounded-lg bg-white/98 shadow-[0_30px_80px_-34px_rgba(0,10,45,0.86)] ring-1 ring-white/35 backdrop-blur-xl">
      <div className="border-b border-[#E7EEF6] bg-[linear-gradient(135deg,#F7FBFF_0%,#EAF5FF_100%)] px-6 py-5 sm:px-7">
        <div className="flex items-center gap-3">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1.5 shadow-sm ring-1 ring-[#D6E7FF]">
            <Image
              src="/brand/shitu-lockup-transparent-v2.png"
              alt="势途 Logo"
              width={1173}
              height={1341}
              priority
              className="h-full w-auto object-contain"
            />
          </span>
          <div className="min-w-0">
            <div className="text-base font-bold text-[#001D66]">SHITU · 势途 GEO</div>
            <div className="mt-0.5 text-[10px] font-medium text-[#5B7592]">GEO 全链路操作工具</div>
          </div>
        </div>
      </div>

      <div className="px-6 py-6 sm:px-7 sm:py-7">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-950">
            {isSignUp ? "注册势途 GEO" : "登录势途 GEO"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            {isSignUp ? "验证邮箱后创建账号。" : "使用密码或邮箱验证码进入系统。"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
        {!isSignUp && (
          <div className="grid h-10 grid-cols-2 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="登录方式">
            <button
              type="button"
              role="tab"
              aria-selected={signInMethod === "password"}
              style={{ backgroundColor: signInMethod === "password" ? "#ffffff" : "transparent" }}
              onClick={() => {
                setSignInMethod("password")
                setError("")
              }}
              className={`inline-flex min-w-0 items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition ${signInMethod === "password" ? "bg-white text-[#0958D9] shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
            >
              <KeyRound className="h-3.5 w-3.5" />
              密码登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={signInMethod === "code"}
              style={{ backgroundColor: signInMethod === "code" ? "#ffffff" : "transparent" }}
              onClick={() => {
                setSignInMethod("code")
                setError("")
              }}
              className={`inline-flex min-w-0 items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition ${signInMethod === "code" ? "bg-white text-[#0958D9] shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
            >
              <MailCheck className="h-3.5 w-3.5" />
              验证码登录
            </button>
          </div>
        )}
        {isSignUp && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">姓名或昵称</span>
            <span className="relative block">
              <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                name="name"
                autoComplete="name"
                className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/15"
                placeholder="例如：王总"
              />
            </span>
          </label>
        )}

        {isSignUp && inviteRequired && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">邀请码</span>
            <span className="relative block">
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                name="inviteCode"
                required
                autoComplete="off"
                className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/15"
                placeholder="请输入管理员提供的邀请码"
              />
            </span>
          </label>
        )}

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">邮箱</span>
          <span className="relative block">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={email}
              onChange={event => {
                setEmail(event.target.value)
                setVerificationCode("")
              }}
              name="email"
              type="email"
              required
              autoComplete="email"
              className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/15"
              placeholder="name@example.com"
            />
          </span>
        </label>

        {usesVerificationCode && (
          <EmailVerificationField
            email={email}
            purpose={isSignUp ? "sign-up" : "sign-in"}
            code={verificationCode}
            onCodeChange={updateVerificationCode}
            disabled={pending}
          />
        )}

        {(!usesVerificationCode || isSignUp) && <label className="block">
          <span className="mb-1.5 flex items-center justify-between gap-2 text-xs font-medium text-slate-600">
            <span>密码</span>
            {!isSignUp && signInMethod === "password" && (
              <Link href="/forgot-password" className="font-medium text-[#0958D9] hover:text-[#003EB3]">
                忘记密码？
              </Link>
            )}
          </span>
          <span className="relative block">
            <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={isSignUp ? "new-password" : "current-password"}
              className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/15"
              placeholder={isSignUp ? "至少 8 位，含字母和数字" : "请输入密码"}
            />
          </span>
        </label>}

        {isSignUp && (
          <label className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600 ring-1 ring-slate-200">
            <input
              name="termsAccepted"
              type="checkbox"
              required
              className="mt-1 h-3.5 w-3.5 rounded border-slate-300 text-[#0958D9] focus:ring-[#1677FF]"
            />
            <span>
              我已阅读并同意
              <Link href="/terms" target="_blank" className="mx-1 font-medium text-[#0958D9] hover:text-[#003EB3]">
                服务协议
              </Link>
              <Link href="/privacy" target="_blank" className="mr-1 font-medium text-[#0958D9] hover:text-[#003EB3]">
                隐私政策
              </Link>
              和
              <Link href="/recharge-rules" target="_blank" className="ml-1 font-medium text-[#0958D9] hover:text-[#003EB3]">
                充值规则
              </Link>
            </span>
          </label>
        )}

        {error && (
          <div className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#1677FF] to-[#00C8FF] text-sm font-semibold text-white shadow-md shadow-blue-500/20 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {isSignUp ? "注册并进入系统" : signInMethod === "code" ? "验证并登录" : "登录"}
        </button>
        </form>

        <div className="mt-6 text-center text-sm text-slate-500">
        {isSignUp ? "已有账号？" : "还没有账号？"}
        <Link
          href={`${isSignUp ? "/sign-in" : "/sign-up"}?redirect_url=${encodeURIComponent(nextUrl)}`}
          className="ml-1 font-medium text-[#0958D9] hover:text-[#003EB3]"
        >
          {isSignUp ? "去登录" : "去注册"}
        </Link>
        </div>
      </div>
    </div>
  )
}

async function waitForSessionReady(): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch("/api/me", {
      cache: "no-store",
      credentials: "same-origin",
    }).catch(() => null)
    if (res?.ok) return true
    await new Promise(resolve => window.setTimeout(resolve, 120 * (attempt + 1)))
  }
  return false
}

function sanitizeRedirect(value?: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/"
  if (value.startsWith("/sign-in") || value.startsWith("/sign-up")) return "/"
  return value
}
