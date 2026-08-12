import { NextRequest, NextResponse } from "next/server"
import {
  deletePenetrationAutomationSchedule,
  getPenetrationAutomationSchedule,
  setPenetrationAutomationScheduleStatus,
  upsertPenetrationAutomationSchedule,
} from "@/lib/penetration/automation-store"
import { requireOperationAccess, isOperationAccessError } from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"
import { listWorkspaceClients } from "@/lib/workspace-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ scheduleId: string }> }

function text(value: unknown, max = 200): string {
  return String(value || "").trim().slice(0, max)
}

export async function PATCH(request: NextRequest, context: RouteContext) {
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
    const current = await getPenetrationAutomationSchedule(access.dataOwnerUserId, scheduleId)
    if (!current || current.clientId !== clientId) {
      return NextResponse.json({ error: "自动检测计划不存在" }, { status: 404 })
    }
    if (body.action === "pause" || body.action === "resume") {
      const schedule = await setPenetrationAutomationScheduleStatus({
        ownerUserId: access.dataOwnerUserId,
        id: current.id,
        status: body.action === "pause" ? "paused" : "active",
      })
      return NextResponse.json({ schedule })
    }
    const client = (await listWorkspaceClients(access.dataOwnerUserId))
      .find(item => item.client.id === clientId)?.client
    if (!client) return NextResponse.json({ error: "当前客户不存在" }, { status: 404 })
    const schedule = await upsertPenetrationAutomationSchedule({
      ownerUserId: access.dataOwnerUserId,
      clientId,
      clientName: client.name,
      actorUserId: access.actorUserId,
      billingUserId: access.billingUserId,
      teamId: access.teamId,
      intervalDays: body.intervalDays ?? current.intervalDays,
      timeLocal: body.timeLocal ?? current.timeLocal,
      startDate: body.startDate ?? current.startDate,
      relativeDropThresholdPct:
        body.relativeDropThresholdPct ?? current.relativeDropThresholdPct,
      minimumAbsoluteDropPoints:
        body.minimumAbsoluteDropPoints ?? current.minimumAbsoluteDropPoints,
      inAppEnabled: typeof body.inAppEnabled === "boolean"
        ? body.inAppEnabled
        : current.inAppEnabled,
      emailEnabled: typeof body.emailEnabled === "boolean"
        ? body.emailEnabled
        : current.emailEnabled,
      monthlyCreditLimit: body.monthlyCreditLimit === null
        ? undefined
        : body.monthlyCreditLimit ?? current.monthlyCreditLimit,
      status: current.status,
    })
    return NextResponse.json({ schedule })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新自动检测计划失败" },
      { status: isOperationAccessError(error) ? 403 : 400 },
    )
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const guard = await requireUserId()
  if (!guard.ok) return guard.response
  try {
    const { scheduleId } = await context.params
    const clientId = text(request.nextUrl.searchParams.get("clientId"))
    const teamId = text(request.nextUrl.searchParams.get("teamId")) || undefined
    const access = await requireOperationAccess({
      userId: guard.userId,
      clientId,
      teamId,
      module: "penetration",
      action: "execute",
    })
    const current = await getPenetrationAutomationSchedule(access.dataOwnerUserId, scheduleId)
    if (!current || current.clientId !== clientId) {
      return NextResponse.json({ error: "自动检测计划不存在" }, { status: 404 })
    }
    await deletePenetrationAutomationSchedule(access.dataOwnerUserId, scheduleId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除自动检测计划失败" },
      { status: isOperationAccessError(error) ? 403 : 400 },
    )
  }
}
