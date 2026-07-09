import { NextRequest, NextResponse } from "next/server"
import { getPaymentOrder } from "@/lib/payment-orders"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ orderId: string }> },
) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response

  const { orderId } = await ctx.params
  const order = await getPaymentOrder(orderId)
  if (!order || order.userId !== userGuard.userId) {
    return NextResponse.json({ error: "支付订单不存在" }, { status: 404 })
  }

  return NextResponse.json({
    id: order.id,
    outTradeNo: order.outTradeNo,
    packageName: order.packageName,
    priceCents: order.priceCents,
    credits: order.credits,
    provider: order.provider,
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    paidAt: order.paidAt,
    creditedAt: order.creditedAt,
    canceledAt: order.canceledAt,
    failureReason: order.failureReason,
  })
}
