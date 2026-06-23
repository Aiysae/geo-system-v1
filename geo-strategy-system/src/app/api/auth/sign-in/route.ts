import { NextResponse } from "next/server"
import { authenticateUser, createSession } from "@/lib/auth"
import { AUTH_COOKIE_NAME } from "@/lib/session-cookie"
import { isSecureRequest } from "@/lib/request-security"
import { getClientIp, hitRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request)
    const ipLimit = await hitRateLimit("auth:sign-in:ip", ip, 30, 10 * 60)
    if (!ipLimit.ok) {
      return NextResponse.json(
        { error: "登录请求过于频繁，请稍后再试" },
        { status: 429 },
      )
    }

    const body = await request.json()
    const email = typeof body?.email === "string" ? body.email : ""
    const password = typeof body?.password === "string" ? body.password : ""

    if (!email || !password) {
      return NextResponse.json({ error: "请输入邮箱和密码" }, { status: 400 })
    }

    const emailLimit = await hitRateLimit("auth:sign-in:email", email.trim().toLowerCase(), 10, 10 * 60)
    if (!emailLimit.ok) {
      return NextResponse.json(
        { error: "该账号登录尝试过于频繁，请稍后再试" },
        { status: 429 },
      )
    }

    const user = await authenticateUser(email, password)
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
      { status: 400 }
    )
  }
}
