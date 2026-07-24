import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { centsFromYuan, queryAlipayTrade } from "@/lib/alipay-payment"
import { creditPaymentOrder, getPaymentOrder } from "@/lib/payment-orders"
import { savePaymentEvent } from "@/lib/payment-store"
import { hitRateLimit } from "@/lib/rate-limit"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ orderId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  const { orderId } = await context.params
  const order = await getPaymentOrder(orderId)
  if (!order || order.userId !== auth.userId || order.provider !== "alipay") {
    return NextResponse.json({ error: "支付订单不存在" }, { status: 404 })
  }
  if (order.status === "credited") {
    if (order.productType === "managed_service") {
      await creditPaymentOrder({
        orderId: order.id,
        providerTradeId: order.providerTradeId,
        paidCents: order.paidCents || order.priceCents,
        source: "payment_callback",
      })
    }
    return NextResponse.json({ status: order.status, creditedAt: order.creditedAt })
  }

  const limited = await hitRateLimit("alipay_payment_sync", `${auth.userId}:${order.id}`, 30, 60)
  if (!limited.ok) return NextResponse.json({ error: "支付状态查询过于频繁" }, { status: 429 })

  try {
    const queried = await queryAlipayTrade(order.outTradeNo)
    const tradeStatus = String(queried.tradeStatus || queried.trade_status || "")
    const tradeNo = String(queried.tradeNo || queried.trade_no || "")
    if (tradeStatus !== "TRADE_SUCCESS" && tradeStatus !== "TRADE_FINISHED") {
      return NextResponse.json({ status: order.status, tradeStatus: tradeStatus || "WAIT_BUYER_PAY" })
    }
    const paidCents = centsFromYuan(queried.totalAmount || queried.total_amount)
    if (paidCents === null || !tradeNo) throw new Error("支付宝查询结果不完整")
    const result = await creditPaymentOrder({
      orderId: order.id,
      providerTradeId: tradeNo,
      paidCents,
      source: "payment_callback",
    })
    if (!result.ok) throw new Error(result.reason)
    await savePaymentEvent({
      id: `pevt_${randomUUID().replace(/-/g, "")}`,
      provider: "alipay",
      providerEventId: `query:${tradeNo}:${tradeStatus}`,
      eventType: `query:${tradeStatus}`,
      status: "processed",
      signatureVerified: true,
      outTradeNo: order.outTradeNo,
      providerTradeId: tradeNo,
      payload: { tradeStatus, totalAmount: String(queried.totalAmount || queried.total_amount || "") },
      receivedAt: Date.now(),
      processedAt: Date.now(),
    })
    return NextResponse.json({
      status: "credited",
      credited: result.credited,
      balance: result.credited ? result.balance : undefined,
      creditedAt: result.order.creditedAt,
    })
  } catch (error) {
    console.error("[alipay] trade sync failed", order.id, error)
    return NextResponse.json({ error: "支付宝支付状态查询失败，请稍后重试" }, { status: 502 })
  }
}
