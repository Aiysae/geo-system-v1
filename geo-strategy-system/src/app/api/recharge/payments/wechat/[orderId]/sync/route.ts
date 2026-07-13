import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { wechatPaymentConfig } from "@/lib/payment-config"
import { creditPaymentOrder, getPaymentOrder } from "@/lib/payment-orders"
import { savePaymentEvent } from "@/lib/payment-store"
import { hitRateLimit } from "@/lib/rate-limit"
import { requireUserId } from "@/lib/with-credits"
import {
  assertWechatTransactionIdentity,
  queryWechatOrder,
  sanitizeWechatTransaction,
} from "@/lib/wechat-payment"

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
  if (!order || order.userId !== auth.userId || order.provider !== "wechat") {
    return NextResponse.json({ error: "支付订单不存在" }, { status: 404 })
  }
  if (order.status === "credited") {
    return NextResponse.json({ status: order.status, creditedAt: order.creditedAt })
  }

  const limited = await hitRateLimit("wechat_payment_sync", `${auth.userId}:${order.id}`, 30, 60)
  if (!limited.ok) return NextResponse.json({ error: "支付状态查询过于频繁" }, { status: 429 })

  try {
    const transaction = await queryWechatOrder(order.outTradeNo)
    const tradeState = String(transaction.trade_state || "NOTPAY")
    if (tradeState !== "SUCCESS") {
      return NextResponse.json({
        status: order.status,
        tradeState,
        tradeStateDescription: transaction.trade_state_desc,
      })
    }

    const config = wechatPaymentConfig()
    assertWechatTransactionIdentity(transaction, order, config)
    if (!transaction.transaction_id) throw new Error("微信支付查询结果缺少交易号")
    const result = await creditPaymentOrder({
      orderId: order.id,
      providerTradeId: transaction.transaction_id,
      paidCents: transaction.amount?.total,
      paidAt: transaction.success_time ? Date.parse(transaction.success_time) : undefined,
      source: "payment_callback",
    })
    if (!result.ok) throw new Error(result.reason)

    await savePaymentEvent({
      id: `pevt_${randomUUID().replace(/-/g, "")}`,
      provider: "wechat",
      providerEventId: `query:${transaction.transaction_id}:${tradeState}`,
      eventType: `query:${tradeState}`,
      status: "processed",
      signatureVerified: true,
      outTradeNo: order.outTradeNo,
      providerTradeId: transaction.transaction_id,
      payload: sanitizeWechatTransaction(transaction),
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
    console.error("[wechat] trade sync failed", order.id, error)
    return NextResponse.json({ error: "微信支付状态查询失败，请稍后重试" }, { status: 502 })
  }
}
