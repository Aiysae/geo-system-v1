import { NextResponse } from "next/server"
import { getCurrentUser, updateUserProfileName } from "@/lib/auth"
import { getClientIp, hitRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "用户未登录" }, { status: 401 })
  const limit = await hitRateLimit("account:profile", `${user.id}:${getClientIp(request)}`, 20, 60 * 60)
  if (!limit.ok) return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 })

  try {
    const body = await request.json()
    const updated = await updateUserProfileName(user.id, String(body?.name || ""))
    return NextResponse.json({ user: updated })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "账号名称修改失败" },
      { status: 400 },
    )
  }
}
