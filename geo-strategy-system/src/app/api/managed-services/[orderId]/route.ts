import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { isAdminUser } from "@/lib/admin"
import {
  canAccessManagedServiceOrder,
  getManagedServiceOrder,
} from "@/lib/managed-services"
import { getPaymentOrder } from "@/lib/payment-orders"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "登录状态已失效" }, { status: 401 })
  const { orderId } = await context.params
  const order = await getManagedServiceOrder(orderId)
  if (!order || (!canAccessManagedServiceOrder(order, user.id) && !isAdminUser(user))) {
    return NextResponse.json({ error: "代运营订单不存在" }, { status: 404 })
  }
  const paymentOrder = order.paymentOrderId ? await getPaymentOrder(order.paymentOrderId) : null
  return NextResponse.json({
    order,
    payment: paymentOrder ? {
      id: paymentOrder.id,
      outTradeNo: paymentOrder.outTradeNo,
      provider: paymentOrder.provider,
      status: paymentOrder.status,
      paidAt: paymentOrder.paidAt,
      creditedAt: paymentOrder.creditedAt,
    } : null,
  }, { headers: { "Cache-Control": "private, no-store" } })
}
