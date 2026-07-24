import QRCode from "qrcode"
import { NextRequest, NextResponse } from "next/server"
import { createAlipayCheckoutUrl } from "@/lib/alipay-payment"
import { getCurrentUser } from "@/lib/auth"
import { getManagedServicePlan } from "@/lib/managed-service-plans"
import {
  createManagedServiceOrder,
  linkManagedServicePayment,
  markManagedServiceCheckoutFailed,
  resolveManagedServiceOwnerUserId,
} from "@/lib/managed-services"
import {
  deliverManagedServiceAdminEmail,
  queueManagedServiceAdminNotification,
} from "@/lib/managed-service-notifications"
import {
  alipayFeatureEnabled,
  wechatH5FeatureEnabled,
  wechatNativeFeatureEnabled,
} from "@/lib/payment-config"
import { createPaymentOrder, failPaymentOrder } from "@/lib/payment-orders"
import { ONLINE_PAYMENT_ORDER_TTL_MS } from "@/lib/payment-lifecycle"
import { getClientIp, hitRateLimit } from "@/lib/rate-limit"
import {
  createWechatH5Order,
  createWechatNativeOrder,
  type WechatPaymentChannel,
} from "@/lib/wechat-payment"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type CheckoutProvider = "wechat" | "alipay" | "manual_transfer"

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "登录状态已失效" }, { status: 401 })
  const limited = await hitRateLimit("managed_service_checkout", `${user.id}:${getClientIp(request)}`, 8, 60)
  if (!limited.ok) return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 })

  let body: {
    planKey?: string
    provider?: string
    channel?: string
    payerName?: string
    paymentReference?: string
    contact?: string
    note?: string
  }
  try {
    body = await request.json() as typeof body
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 })
  }
  const plan = getManagedServicePlan(String(body.planKey || ""))
  if (!plan) return NextResponse.json({ error: "请选择有效的代运营套餐" }, { status: 400 })
  const provider: CheckoutProvider = body.provider === "alipay"
    ? "alipay"
    : body.provider === "manual_transfer"
      ? "manual_transfer"
      : "wechat"

  if (provider === "alipay" && !alipayFeatureEnabled()) {
    return NextResponse.json({ error: "支付宝支付暂不可用，请选择微信或银行转账" }, { status: 503 })
  }
  const wechatChannel: WechatPaymentChannel = body.channel === "h5" ? "h5" : "native"
  if (provider === "wechat" && wechatChannel === "native" && !wechatNativeFeatureEnabled()) {
    return NextResponse.json({ error: "微信扫码支付暂不可用，请选择其他付款方式" }, { status: 503 })
  }
  if (provider === "wechat" && wechatChannel === "h5" && !wechatH5FeatureEnabled()) {
    return NextResponse.json({ error: "微信 H5 支付暂不可用，请使用扫码支付" }, { status: 503 })
  }

  let paymentOrderId = ""
  let serviceOrderId = ""
  try {
    const ownerUserId = await resolveManagedServiceOwnerUserId()
    const serviceOrder = await createManagedServiceOrder({
      userId: user.id,
      username: user.name,
      email: user.email,
      ownerUserId,
      plan,
      provider,
    })
    serviceOrderId = serviceOrder.id
    const paymentOrder = await createPaymentOrder({
      userId: user.id,
      username: user.name,
      email: user.email,
      productType: "managed_service",
      managedServiceOrderId: serviceOrder.id,
      packageName: `专业 GEO 全链路运营 · ${plan.name}`,
      priceCents: plan.priceCents,
      credits: 0,
      provider,
      payerName: body.payerName,
      paymentReference: body.paymentReference,
      contact: body.contact,
      note: body.note,
    })
    paymentOrderId = paymentOrder.id
    const linkedOrder = await linkManagedServicePayment(serviceOrder.id, paymentOrder)

    if (provider === "manual_transfer") {
      const notification = await queueManagedServiceAdminNotification(linkedOrder, "manual_payment_review")
      void deliverManagedServiceAdminEmail(notification)
      return NextResponse.json({
        serviceOrderId: serviceOrder.id,
        orderId: paymentOrder.id,
        outTradeNo: paymentOrder.outTradeNo,
        provider,
        status: "pending",
      }, { headers: { "Cache-Control": "private, no-store" } })
    }
    if (provider === "alipay") {
      const channel = body.channel === "wap" ? "wap" : "page"
      return NextResponse.json({
        serviceOrderId: serviceOrder.id,
        orderId: paymentOrder.id,
        outTradeNo: paymentOrder.outTradeNo,
        provider,
        paymentUrl: createAlipayCheckoutUrl(paymentOrder, channel),
        expiresAt: paymentOrder.createdAt + ONLINE_PAYMENT_ORDER_TTL_MS,
      }, { headers: { "Cache-Control": "private, no-store" } })
    }
    if (wechatChannel === "h5") {
      const checkout = await createWechatH5Order({
        order: paymentOrder,
        clientIp: getClientIp(request),
        userAgent: request.headers.get("user-agent") || "",
      })
      return NextResponse.json({
        serviceOrderId: serviceOrder.id,
        orderId: paymentOrder.id,
        outTradeNo: paymentOrder.outTradeNo,
        provider,
        channel: wechatChannel,
        paymentUrl: checkout.h5Url,
        expiresAt: checkout.expiresAt,
      }, { headers: { "Cache-Control": "private, no-store" } })
    }
    const checkout = await createWechatNativeOrder(paymentOrder, getClientIp(request))
    const qrCodeDataUrl = await QRCode.toDataURL(checkout.codeUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 420,
      color: { dark: "#031A36", light: "#FFFFFF" },
    })
    return NextResponse.json({
      serviceOrderId: serviceOrder.id,
      orderId: paymentOrder.id,
      outTradeNo: paymentOrder.outTradeNo,
      provider,
      channel: wechatChannel,
      qrCodeDataUrl,
      expiresAt: checkout.expiresAt,
    }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    const message = error instanceof Error ? error.message : "代运营订单创建失败"
    if (paymentOrderId) await failPaymentOrder(paymentOrderId, message)
    if (serviceOrderId) await markManagedServiceCheckoutFailed(serviceOrderId, message)
    console.error("[managed-service] checkout failed", message)
    return NextResponse.json({ error: "订单创建失败，请稍后重试" }, { status: 502 })
  }
}
