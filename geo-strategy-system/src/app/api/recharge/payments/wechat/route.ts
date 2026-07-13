import QRCode from "qrcode"
import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import {
  wechatH5FeatureEnabled,
  wechatNativeFeatureEnabled,
} from "@/lib/payment-config"
import {
  createPaymentOrder,
  failPaymentOrder,
  listPaymentOrdersForUser,
} from "@/lib/payment-orders"
import { getRechargePackage } from "@/lib/pricing"
import { getClientIp, hitRateLimit } from "@/lib/rate-limit"
import {
  createWechatH5Order,
  createWechatNativeOrder,
  type WechatPaymentChannel,
} from "@/lib/wechat-payment"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "登录状态已失效" }, { status: 401 })

  const limited = await hitRateLimit("wechat_checkout", `${user.id}:${getClientIp(request)}`, 10, 60)
  if (!limited.ok) return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 })

  let body: { packageKey?: string; channel?: string }
  try {
    body = await request.json() as { packageKey?: string; channel?: string }
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 })
  }

  const channel: WechatPaymentChannel = body.channel === "h5" ? "h5" : "native"
  if (channel === "native" && !wechatNativeFeatureEnabled()) {
    return NextResponse.json({ error: "微信扫码支付正在配置中，请先使用人工转账" }, { status: 503 })
  }
  if (channel === "h5" && !wechatH5FeatureEnabled()) {
    return NextResponse.json({ error: "微信 H5 支付正在审核中，请使用扫码支付" }, { status: 503 })
  }

  const pkg = getRechargePackage(String(body.packageKey || ""))
  if (!pkg) return NextResponse.json({ error: "请选择有效的充值套餐" }, { status: 400 })

  if ("firstPurchaseOnly" in pkg && pkg.firstPurchaseOnly) {
    const orders = await listPaymentOrdersForUser(user.id, 500)
    const used = orders.some(order => (
      order.packageKey === pkg.key
      && !["canceled", "failed", "refunded"].includes(order.status)
    ))
    if (used) {
      return NextResponse.json({ error: "首购体验包每个账号仅限购买一次" }, { status: 409 })
    }
  }

  const order = await createPaymentOrder({
    userId: user.id,
    username: user.name,
    email: user.email,
    packageKey: pkg.key,
    packageName: pkg.name,
    priceCents: pkg.priceCents,
    credits: pkg.credits,
    provider: "wechat",
  })

  try {
    if (channel === "h5") {
      const checkout = await createWechatH5Order({
        order,
        clientIp: getClientIp(request),
        userAgent: request.headers.get("user-agent") || "",
      })
      return NextResponse.json({
        orderId: order.id,
        outTradeNo: order.outTradeNo,
        channel,
        paymentUrl: checkout.h5Url,
        expiresAt: checkout.expiresAt,
      }, { headers: { "Cache-Control": "private, no-store" } })
    }

    const checkout = await createWechatNativeOrder(order, getClientIp(request))
    const qrCodeDataUrl = await QRCode.toDataURL(checkout.codeUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 420,
      color: { dark: "#031A36", light: "#FFFFFF" },
    })
    return NextResponse.json({
      orderId: order.id,
      outTradeNo: order.outTradeNo,
      channel,
      qrCodeDataUrl,
      expiresAt: checkout.expiresAt,
    }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    const message = error instanceof Error ? error.message : "微信支付下单失败"
    await failPaymentOrder(order.id, message)
    console.error("[wechat] checkout creation failed", order.id, message)
    return NextResponse.json({ error: "微信支付下单失败，请稍后重试" }, { status: 502 })
  }
}
