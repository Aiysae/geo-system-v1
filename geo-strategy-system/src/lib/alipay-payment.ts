import "server-only"

import { AlipaySdk } from "alipay-sdk"
import { alipayPaymentConfig } from "@/lib/payment-config"
import type { PaymentOrder } from "@/lib/payment-types"

let cachedSdk: AlipaySdk | undefined
let cachedConfigKey = ""

function sdk(): AlipaySdk {
  const config = alipayPaymentConfig()
  const configKey = `${config.appId}:${config.keyType}:${config.gateway}`
  if (cachedSdk && cachedConfigKey === configKey) return cachedSdk
  cachedSdk = new AlipaySdk({
    appId: config.appId,
    privateKey: config.privateKey,
    alipayPublicKey: config.alipayPublicKey,
    keyType: config.keyType,
    gateway: config.gateway,
    signType: "RSA2",
    timeout: 8_000,
    camelcase: true,
  })
  cachedConfigKey = configKey
  return cachedSdk
}

export function yuanFromCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("支付金额无效")
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`
}

export function centsFromYuan(value: unknown): number | null {
  const text = String(value ?? "").trim()
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(text)
  if (!match) return null
  const yuan = Number(match[1])
  const fraction = String(match[2] || "").padEnd(2, "0")
  const cents = yuan * 100 + Number(fraction)
  return Number.isSafeInteger(cents) ? cents : null
}

export function createAlipayCheckoutUrl(
  order: PaymentOrder,
  channel: "page" | "wap",
): string {
  const config = alipayPaymentConfig()
  const method = channel === "wap" ? "alipay.trade.wap.pay" : "alipay.trade.page.pay"
  const productCode = channel === "wap" ? "QUICK_WAP_WAY" : "FAST_INSTANT_TRADE_PAY"
  const returnUrl = order.productType === "managed_service"
    ? `${publicManagedServiceReturnUrl()}?service_order_id=${encodeURIComponent(order.managedServiceOrderId || "")}&payment_return=alipay&order_id=${encodeURIComponent(order.id)}`
    : order.adminPaymentRequestId
      ? `${publicAdminPaymentRequestReturnUrl(order.adminPaymentRequestId)}?payment_return=alipay&order_id=${encodeURIComponent(order.id)}`
    : `${config.returnUrl}&order_id=${encodeURIComponent(order.id)}`
  return sdk().pageExecute(method, "GET", {
    notifyUrl: config.notifyUrl,
    returnUrl,
    bizContent: {
      outTradeNo: order.outTradeNo,
      productCode,
      subject: `势途 GEO ${order.packageName}`.slice(0, 128),
      body: order.productType === "managed_service"
        ? "专业 GEO 全链路运营服务"
        : `${order.credits} 积分充值`.slice(0, 128),
      totalAmount: yuanFromCents(order.priceCents),
      timeoutExpress: "15m",
    },
  })
}

function publicAdminPaymentRequestReturnUrl(requestId: string): string {
  const base = String(process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://shitugeo.top")
    .trim()
    .replace(/\/+$/, "")
  return `${base}/account/payment-requests/${encodeURIComponent(requestId)}`
}

function publicManagedServiceReturnUrl(): string {
  const base = String(process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://shitugeo.top")
    .trim()
    .replace(/\/+$/, "")
  return `${base}/account/services`
}

export function verifyAlipayNotification(params: Record<string, string>): boolean {
  return sdk().checkNotifySignV2(params)
}

export async function queryAlipayTrade(outTradeNo: string): Promise<Record<string, unknown>> {
  const result = await sdk().exec("alipay.trade.query", {
    bizContent: { outTradeNo },
  })
  return result as Record<string, unknown>
}

export function assertAlipayNotificationIdentity(params: Record<string, string>): void {
  const config = alipayPaymentConfig()
  if (params.app_id !== config.appId) throw new Error("支付宝回调应用不匹配")
  if (config.sellerId && params.seller_id !== config.sellerId) {
    throw new Error("支付宝回调收款账号不匹配")
  }
}

export function sanitizeAlipayEventPayload(params: Record<string, string>): Record<string, string> {
  const allowed = [
    "notify_id",
    "notify_time",
    "notify_type",
    "app_id",
    "seller_id",
    "out_trade_no",
    "trade_no",
    "trade_status",
    "total_amount",
    "receipt_amount",
    "buyer_pay_amount",
    "gmt_payment",
    "version",
    "sign_type",
  ]
  return Object.fromEntries(allowed.flatMap(key => params[key] ? [[key, params[key]]] : []))
}
