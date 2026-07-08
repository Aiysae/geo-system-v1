import { NextResponse } from "next/server"
import { resetPasswordWithToken } from "@/lib/auth"
import { getClientIp, hitRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request)
    const ipLimit = await hitRateLimit("auth:password-reset-confirm:ip", ip, 20, 60 * 60)
    if (!ipLimit.ok) {
      return NextResponse.json(
        { error: "密码重置请求过于频繁，请稍后再试" },
        { status: 429 },
      )
    }

    const body = await request.json().catch(() => null)
    const token = typeof body?.token === "string" ? body.token : ""
    const password = typeof body?.password === "string" ? body.password : ""
    const confirmPassword = typeof body?.confirmPassword === "string" ? body.confirmPassword : ""

    if (!token) return NextResponse.json({ error: "重置链接无效或已过期" }, { status: 400 })
    if (!password || !confirmPassword) {
      return NextResponse.json({ error: "请输入新密码并确认" }, { status: 400 })
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ error: "两次输入的新密码不一致" }, { status: 400 })
    }

    await resetPasswordWithToken(token, password)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "密码重置失败" },
      { status: 400 },
    )
  }
}
