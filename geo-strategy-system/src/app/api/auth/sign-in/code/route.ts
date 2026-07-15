import { NextResponse } from "next/server"
import { authenticateUserWithEmailCode, createSession } from "@/lib/auth"
import { getClientIp, hitRateLimit } from "@/lib/rate-limit"
import { isSecureRequest } from "@/lib/request-security"
import { AUTH_COOKIE_NAME } from "@/lib/session-cookie"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const email = typeof body?.email === "string" ? body.email : ""
    const verificationCode = typeof body?.verificationCode === "string"
      ? body.verificationCode
      : ""
    if (!email || !verificationCode) {
      return NextResponse.json({ error: "请输入邮箱和验证码" }, { status: 400 })
    }

    const ip = getClientIp(request)
    const [ipLimit, emailLimit] = await Promise.all([
      hitRateLimit("auth:code-sign-in:ip", ip, 30, 10 * 60),
      hitRateLimit("auth:code-sign-in:email", email.trim().toLowerCase(), 10, 10 * 60),
    ])
    if (!ipLimit.ok || !emailLimit.ok) {
      return NextResponse.json(
        { error: "登录尝试过于频繁，请稍后重试" },
        { status: 429 },
      )
    }

    const user = await authenticateUserWithEmailCode(email, verificationCode)
    const session = await createSession(user.id)
    const response = NextResponse.json({ user })
    response.cookies.set(AUTH_COOKIE_NAME, session.cookieValue, {
      httpOnly: true,
      secure: isSecureRequest(request),
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    })
    return response
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "登录失败" },
      { status: 400 },
    )
  }
}
