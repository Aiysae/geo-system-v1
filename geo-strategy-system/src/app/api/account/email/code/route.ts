import { NextResponse } from "next/server"
import {
  assertAuthEmailConfigured,
  AuthEmailConfigurationError,
  AuthEmailDeliveryError,
} from "@/lib/auth-email"
import { getCurrentUser, validateAccountEmailChangeTarget } from "@/lib/auth"
import { EmailVerificationError, issueEmailVerificationCode } from "@/lib/email-verification"
import { getClientIp, hitRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "用户未登录" }, { status: 401 })

  try {
    const body = await request.json()
    const email = await validateAccountEmailChangeTarget(user.id, String(body?.email || ""))
    const [userLimit, emailLimit] = await Promise.all([
      hitRateLimit("account:email-code:user", `${user.id}:${getClientIp(request)}`, 5, 60 * 60),
      hitRateLimit("account:email-code:target", email, 5, 60 * 60),
    ])
    if (!userLimit.ok || !emailLimit.ok) {
      return NextResponse.json({ error: "验证码发送过于频繁，请稍后重试" }, { status: 429 })
    }
    assertAuthEmailConfigured()
    await issueEmailVerificationCode({ email, purpose: "email-change" })
    return NextResponse.json({
      ok: true,
      message: "验证码已发送至新邮箱",
      cooldownSeconds: 60,
    })
  } catch (error) {
    const status = error instanceof EmailVerificationError
      ? error.status
      : error instanceof AuthEmailConfigurationError || error instanceof AuthEmailDeliveryError
        ? 503
        : 400
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "验证码发送失败" },
      { status },
    )
  }
}
