import { createHash, randomUUID } from "node:crypto"
import { NextRequest } from "next/server"
import {
  assertAlipayNotificationIdentity,
  centsFromYuan,
  sanitizeAlipayEventPayload,
  verifyAlipayNotification,
} from "@/lib/alipay-payment"
import { creditPaymentOrder, getPaymentOrderByOutTradeNo } from "@/lib/payment-orders"
import { savePaymentEvent } from "@/lib/payment-store"
import type { PaymentEvent } from "@/lib/payment-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function response(text: "success" | "failure", status = 200): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  })
}

function eventId(params: Record<string, string>): string {
  if (params.notify_id) return params.notify_id.slice(0, 240)
  return createHash("sha256")
    .update(`${params.trade_no || ""}:${params.trade_status || ""}:${params.gmt_payment || ""}`)
    .digest("hex")
}

function paymentEvent(
  params: Record<string, string>,
  status: PaymentEvent["status"],
  signatureVerified: boolean,
  error?: string,
): PaymentEvent {
  return {
    id: `pevt_${randomUUID().replace(/-/g, "")}`,
    provider: "alipay",
    providerEventId: eventId(params),
    eventType: params.trade_status || params.notify_type || "unknown",
    status,
    signatureVerified,
    outTradeNo: params.out_trade_no,
    providerTradeId: params.trade_no,
    payload: sanitizeAlipayEventPayload(params),
    error: error?.slice(0, 500),
    receivedAt: Date.now(),
    processedAt: status === "received" ? undefined : Date.now(),
  }
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0)
  if (Number.isFinite(contentLength) && contentLength > 128 * 1024) {
    return response("failure", 413)
  }
  const formData = await request.formData()
  const params = Object.fromEntries(
    [...formData.entries()].flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : []),
  )
  const received = paymentEvent(params, "received", false)
  await savePaymentEvent(received)
  let signatureVerified = false

  try {
    if (!verifyAlipayNotification(params)) throw new Error("支付宝回调验签失败")
    signatureVerified = true
    assertAlipayNotificationIdentity(params)

    if (!params.out_trade_no || !params.trade_no) throw new Error("支付宝回调缺少订单号")
    if (params.trade_status !== "TRADE_SUCCESS" && params.trade_status !== "TRADE_FINISHED") {
      await savePaymentEvent(paymentEvent(params, "ignored", true))
      return response("success")
    }

    const order = await getPaymentOrderByOutTradeNo(params.out_trade_no)
    if (!order || order.provider !== "alipay") throw new Error("支付宝回调订单不存在")
    const paidCents = centsFromYuan(params.total_amount)
    if (paidCents === null) throw new Error("支付宝回调金额无效")

    const result = await creditPaymentOrder({
      orderId: order.id,
      providerTradeId: params.trade_no,
      paidCents,
      paidAt: params.gmt_payment ? Date.parse(params.gmt_payment.replace(" ", "T") + "+08:00") : undefined,
      source: "payment_callback",
    })
    if (!result.ok) throw new Error(result.reason)

    await savePaymentEvent(paymentEvent(params, "processed", true))
    return response("success")
  } catch (error) {
    const message = error instanceof Error ? error.message : "支付宝回调处理失败"
    console.error("[alipay] notification failed", params.out_trade_no || "unknown", message)
    await savePaymentEvent(paymentEvent(params, "failed", signatureVerified, message))
    return response("failure", 400)
  }
}
