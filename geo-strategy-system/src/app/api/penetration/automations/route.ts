import { NextRequest, NextResponse } from "next/server"
import {
  getPenetrationAutomationScheduleByClient,
  listPenetrationAutomationExecutions,
  upsertPenetrationAutomationSchedule,
} from "@/lib/penetration/automation-store"
import { requireOperationAccess, isOperationAccessError } from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"
import { listWorkspaceClients } from "@/lib/workspace-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function text(value: unknown, max = 200): string {
  return String(value || "").trim().slice(0, max)
}

export async function GET(request: NextRequest) {
  const guard = await requireUserId()
  if (!guard.ok) return guard.response
  try {
    const clientId = text(request.nextUrl.searchParams.get("clientId"))
    const teamId = text(request.nextUrl.searchParams.get("teamId")) || undefined
    const access = await requireOperationAccess({
      userId: guard.userId,
      clientId,
      teamId,
      module: "penetration",
      action: "view",
    })
    const schedule = await getPenetrationAutomationScheduleByClient(
      access.dataOwnerUserId,
      clientId,
    )
    const executions = schedule
      ? await listPenetrationAutomationExecutions({
          ownerUserId: access.dataOwnerUserId,
          scheduleId: schedule.id,
          limit: 12,
        })
      : []
    return NextResponse.json({ schedule, executions }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取自动检测计划失败" },
      { status: isOperationAccessError(error) ? 403 : 400 },
    )
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireUserId()
  if (!guard.ok) return guard.response
  try {
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
    const client = (await listWorkspaceClients(access.dataOwnerUserId))
      .find(item => item.client.id === clientId)?.client
    if (!client) {
      return NextResponse.json({ error: "当前客户不存在或已被删除" }, { status: 404 })
    }
    const schedule = await upsertPenetrationAutomationSchedule({
      ownerUserId: access.dataOwnerUserId,
      clientId,
      clientName: client.name,
      actorUserId: access.actorUserId,
      billingUserId: access.billingUserId,
      teamId: access.teamId,
      intervalDays: body.intervalDays,
      timeLocal: body.timeLocal,
      startDate: body.startDate,
      relativeDropThresholdPct: body.relativeDropThresholdPct,
      minimumAbsoluteDropPoints: body.minimumAbsoluteDropPoints,
      inAppEnabled: body.inAppEnabled !== false,
      emailEnabled: body.emailEnabled !== false,
      monthlyCreditLimit: body.monthlyCreditLimit,
      status: body.status === "paused" ? "paused" : "active",
    })
    return NextResponse.json({ schedule }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存自动检测计划失败" },
      { status: isOperationAccessError(error) ? 403 : 400 },
    )
  }
}
