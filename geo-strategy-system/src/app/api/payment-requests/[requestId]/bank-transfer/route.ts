import { after, NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { submitAdminPaymentBankTransfer } from "@/lib/admin-payment-requests"
import { deliverRechargeAdminEmail } from "@/lib/recharge-notification-email"
import { getClientIp, hitRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ requestId: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "登录状态已失效" }, { status: 401 })
  const { requestId } = await context.params
  const limited = await hitRateLimit(
    "admin_payment_bank_transfer",
    `${user.id}:${requestId}:${getClientIp(request)}`,
    8,
    60,
  )
  if (!limited.ok) {
    return NextResponse.json({ error: "提交过于频繁，请稍后再试" }, { status: 429 })
  }
  let body: { payerName?: string; paymentReference?: string; contact?: string }
  try {
    body = await request.json() as typeof body
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 })
  }
  try {
    const result = await submitAdminPaymentBankTransfer({
      requestId,
      userId: user.id,
      payerName: String(body.payerName || ""),
      paymentReference: String(body.paymentReference || ""),
      contact: String(body.contact || ""),
    })
    after(() => deliverRechargeAdminEmail(result.review).catch(error => {
      console.error("[admin-payment-request] bank review email failed", requestId, error)
    }))
    return NextResponse.json({
      request: result.request,
      message: "转账信息已提交，管理员核对后积分将自动到账",
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "转账信息提交失败",
    }, { status: 400 })
  }
}
