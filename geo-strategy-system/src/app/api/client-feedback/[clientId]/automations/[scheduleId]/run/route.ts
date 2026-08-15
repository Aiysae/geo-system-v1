import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import {
  createClientFeedbackAutomationExecution,
  getClientFeedbackAutomationSchedule,
} from "@/lib/client-feedback/automation-store"
import { buildFeedbackAutomationPeriods } from "@/lib/client-feedback/automation-time"
import { enqueueClientFeedbackAutomationExecution } from "@/lib/client-feedback/automation-scheduler"
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
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
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
    const rateLimit = await hitRateLimit(
      "feedback-automation:manual-run",
      `${auth.userId}:${scheduleId}`,
      6,
      60 * 60,
    )
    if (!rateLimit.ok) {
      return NextResponse.json({ error: "立即报送操作过于频繁，请稍后再试" }, { status: 429 })
    }
    const today = shanghaiDateOnly()
    if (today < schedule.startDate) throw new Error("项目尚未到正式开始日期")
    const targetDate = today > schedule.endDate ? schedule.endDate : today
    const periods = (["weekly", "monthly"] as const).flatMap(type => {
      if (type === "weekly" && !schedule.weeklyEnabled) return []
      if (type === "monthly" && !schedule.monthlyEnabled) return []
      const source = buildFeedbackAutomationPeriods({ ...schedule, type })
        .find(period => period.start <= targetDate && period.end >= targetDate)
      if (!source) return []
      return [{
        ...source,
        end: targetDate,
        label: `当前${type === "weekly" ? "周" : "月"}进度`,
        dueAt: new Date().toISOString(),
        final: targetDate === schedule.endDate,
      }]
    })
    const execution = await createClientFeedbackAutomationExecution({
      schedule,
      periods,
      trigger: "manual",
      scheduledFor: new Date().toISOString(),
      idempotencyKey: typeof body.requestId === "string" && body.requestId.trim()
        ? body.requestId.trim().slice(0, 200)
        : randomUUID(),
    })
    await enqueueClientFeedbackAutomationExecution({
      ownerUserId: access.dataOwnerUserId,
      executionId: execution.id,
    }).catch(error => {
      console.warn("[feedback-automation] immediate enqueue failed; minute sweep will recover", error)
    })
    return NextResponse.json({ execution }, { status: 202 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "立即生成反馈报告失败" },
      { status: isOperationAccessError(error) ? 403 : 400 },
    )
  }
}
