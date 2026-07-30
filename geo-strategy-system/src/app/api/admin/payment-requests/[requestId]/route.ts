import { after, NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { assertAdmin } from "@/lib/admin"
import { deliverAdminPaymentRequestEmail } from "@/lib/admin-payment-request-email"
import {
  cancelAdminPaymentRequest,
  getAdminPaymentRequest,
} from "@/lib/admin-payment-requests"
import { approveRequest } from "@/lib/recharge"
import { notifyPaymentRequestReminder } from "@/lib/user-notifications"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ requestId: string }> },
) {
  let adminUserId: string
  try {
    adminUserId = await assertAdmin()
  } catch {
    return NextResponse.json({ error: "无权限" }, { status: 403 })
  }
  const { requestId } = await context.params
  let body: { action?: string; reason?: string }
  try {
    body = await request.json() as { action?: string; reason?: string }
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 })
  }

  try {
    if (body.action === "cancel") {
      const record = await cancelAdminPaymentRequest({
        requestId,
        adminUserId,
        reason: body.reason,
      })
      revalidateAffectedPages(record.userId)
      return NextResponse.json({ request: record, message: "付款订单已取消" })
    }

    const record = await getAdminPaymentRequest(requestId)
    if (!record) return NextResponse.json({ error: "付款订单不存在" }, { status: 404 })

    if (body.action === "resend") {
      if (record.status !== "pending") {
        return NextResponse.json({ error: "只有待付款订单可以重发提醒" }, { status: 409 })
      }
      await notifyPaymentRequestReminder(record)
      after(() => deliverAdminPaymentRequestEmail(record.id, { force: true }).catch(error => {
        console.error("[admin-payment-request] reminder email failed", record.id, error)
      }))
      return NextResponse.json({ message: "站内提醒已发送，邮件正在投递" })
    }

    if (body.action === "credit") {
      if (
        record.selectedProvider !== "manual_transfer"
        || !record.transferSubmittedAt
      ) {
        return NextResponse.json({ error: "用户尚未提交银行转账信息" }, { status: 409 })
      }
      const result = await approveRequest(`req_payreq_${record.id}`, adminUserId)
      if (!result.ok) {
        return NextResponse.json({ error: result.reason }, { status: 409 })
      }
      revalidateAffectedPages(record.userId)
      return NextResponse.json({
        message: `已确认到账，${result.record.credits ?? result.record.amount} 积分已发放`,
        balance: result.balance,
      })
    }

    return NextResponse.json({ error: "不支持的操作" }, { status: 400 })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "操作失败",
    }, { status: 400 })
  }
}

function revalidateAffectedPages(userId: string): void {
  revalidatePath("/admin/recharge")
  revalidatePath("/billing")
  revalidatePath("/account")
  revalidatePath(`/admin/users/${userId}`)
}
