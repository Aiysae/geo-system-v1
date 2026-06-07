import { NextResponse } from "next/server"
import { authenticateUser, createSession } from "@/lib/auth"
import { AUTH_COOKIE_NAME } from "@/lib/session-cookie"
import { isSecureRequest } from "@/lib/request-security"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const email = typeof body?.email === "string" ? body.email : ""
    const password = typeof body?.password === "string" ? body.password : ""

    if (!email || !password) {
      return NextResponse.json({ error: "请输入邮箱和密码" }, { status: 400 })
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
