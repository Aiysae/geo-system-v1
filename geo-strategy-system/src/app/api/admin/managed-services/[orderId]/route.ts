import { NextRequest, NextResponse } from "next/server"
import { isAdminUser } from "@/lib/admin"
import { getCurrentUser } from "@/lib/auth"
import {
  fulfillManagedServicePaymentOrder,
  getManagedServiceOrder,
  updateManagedServiceStatus,
} from "@/lib/managed-services"
import { creditPaymentOrder, getPaymentOrder } from "@/lib/payment-orders"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ orderId: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 })
  if (!isAdminUser(user)) return NextResponse.json({ error: "无管理员权限" }, { status: 403 })
  const { orderId } = await context.params
  const serviceOrder = await getManagedServiceOrder(orderId)
  if (!serviceOrder) return NextResponse.json({ error: "代运营订单不存在" }, { status: 404 })
  const body = await request.json().catch(() => ({})) as {
    action?: string
    status?: string
    serviceStartsAt?: string
  }

  try {
    if (body.action === "confirm_payment") {
      if (!serviceOrder.paymentOrderId) throw new Error("支付订单不存在")
      const payment = await getPaymentOrder(serviceOrder.paymentOrderId)
      if (!payment || payment.provider !== "manual_transfer") throw new Error("仅银行转账订单可人工确认")
      const result = await creditPaymentOrder({
        orderId: payment.id,
        operatorUserId: user.id,
        paidCents: payment.priceCents,
        source: "manual_approval",
      })
      if (!result.ok) throw new Error(result.reason)
      return NextResponse.json({ ok: true, order: await getManagedServiceOrder(orderId) })
    }

    if (body.action === "retry_provisioning") {
      if (!serviceOrder.paymentOrderId) throw new Error("支付订单不存在")
      const payment = await getPaymentOrder(serviceOrder.paymentOrderId)
      if (!payment || payment.status !== "credited") throw new Error("订单尚未确认到账")
      const result = await fulfillManagedServicePaymentOrder(payment)
      if (!result.order) throw new Error("项目创建失败")
      return NextResponse.json({ ok: true, order: result.order })
    }

    if (body.action === "set_status") {
      const allowed = new Set(["active", "paused", "completed", "canceled"])
      if (!allowed.has(String(body.status || ""))) throw new Error("状态无效")
      const serviceStartsAt = body.serviceStartsAt ? Date.parse(body.serviceStartsAt) : undefined
      const updated = await updateManagedServiceStatus({
        orderId,
        status: body.status as "active" | "paused" | "completed" | "canceled",
        serviceStartsAt: Number.isFinite(serviceStartsAt) ? serviceStartsAt : undefined,
      })
      return NextResponse.json({ ok: true, order: updated })
    }
    return NextResponse.json({ error: "操作无效" }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
