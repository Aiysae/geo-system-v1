import { NextResponse } from "next/server"
import { changeUserEmail, createSession, getCurrentUser } from "@/lib/auth"
import { AUTH_COOKIE_NAME } from "@/lib/session-cookie"
import { isSecureRequest } from "@/lib/request-security"
import { getClientIp, hitRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "用户未登录" }, { status: 401 })
  const limit = await hitRateLimit("account:email-change", `${user.id}:${getClientIp(request)}`, 8, 60 * 60)
  if (!limit.ok) return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 })

  try {
    const body = await request.json()
    const updated = await changeUserEmail({
      userId: user.id,
      currentPassword: String(body?.currentPassword || ""),
      newEmail: String(body?.newEmail || ""),
      verificationCode: String(body?.verificationCode || ""),
    })
    const session = await createSession(user.id)
    const response = NextResponse.json({ user: updated })
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
      { error: error instanceof Error ? error.message : "登录邮箱修改失败" },
      { status: 400 },
    )
  }
}
