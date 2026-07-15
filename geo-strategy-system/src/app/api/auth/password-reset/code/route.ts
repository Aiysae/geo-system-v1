import { NextResponse } from "next/server"
import { resetPasswordWithEmailCode } from "@/lib/auth"
import { getClientIp, hitRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const email = typeof body?.email === "string" ? body.email : ""
    const verificationCode = typeof body?.verificationCode === "string"
      ? body.verificationCode
      : ""
    const password = typeof body?.password === "string" ? body.password : ""
    const confirmPassword = typeof body?.confirmPassword === "string" ? body.confirmPassword : ""
    if (!email || !verificationCode || !password || !confirmPassword) {
      return NextResponse.json({ error: "请完整填写验证码和新密码" }, { status: 400 })
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ error: "两次输入的新密码不一致" }, { status: 400 })
    }

    const ip = getClientIp(request)
    const [ipLimit, emailLimit] = await Promise.all([
      hitRateLimit("auth:code-password-reset:ip", ip, 20, 60 * 60),
      hitRateLimit("auth:code-password-reset:email", email.trim().toLowerCase(), 10, 60 * 60),
    ])
    if (!ipLimit.ok || !emailLimit.ok) {
      return NextResponse.json(
        { error: "密码重置尝试过于频繁，请稍后重试" },
        { status: 429 },
      )
    }

    await resetPasswordWithEmailCode({
      email,
      code: verificationCode,
      newPassword: password,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "密码重置失败" },
      { status: 400 },
    )
  }
}
