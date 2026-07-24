import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { isAdminUser } from "@/lib/admin"
import {
  canAccessManagedServiceOrder,
  getManagedServiceOrder,
  submitManagedServiceIntake,
} from "@/lib/managed-services"
import { getClientIp, hitRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ orderId: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "登录状态已失效" }, { status: 401 })
  const { orderId } = await context.params
  const order = await getManagedServiceOrder(orderId)
  if (!order || (!canAccessManagedServiceOrder(order, user.id) && !isAdminUser(user))) {
    return NextResponse.json({ error: "代运营订单不存在" }, { status: 404 })
  }
  const limited = await hitRateLimit("managed_service_intake", `${user.id}:${getClientIp(request)}`, 20, 60)
  if (!limited.ok) return NextResponse.json({ error: "提交过于频繁，请稍后再试" }, { status: 429 })
  try {
    const body = await request.json()
    const updated = await submitManagedServiceIntake(order.id, body)
    return NextResponse.json({ ok: true, order: updated })
  } catch (error) {
    const message = error instanceof Error ? error.message : "资料提交失败"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
