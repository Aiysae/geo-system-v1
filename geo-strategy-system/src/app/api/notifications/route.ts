import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import {
  getUserNotificationSnapshot,
  markNotificationsRead,
} from "@/lib/user-notifications"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "登录状态已失效" }, { status: 401 })
  const snapshot = await getUserNotificationSnapshot(user.id)
  return NextResponse.json(snapshot, {
    headers: { "Cache-Control": "private, no-store" },
  })
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "登录状态已失效" }, { status: 401 })
  let body: { ids?: string[]; all?: boolean }
  try {
    body = await request.json() as { ids?: string[]; all?: boolean }
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 })
  }
  const snapshot = await getUserNotificationSnapshot(user.id, 100)
  const ids = body.all
    ? snapshot.notifications.filter(item => !item.readAt).map(item => item.id)
    : Array.isArray(body.ids) ? body.ids : []
  await markNotificationsRead(user.id, ids)
  return NextResponse.json({ ok: true })
}
