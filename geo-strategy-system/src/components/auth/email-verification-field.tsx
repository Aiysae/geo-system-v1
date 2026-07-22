"use client"

import { useEffect, useState } from "react"
import { Loader2, MailCheck } from "lucide-react"
import type { EmailVerificationPurpose } from "@/lib/email-verification"
import { toUserFacingError } from "@/lib/user-facing-errors"

export function EmailVerificationField({
  email,
  purpose,
  code,
  onCodeChange,
  disabled = false,
}: {
  email: string
  purpose: EmailVerificationPurpose
  code: string
  onCodeChange: (value: string) => void
  disabled?: boolean
}) {
  const inputId = `email-verification-${purpose}`
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [sentEmail, setSentEmail] = useState("")
  const [availableAt, setAvailableAt] = useState(0)
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    if (!availableAt) return
    const update = () => {
      const next = Math.max(0, Math.ceil((availableAt - Date.now()) / 1000))
      setRemaining(next)
      if (next === 0) setAvailableAt(0)
    }
    const timer = window.setInterval(update, 500)
    return () => window.clearInterval(timer)
  }, [availableAt])

  const isCurrentEmail = Boolean(sentEmail) && sentEmail === email.trim().toLowerCase()
  const currentRemaining = isCurrentEmail ? remaining : 0

  async function sendCode() {
    const normalizedEmail = email.trim().toLowerCase()
    setError("")
    setMessage("")
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("请先输入有效邮箱")
      return
    }

    setSending(true)
    try {
      const res = await fetch("/api/auth/verification-code/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, purpose }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(toUserFacingError(data?.error, { status: res.status, fallback: "验证码发送失败，请稍后重试。", subject: "验证码发送" }))
        return
      }

      setSentEmail(normalizedEmail)
      setMessage(data?.message || "验证码已发送，请检查邮箱。")
      const cooldownSeconds = Math.max(1, Number(data?.cooldownSeconds || 60))
      setAvailableAt(Date.now() + cooldownSeconds * 1000)
      setRemaining(cooldownSeconds)
    } catch (caught) {
      setError(toUserFacingError(caught, { fallback: "网络连接失败，请稍后重试。", subject: "验证码发送" }))
    } finally {
      setSending(false)
    }
  }

  return (
    <div>
      <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-slate-600">
        邮箱验证码
      </label>
      <div className="grid grid-cols-[minmax(0,1fr)_116px] gap-2">
        <span className="relative block">
          <MailCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id={inputId}
            value={code}
            onChange={event => onCodeChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
            type="text"
            name="verificationCode"
            required
            minLength={6}
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            disabled={disabled}
            className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#1677FF] focus:ring-2 focus:ring-[#1677FF]/15 disabled:bg-slate-50"
            placeholder="6 位验证码"
          />
        </span>
        <button
          type="button"
          onClick={sendCode}
          aria-label={isCurrentEmail ? "重新发送邮箱验证码" : "获取邮箱验证码"}
          disabled={disabled || sending || currentRemaining > 0}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-[#91CAFF] bg-[#E6F4FF] px-3 text-xs font-semibold text-[#0958D9] transition hover:border-[#1677FF] hover:bg-[#BAE0FF] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
        >
          {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {currentRemaining > 0 ? `${currentRemaining} 秒` : isCurrentEmail ? "重新发送" : "获取验证码"}
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs leading-5 text-rose-600">{error}</p>}
      {message && isCurrentEmail && <p className="mt-1.5 text-xs leading-5 text-emerald-600">{message}</p>}
    </div>
  )
}
