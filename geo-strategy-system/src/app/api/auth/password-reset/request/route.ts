import { NextResponse } from "next/server"
import { createPasswordResetRequest } from "@/lib/auth"
import { getClientIp, hitRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const generic = {
    ok: true,
    message: "如果该邮箱已注册，系统已提交密码重置申请。请联系管理员获取一次性重置链接。",
  }

  try {
    const ip = getClientIp(request)
    const ipLimit = await hitRateLimit("auth:password-reset:ip", ip, 10, 60 * 60)
    if (!ipLimit.ok) {
      return NextResponse.json(
        { error: "密码重置请求过于频繁，请稍后再试" },
        { status: 429 },
      )
    }

    const body = await request.json().catch(() => null)
    const email = typeof body?.email === "string" ? body.email : ""
    if (!email) return NextResponse.json({ error: "请输入注册邮箱" }, { status: 400 })

    const emailLimit = await hitRateLimit(
      "auth:password-reset:email",
      email.trim().toLowerCase(),
      3,
      60 * 60,
    )
    if (!emailLimit.ok) return NextResponse.json(generic)

    await createPasswordResetRequest(email)
    return NextResponse.json(generic)
  } catch {
    return NextResponse.json(generic)
  }
}
