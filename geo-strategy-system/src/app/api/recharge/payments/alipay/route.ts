import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { createAlipayCheckoutUrl } from "@/lib/alipay-payment"
import { alipayFeatureEnabled } from "@/lib/payment-config"
import {
  createPaymentOrder,
  failPaymentOrder,
  listPaymentOrdersForUser,
} from "@/lib/payment-orders"
import {
  hasBlockingFirstPurchaseOrder,
  ONLINE_PAYMENT_ORDER_TTL_MS,
} from "@/lib/payment-lifecycle"
import { getRechargePackage } from "@/lib/pricing"
import { getClientIp, hitRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "登录状态已失效" }, { status: 401 })
  if (!alipayFeatureEnabled()) {
    return NextResponse.json({ error: "支付宝支付正在配置中，请先使用人工转账" }, { status: 503 })
  }

  const limited = await hitRateLimit("alipay_checkout", `${user.id}:${getClientIp(request)}`, 10, 60)
  if (!limited.ok) return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 })

  let body: { packageKey?: string; channel?: string }
  try {
    body = await request.json() as { packageKey?: string; channel?: string }
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 })
  }
  const pkg = getRechargePackage(String(body.packageKey || ""))
  if (!pkg) return NextResponse.json({ error: "请选择有效的充值套餐" }, { status: 400 })

  if ("firstPurchaseOnly" in pkg && pkg.firstPurchaseOnly) {
    const orders = await listPaymentOrdersForUser(user.id, 500)
    if (hasBlockingFirstPurchaseOrder(orders, pkg.key)) {
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
    provider: "alipay",
  })

  try {
    const channel = body.channel === "wap" ? "wap" : "page"
    const paymentUrl = createAlipayCheckoutUrl(order, channel)
    return NextResponse.json({
      orderId: order.id,
      outTradeNo: order.outTradeNo,
      paymentUrl,
      expiresAt: order.createdAt + ONLINE_PAYMENT_ORDER_TTL_MS,
    }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    await failPaymentOrder(order.id, error instanceof Error ? error.message : "支付宝下单失败")
    console.error("[alipay] checkout creation failed", order.id, error)
    return NextResponse.json({ error: "支付宝下单失败，请稍后重试" }, { status: 502 })
  }
}
