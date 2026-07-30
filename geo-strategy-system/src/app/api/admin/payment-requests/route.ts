import { after, NextRequest, NextResponse } from "next/server"
import { assertAdmin } from "@/lib/admin"
import { deliverAdminPaymentRequestEmail } from "@/lib/admin-payment-request-email"
import {
  createAdminPaymentRequest,
  findPaymentRequestTarget,
} from "@/lib/admin-payment-requests"
import { getClientIp, hitRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RequestBody = {
  action?: "preview" | "create"
  targetAccount?: string
  title?: string
  note?: string
  amountYuan?: number | string
  credits?: number | string
  expiryDays?: number | string
  idempotencyKey?: string
}

export async function POST(request: NextRequest) {
  let adminUserId: string
  try {
    adminUserId = await assertAdmin()
  } catch {
    return NextResponse.json({ error: "无权限" }, { status: 403 })
  }
  const limited = await hitRateLimit(
    "admin_payment_request",
    `${adminUserId}:${getClientIp(request)}`,
    30,
    60,
  )
  if (!limited.ok) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 })
  }

  let body: RequestBody
  try {
    body = await request.json() as RequestBody
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 })
  }

  try {
    const target = await findPaymentRequestTarget(String(body.targetAccount || ""))
    if (body.action === "preview") {
      return NextResponse.json({
        target: {
          id: target.id,
          name: target.name,
          email: target.email,
          status: target.status,
        },
      })
    }

    const amountYuan = Number(body.amountYuan)
    const requestRecord = await createAdminPaymentRequest({
      targetAccount: target.id,
      title: body.title,
      note: body.note,
      priceCents: Math.round(amountYuan * 100),
      credits: Number(body.credits),
      expiryDays: Number(body.expiryDays || 7),
      createdBy: adminUserId,
      idempotencyKey: String(body.idempotencyKey || ""),
    })
    after(() => deliverAdminPaymentRequestEmail(requestRecord.id).catch(error => {
      console.error("[admin-payment-request] initial email delivery failed", requestRecord.id, error)
    }))
    return NextResponse.json({
      request: publicRequest(requestRecord),
      target: {
        id: target.id,
        name: target.name,
        email: target.email,
      },
    }, { status: 201 })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "付款订单发送失败",
    }, { status: 400 })
  }
}

function publicRequest(record: Awaited<ReturnType<typeof createAdminPaymentRequest>>) {
  return {
    id: record.id,
    userId: record.userId,
    username: record.username,
    email: record.email,
    title: record.title,
    priceCents: record.priceCents,
    credits: record.credits,
    status: record.status,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    emailStatus: record.emailStatus,
  }
}
