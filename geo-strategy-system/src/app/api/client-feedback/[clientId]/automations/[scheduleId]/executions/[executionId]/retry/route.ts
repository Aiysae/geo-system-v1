import { NextRequest, NextResponse } from "next/server"
import {
  clientFeedbackAutomationRetryPatch,
  getClientFeedbackAutomationExecution,
  getClientFeedbackAutomationSchedule,
  patchClientFeedbackAutomationExecution,
} from "@/lib/client-feedback/automation-store"
import { retryClientFeedbackAutomationExecution } from "@/lib/client-feedback/automation-scheduler"
import { hitRateLimit } from "@/lib/rate-limit"
import { requireOperationAccess, isOperationAccessError } from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = {
  params: Promise<{ clientId: string; scheduleId: string; executionId: string }>
}

export async function POST(request: NextRequest, context: Context) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId, scheduleId, executionId } = await context.params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      teamId: typeof body.teamId === "string" ? body.teamId : undefined,
      module: "feedback",
      action: "manage",
    })
    const [schedule, execution] = await Promise.all([
      getClientFeedbackAutomationSchedule(access.dataOwnerUserId, scheduleId),
      getClientFeedbackAutomationExecution(access.dataOwnerUserId, executionId),
    ])
    if (!schedule || schedule.clientId !== access.clientId) {
      return NextResponse.json({ error: "自动报送计划不存在" }, { status: 404 })
    }
    if (!execution || execution.scheduleId !== schedule.id || execution.clientId !== access.clientId) {
      return NextResponse.json({ error: "自动报送记录不存在" }, { status: 404 })
    }
    if (!["failed", "partial"].includes(execution.status)) {
      throw new Error("只有失败或部分发送的任务可以重试")
    }
    if (schedule.status === "paused") throw new Error("请先恢复自动报送计划")
    const rateLimit = await hitRateLimit(
      "feedback-automation:retry",
      `${auth.userId}:${executionId}`,
      5,
      60 * 60,
    )
    if (!rateLimit.ok) {
      return NextResponse.json({ error: "重试操作过于频繁，请稍后再试" }, { status: 429 })
    }
    const updated = await patchClientFeedbackAutomationExecution({
      ownerUserId: access.dataOwnerUserId,
      id: execution.id,
      patch: clientFeedbackAutomationRetryPatch(execution),
    })
    if (!updated) throw new Error("自动报送记录更新失败")
    await retryClientFeedbackAutomationExecution({
      ownerUserId: access.dataOwnerUserId,
      executionId: execution.id,
    }).catch(error => {
      console.warn("[feedback-automation] retry enqueue failed; minute sweep will recover", error)
    })
    return NextResponse.json({ execution: updated }, { status: 202 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "自动报送重试失败" },
      { status: isOperationAccessError(error) ? 403 : 400 },
    )
  }
}
