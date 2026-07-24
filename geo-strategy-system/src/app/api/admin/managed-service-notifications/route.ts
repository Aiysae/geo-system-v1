import { after, NextRequest, NextResponse } from "next/server"
import { isAdminUser } from "@/lib/admin"
import { getCurrentUser } from "@/lib/auth"
import {
  getManagedServiceNotificationSnapshot,
  markManagedServiceNotificationsSeen,
  retryManagedServiceNotificationEmails,
} from "@/lib/managed-service-notifications"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function requireAdmin() {
  const user = await getCurrentUser()
  if (!user) return { response: NextResponse.json({ error: "未登录" }, { status: 401 }) }
  if (!isAdminUser(user)) return { response: NextResponse.json({ error: "无管理员权限" }, { status: 403 }) }
  return { user }
}

export async function GET() {
  const auth = await requireAdmin()
  if ("response" in auth) return auth.response
  const snapshot = await getManagedServiceNotificationSnapshot(auth.user.id)
  after(() => retryManagedServiceNotificationEmails())
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if ("response" in auth) return auth.response
  const body = await request.json().catch(() => ({})) as { eventIds?: unknown }
  const eventIds = Array.isArray(body.eventIds) ? body.eventIds.map(String) : []
  await markManagedServiceNotificationsSeen(auth.user.id, eventIds)
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } })
}
