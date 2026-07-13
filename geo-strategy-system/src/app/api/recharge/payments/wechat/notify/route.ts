import { randomUUID } from "node:crypto"
import { NextRequest } from "next/server"
import { wechatPaymentConfig } from "@/lib/payment-config"
import { creditPaymentOrder, getPaymentOrderByOutTradeNo } from "@/lib/payment-orders"
import { savePaymentEvent } from "@/lib/payment-store"
import type { PaymentEvent } from "@/lib/payment-types"
import {
  assertWechatSignedPayload,
  assertWechatTransactionIdentity,
  decryptWechatResource,
  parseWechatNotification,
  parseWechatTransaction,
  sanitizeWechatTransaction,
  type WechatNotificationEnvelope,
  type WechatTransaction,
} from "@/lib/wechat-payment"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function successResponse(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } })
}

function failureResponse(message: string): Response {
  return Response.json(
    { code: "FAIL", message: message.slice(0, 256) },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  )
}

function paymentEvent(input: {
  envelope: WechatNotificationEnvelope
  transaction?: WechatTransaction
  status: PaymentEvent["status"]
  error?: string
}): PaymentEvent {
  return {
    id: `pevt_${randomUUID().replace(/-/g, "")}`,
    provider: "wechat",
    providerEventId: input.envelope.id.slice(0, 240),
    eventType: input.envelope.event_type || "unknown",
    status: input.status,
    signatureVerified: true,
    outTradeNo: input.transaction?.out_trade_no,
    providerTradeId: input.transaction?.transaction_id,
    payload: {
      eventId: input.envelope.id,
      eventType: input.envelope.event_type,
      createTime: input.envelope.create_time,
      resourceType: input.envelope.resource_type,
      summary: input.envelope.summary,
      transaction: input.transaction ? sanitizeWechatTransaction(input.transaction) : undefined,
    },
    error: input.error?.slice(0, 500),
    receivedAt: Date.now(),
    processedAt: input.status === "received" ? undefined : Date.now(),
  }
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0)
  if (Number.isFinite(contentLength) && contentLength > 128 * 1024) {
    return failureResponse("微信支付回调报文过大")
  }
  const rawBody = await request.text()
  if (Buffer.byteLength(rawBody, "utf8") > 128 * 1024) {
    return failureResponse("微信支付回调报文过大")
  }
  const config = wechatPaymentConfig()
  let envelope: WechatNotificationEnvelope | undefined
  let transaction: WechatTransaction | undefined

  try {
    assertWechatSignedPayload({
      headers: request.headers,
      body: rawBody,
      publicKey: config.wechatPayPublicKey,
      publicKeyId: config.wechatPayPublicKeyId,
      enforceFreshTimestamp: true,
    })
    envelope = parseWechatNotification(rawBody)
    transaction = parseWechatTransaction(decryptWechatResource(envelope.resource, config.apiV3Key))
    await savePaymentEvent(paymentEvent({ envelope, transaction, status: "received" }))

    if (envelope.event_type !== "TRANSACTION.SUCCESS" || transaction.trade_state !== "SUCCESS") {
      await savePaymentEvent(paymentEvent({ envelope, transaction, status: "ignored" }))
      return successResponse()
    }
    if (!transaction.out_trade_no || !transaction.transaction_id) {
      throw new Error("微信支付回调缺少订单号")
    }

    const order = await getPaymentOrderByOutTradeNo(transaction.out_trade_no)
    if (!order || order.provider !== "wechat") throw new Error("微信支付回调订单不存在")
    assertWechatTransactionIdentity(transaction, order, config)

    const result = await creditPaymentOrder({
      orderId: order.id,
      providerTradeId: transaction.transaction_id,
      paidCents: transaction.amount?.total,
      paidAt: transaction.success_time ? Date.parse(transaction.success_time) : undefined,
      source: "payment_callback",
    })
    if (!result.ok) throw new Error(result.reason)

    await savePaymentEvent(paymentEvent({ envelope, transaction, status: "processed" }))
    return successResponse()
  } catch (error) {
    const message = error instanceof Error ? error.message : "微信支付回调处理失败"
    console.error("[wechat] notification failed", transaction?.out_trade_no || envelope?.id || "unknown", message)
    if (envelope) {
      await savePaymentEvent(paymentEvent({ envelope, transaction, status: "failed", error: message }))
    }
    return failureResponse(message)
  }
}
