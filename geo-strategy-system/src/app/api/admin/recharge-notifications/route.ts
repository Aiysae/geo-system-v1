import { after, NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { isAdminUser } from "@/lib/admin"
import { listPending } from "@/lib/recharge"
import {
  getAdminRechargeNotificationSnapshot,
  markRechargeNotificationsSeen,
} from "@/lib/recharge-notifications"
import { deliverRechargeAdminEmail } from "@/lib/recharge-notification-email"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return response
}

async function requireAdmin() {
  const user = await getCurrentUser()
  if (!user) {
    return {
      response: noStore(NextResponse.json({ error: "未登录" }, { status: 401 })),
    }
  }
  if (!isAdminUser(user)) {
    return {
      response: noStore(NextResponse.json({ error: "无管理员权限" }, { status: 403 })),
    }
  }
  return { user }
}

export async function GET() {
  const auth = await requireAdmin()
  if ("response" in auth) return auth.response

  const snapshot = await getAdminRechargeNotificationSnapshot(auth.user.id)
  after(async () => {
    const pending = await listPending()
    await Promise.all(pending.slice(0, 20).map(deliverRechargeAdminEmail))
  })
  return noStore(NextResponse.json(snapshot))
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if ("response" in auth) return auth.response

  const body = await request.json().catch(() => ({})) as { requestIds?: unknown }
  const requestIds = Array.isArray(body.requestIds)
    ? body.requestIds.map(String)
    : []
  await markRechargeNotificationsSeen(auth.user.id, requestIds)
  return noStore(NextResponse.json({ ok: true }))
}
