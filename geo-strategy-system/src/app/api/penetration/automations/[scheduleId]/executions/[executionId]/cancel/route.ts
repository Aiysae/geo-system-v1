import { NextRequest, NextResponse } from "next/server"
import { cancelPenetrationAutomationExecution } from "@/lib/penetration/automation-cancel"
import {
  getPenetrationAutomationExecution,
  getPenetrationAutomationSchedule,
} from "@/lib/penetration/automation-store"
import { isOperationAccessError, requireOperationAccess } from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ scheduleId: string; executionId: string }>
}

function text(value: unknown, max = 240): string {
  return String(value || "").trim().slice(0, max)
}

export async function POST(request: NextRequest, context: RouteContext) {
  const guard = await requireUserId()
  if (!guard.ok) return guard.response
  try {
    const { scheduleId, executionId } = await context.params
    const body = await request.json().catch(() => ({}))
    const clientId = text(body.clientId)
    const teamId = text(body.teamId) || undefined
    const access = await requireOperationAccess({
      userId: guard.userId,
      clientId,
      teamId,
      module: "penetration",
      action: "execute",
    })
    const [schedule, execution] = await Promise.all([
      getPenetrationAutomationSchedule(access.dataOwnerUserId, scheduleId),
      getPenetrationAutomationExecution(access.dataOwnerUserId, executionId),
    ])
    if (
      !schedule
      || schedule.clientId !== clientId
      || !execution
      || execution.scheduleId !== schedule.id
    ) {
      return NextResponse.json({ error: "自动检测任务不存在" }, { status: 404 })
    }
    const cancelled = await cancelPenetrationAutomationExecution({
      ownerUserId: access.dataOwnerUserId,
      executionId,
    })
    if (!cancelled) {
      return NextResponse.json({ error: "自动检测任务不存在" }, { status: 404 })
    }
    return NextResponse.json({
      execution: cancelled,
      message: cancelled.status === "cancelled"
        ? "本次自动检测已停止，未执行部分不会继续调用"
        : "任务在停止前已经结束，现有结果已保留",
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "停止自动检测失败" },
      { status: isOperationAccessError(error) ? 403 : 400 },
    )
  }
}
