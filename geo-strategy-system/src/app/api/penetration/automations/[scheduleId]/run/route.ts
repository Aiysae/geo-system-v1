import { NextRequest, NextResponse } from "next/server"
import {
  createPenetrationAutomationExecution,
  getPenetrationAutomationSchedule,
  listPenetrationAutomationExecutions,
} from "@/lib/penetration/automation-store"
import { enqueuePenetrationAutomationExecution } from "@/lib/penetration/automation-scheduler"
import { requireOperationAccess, isOperationAccessError } from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ scheduleId: string }> }

function text(value: unknown, max = 200): string {
  return String(value || "").trim().slice(0, max)
}

export async function POST(request: NextRequest, context: RouteContext) {
  const guard = await requireUserId()
  if (!guard.ok) return guard.response
  try {
    const { scheduleId } = await context.params
    const body = await request.json()
    const clientId = text(body.clientId)
    const teamId = text(body.teamId) || undefined
    const access = await requireOperationAccess({
      userId: guard.userId,
      clientId,
      teamId,
      module: "penetration",
      action: "execute",
    })
    const schedule = await getPenetrationAutomationSchedule(access.dataOwnerUserId, scheduleId)
    if (!schedule || schedule.clientId !== clientId) {
      return NextResponse.json({ error: "自动检测计划不存在" }, { status: 404 })
    }
    const active = (await listPenetrationAutomationExecutions({
      ownerUserId: access.dataOwnerUserId,
      scheduleId,
      limit: 10,
    })).find(execution => ["pending", "submitted", "running"].includes(execution.status))
    if (active) {
      return NextResponse.json({ execution: active, existing: true }, { status: 202 })
    }
    const execution = await createPenetrationAutomationExecution({
      schedule,
      trigger: "manual",
      scheduledFor: new Date().toISOString(),
    })
    try {
      await enqueuePenetrationAutomationExecution({
        ownerUserId: access.dataOwnerUserId,
        executionId: execution.id,
      })
    } catch (error) {
      console.warn("[penetration-automation] immediate enqueue failed; minute sweep will recover", error)
    }
    return NextResponse.json({ execution }, { status: 202 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "立即执行自动检测失败" },
      { status: isOperationAccessError(error) ? 403 : 400 },
    )
  }
}
