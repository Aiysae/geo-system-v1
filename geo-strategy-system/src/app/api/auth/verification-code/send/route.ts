import { NextResponse } from "next/server"
import {
  assertAuthEmailConfigured,
  AuthEmailConfigurationError,
  AuthEmailDeliveryError,
} from "@/lib/auth-email"
import { getUserByEmail, normalizeEmail } from "@/lib/auth"
import {
  EmailVerificationError,
  issueEmailVerificationCode,
  type EmailVerificationPurpose,
} from "@/lib/email-verification"
import { getClientIp, hitRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PURPOSES = new Set<EmailVerificationPurpose>([
  "sign-up",
  "sign-in",
  "password-reset",
])

const success = {
  ok: true,
  message: "验证码已发送，请检查邮箱及垃圾邮件。",
  cooldownSeconds: 60,
  expiresInSeconds: 300,
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const email = normalizeEmail(typeof body?.email === "string" ? body.email : "")
    const purposeValue = typeof body?.purpose === "string" ? body.purpose : ""
    if (!email || !PURPOSES.has(purposeValue as EmailVerificationPurpose)) {
      return NextResponse.json({ error: "请输入有效邮箱" }, { status: 400 })
    }
    const purpose = purposeValue as EmailVerificationPurpose

    const ip = getClientIp(request)
    const [ipLimit, emailLimit] = await Promise.all([
      hitRateLimit("auth:verification-code:ip", ip, 30, 60 * 60),
      hitRateLimit("auth:verification-code:email", `${purpose}:${email}`, 5, 60 * 60),
    ])
    if (!ipLimit.ok || !emailLimit.ok) {
      return NextResponse.json(
        { error: "验证码发送过于频繁，请稍后重试" },
        { status: 429 },
      )
    }

    assertAuthEmailConfigured()
    const user = await getUserByEmail(email)
    if (purpose === "sign-up" && user) {
      return NextResponse.json({ error: "该邮箱已注册，请直接登录" }, { status: 409 })
    }
    if (purpose !== "sign-up" && (!user || user.status !== "active")) {
      await new Promise(resolve => setTimeout(resolve, 120))
      return NextResponse.json(success)
    }

    await issueEmailVerificationCode({ email, purpose })
    return NextResponse.json(success)
  } catch (error) {
    if (error instanceof EmailVerificationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof AuthEmailConfigurationError || error instanceof AuthEmailDeliveryError) {
      return NextResponse.json({ error: error.message }, { status: 503 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "验证码发送失败" },
      { status: 400 },
    )
  }
}
