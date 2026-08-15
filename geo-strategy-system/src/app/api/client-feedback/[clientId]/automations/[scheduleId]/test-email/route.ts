import { createHash } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { getClientFeedbackAutomationSchedule } from "@/lib/client-feedback/automation-store"
import { sendClientFeedbackAutomationEmail } from "@/lib/client-feedback/automation-email"
import { shanghaiDateOnly } from "@/lib/client-feedback/store"
import { requireOperationAccess, isOperationAccessError } from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"
import { hitRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ clientId: string; scheduleId: string }> }

export async function POST(request: NextRequest, context: Context) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId, scheduleId } = await context.params
    const body = await request.json() as Record<string, unknown>
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      teamId: typeof body.teamId === "string" ? body.teamId : undefined,
      module: "feedback",
      action: "manage",
    })
    const schedule = await getClientFeedbackAutomationSchedule(access.dataOwnerUserId, scheduleId)
    if (!schedule || schedule.clientId !== access.clientId) {
      return NextResponse.json({ error: "自动报送计划不存在" }, { status: 404 })
    }
    const email = String(body.email || "").trim().toLowerCase()
    if (!schedule.recipientEmails.includes(email)) throw new Error("请先保存该收件邮箱")
    const rateLimit = await hitRateLimit(
      "feedback-automation:test-email",
      `${auth.userId}:${scheduleId}`,
      5,
      60 * 60,
    )
    if (!rateLimit.ok) {
      return NextResponse.json({ error: "测试邮件发送过于频繁，请稍后再试" }, { status: 429 })
    }
    const date = shanghaiDateOnly()
    const params = new URLSearchParams({ clientId, module: "feedback" })
    await sendClientFeedbackAutomationEmail({
      to: email,
      schedule,
      test: true,
      messageId: `<feedback-test-${createHash("sha256").update(`${scheduleId}:${email}:${Date.now()}`).digest("hex").slice(0, 32)}@shitugeo.top>`,
      reports: [{
        type: "weekly",
        periodStart: date,
        periodEnd: date,
        label: "自动报送测试",
        sharePath: `/workspace?${params.toString()}`,
      }],
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "测试邮件发送失败" },
      { status: isOperationAccessError(error) ? 403 : 400 },
    )
  }
}
