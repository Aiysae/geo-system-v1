import QRCode from "qrcode"
import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import {
  prepareAdminPaymentRequestOrder,
  saveAdminPaymentCheckout,
} from "@/lib/admin-payment-requests"
import { createAlipayCheckoutUrl } from "@/lib/alipay-payment"
import {
  alipayFeatureEnabled,
  wechatH5FeatureEnabled,
  wechatNativeFeatureEnabled,
} from "@/lib/payment-config"
import type { PaymentProvider } from "@/lib/payment-types"
import { getClientIp, hitRateLimit } from "@/lib/rate-limit"
import {
  createWechatH5Order,
  createWechatNativeOrder,
} from "@/lib/wechat-payment"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type CheckoutBody = {
  provider?: PaymentProvider
  channel?: string
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ requestId: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "登录状态已失效" }, { status: 401 })
  const { requestId } = await context.params
  const limited = await hitRateLimit(
    "admin_payment_checkout",
    `${user.id}:${requestId}:${getClientIp(request)}`,
    15,
    60,
  )
  if (!limited.ok) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 })
  }

  let body: CheckoutBody
  try {
    body = await request.json() as CheckoutBody
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 })
  }
  const provider = body.provider
  if (provider !== "wechat" && provider !== "alipay" && provider !== "manual_transfer") {
    return NextResponse.json({ error: "请选择有效的付款方式" }, { status: 400 })
  }
  if (provider === "wechat" && !wechatNativeFeatureEnabled() && !wechatH5FeatureEnabled()) {
    return NextResponse.json({ error: "微信支付暂不可用，请选择其他付款方式" }, { status: 503 })
  }
  if (provider === "alipay" && !alipayFeatureEnabled()) {
    return NextResponse.json({ error: "支付宝暂不可用，请选择其他付款方式" }, { status: 503 })
  }

  try {
    const prepared = await prepareAdminPaymentRequestOrder({
      requestId,
      userId: user.id,
      provider,
    })
    if (provider === "manual_transfer") {
      return NextResponse.json({
        requestId,
        orderId: prepared.order.id,
        provider,
        status: prepared.order.status,
      })
    }

    const cached = cachedCheckoutResponse(prepared.request, prepared.order.id)
    if (cached) {
      return NextResponse.json(await renderCheckoutResponse(cached), {
        headers: { "Cache-Control": "private, no-store" },
      })
    }

    if (provider === "alipay") {
      const mobile = body.channel === "wap"
        || /Android|iPhone|iPad|iPod|Mobile/i.test(request.headers.get("user-agent") || "")
      const channel = mobile ? "wap" : "page"
      const paymentUrl = createAlipayCheckoutUrl(prepared.order, channel)
      const expiresAt = prepared.order.createdAt + 15 * 60 * 1000
      await saveAdminPaymentCheckout({
        requestId,
        orderId: prepared.order.id,
        kind: channel === "wap" ? "alipay_wap" : "alipay_page",
        url: paymentUrl,
        expiresAt,
      })
      return NextResponse.json({
        requestId,
        orderId: prepared.order.id,
        provider,
        paymentUrl,
        expiresAt,
      }, { headers: { "Cache-Control": "private, no-store" } })
    }

    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(request.headers.get("user-agent") || "")
    const useH5 = body.channel === "h5"
      || (mobile && wechatH5FeatureEnabled())
    if (useH5 && wechatH5FeatureEnabled()) {
      const checkout = await createWechatH5Order({
        order: prepared.order,
        clientIp: getClientIp(request),
        userAgent: request.headers.get("user-agent") || "",
      })
      await saveAdminPaymentCheckout({
        requestId,
        orderId: prepared.order.id,
        kind: "wechat_h5",
        url: checkout.h5Url,
        expiresAt: checkout.expiresAt,
      })
      return NextResponse.json({
        requestId,
        orderId: prepared.order.id,
        provider,
        paymentUrl: checkout.h5Url,
        expiresAt: checkout.expiresAt,
      }, { headers: { "Cache-Control": "private, no-store" } })
    }

    const checkout = await createWechatNativeOrder(prepared.order, getClientIp(request))
    await saveAdminPaymentCheckout({
      requestId,
      orderId: prepared.order.id,
      kind: "wechat_native",
      url: checkout.codeUrl,
      expiresAt: checkout.expiresAt,
    })
    return NextResponse.json({
      requestId,
      orderId: prepared.order.id,
      provider,
      qrCodeDataUrl: await qrCode(checkout.codeUrl),
      expiresAt: checkout.expiresAt,
    }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    const message = error instanceof Error ? error.message : "支付下单失败"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

function cachedCheckoutResponse(
  request: Awaited<ReturnType<typeof prepareAdminPaymentRequestOrder>>["request"],
  orderId: string,
) {
  if (
    request.activePaymentOrderId === orderId
    && request.checkoutKind
    && request.checkoutUrl
    && request.checkoutExpiresAt
    && request.checkoutExpiresAt > Date.now()
  ) {
    return {
      requestId: request.id,
      orderId,
      provider: request.selectedProvider,
      kind: request.checkoutKind,
      url: request.checkoutUrl,
      expiresAt: request.checkoutExpiresAt,
    }
  }
  return null
}

async function renderCheckoutResponse(checkout: NonNullable<ReturnType<typeof cachedCheckoutResponse>>) {
  if (checkout.kind === "wechat_native") {
    return {
      requestId: checkout.requestId,
      orderId: checkout.orderId,
      provider: checkout.provider,
      qrCodeDataUrl: await qrCode(checkout.url),
      expiresAt: checkout.expiresAt,
    }
  }
  return {
    requestId: checkout.requestId,
    orderId: checkout.orderId,
    provider: checkout.provider,
    paymentUrl: checkout.url,
    expiresAt: checkout.expiresAt,
  }
}

async function qrCode(value: string): Promise<string> {
  return await QRCode.toDataURL(value, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 420,
    color: { dark: "#031A36", light: "#FFFFFF" },
  })
}
