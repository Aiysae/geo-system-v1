import { NextResponse } from "next/server"
import { createSession, createUser, validateSignUpInviteCode } from "@/lib/auth"
import { AUTH_COOKIE_NAME } from "@/lib/session-cookie"
import { isSecureRequest } from "@/lib/request-security"
import { getClientIp, hitRateLimit } from "@/lib/rate-limit"
import { consumeEmailVerificationCode } from "@/lib/email-verification"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request)
    const ipLimit = await hitRateLimit("auth:sign-up:ip", ip, 5, 60 * 60)
    if (!ipLimit.ok) {
      return NextResponse.json(
        { error: "注册请求过于频繁，请稍后再试" },
        { status: 429 },
      )
    }

    const body = await request.json()
    const email = typeof body?.email === "string" ? body.email : ""
    const password = typeof body?.password === "string" ? body.password : ""
    const name = typeof body?.name === "string" ? body.name : ""
    const inviteCode = typeof body?.inviteCode === "string" ? body.inviteCode : ""
    const verificationCode = typeof body?.verificationCode === "string" ? body.verificationCode : ""
    const termsAccepted = body?.termsAccepted === true

    if (!email || !password || !verificationCode) {
      return NextResponse.json({ error: "请输入邮箱、验证码和密码" }, { status: 400 })
    }

    if (!termsAccepted) {
      return NextResponse.json({ error: "请先阅读并同意服务协议、隐私政策和充值规则" }, { status: 400 })
    }

    if (!validateSignUpInviteCode(inviteCode)) {
      return NextResponse.json({ error: "邀请码不正确，请联系管理员获取" }, { status: 403 })
    }

    const emailLimit = await hitRateLimit("auth:sign-up:email", email.trim().toLowerCase(), 3, 60 * 60)
    if (!emailLimit.ok) {
      return NextResponse.json(
        { error: "该邮箱注册请求过于频繁，请稍后再试" },
        { status: 429 },
      )
    }

    await consumeEmailVerificationCode({
      email,
      purpose: "sign-up",
      code: verificationCode,
    })

    const now = new Date().toISOString()
    const user = await createUser({
      email,
      password,
      name,
      termsAcceptedAt: now,
      emailVerifiedAt: now,
    })
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
      { error: error instanceof Error ? error.message : "注册失败" },
      { status: 400 }
    )
  }
}
