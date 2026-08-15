import { NextRequest, NextResponse } from "next/server"
import {
  deleteClientFeedbackAutomationSchedule,
  getClientFeedbackAutomationSchedule,
  setClientFeedbackAutomationScheduleStatus,
  upsertClientFeedbackAutomationSchedule,
} from "@/lib/client-feedback/automation-store"
import { saveClientExecutionProfile } from "@/lib/client-feedback/store"
import { requireOperationAccess, isOperationAccessError } from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"
import { listWorkspaceClients } from "@/lib/workspace-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ clientId: string; scheduleId: string }> }

function text(value: unknown, max = 254): string {
  return String(value || "").trim().slice(0, max)
}

export async function PATCH(request: NextRequest, context: Context) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId, scheduleId } = await context.params
    const body = await request.json() as Record<string, unknown>
    const teamId = text(body.teamId, 200) || undefined
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      teamId,
      module: "feedback",
      action: "manage",
    })
    const current = await getClientFeedbackAutomationSchedule(access.dataOwnerUserId, scheduleId)
    if (!current || current.clientId !== access.clientId) {
      return NextResponse.json({ error: "自动报送计划不存在" }, { status: 404 })
    }
    if (body.action === "pause" || body.action === "resume") {
      const schedule = await setClientFeedbackAutomationScheduleStatus({
        ownerUserId: access.dataOwnerUserId,
        id: scheduleId,
        status: body.action === "pause" ? "paused" : "active",
      })
      return NextResponse.json({ schedule })
    }
    const client = (await listWorkspaceClients(access.dataOwnerUserId))
      .find(item => item.client.id === access.clientId)?.client
    if (!client) return NextResponse.json({ error: "客户面板不存在" }, { status: 404 })
    const startDate = text(body.startDate || current.startDate, 10)
    const endDate = text(body.endDate || current.endDate, 10)
    const periodMode = body.periodMode === "calendar"
      ? "calendar"
      : body.periodMode === "service"
        ? "service"
        : current.periodMode
    const schedule = await upsertClientFeedbackAutomationSchedule({
      ownerUserId: access.dataOwnerUserId,
      clientId: access.clientId,
      clientName: client.name,
      actorUserId: auth.userId,
      teamId: access.teamId,
      status: current.status === "paused" ? "paused" : "active",
      weeklyEnabled: typeof body.weeklyEnabled === "boolean" ? body.weeklyEnabled : current.weeklyEnabled,
      monthlyEnabled: typeof body.monthlyEnabled === "boolean" ? body.monthlyEnabled : current.monthlyEnabled,
      timeLocal: text(body.timeLocal || current.timeLocal, 5),
      startDate,
      endDate,
      periodMode,
      recipientEmails: Array.isArray(body.recipientEmails) ? body.recipientEmails.map(String) : current.recipientEmails,
      sendEmptyReports: typeof body.sendEmptyReports === "boolean" ? body.sendEmptyReports : current.sendEmptyReports,
      finalReportEnabled: typeof body.finalReportEnabled === "boolean" ? body.finalReportEnabled : current.finalReportEnabled,
    })
    await saveClientExecutionProfile({
      ownerUserId: access.dataOwnerUserId,
      clientId: access.clientId,
      updatedByUserId: auth.userId,
      patch: { startDate, endDate, periodMode },
    })
    return NextResponse.json({ schedule })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "自动报送计划更新失败" },
      { status: isOperationAccessError(error) ? 403 : 400 },
    )
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId, scheduleId } = await context.params
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      teamId: text(request.nextUrl.searchParams.get("teamId"), 200) || undefined,
      module: "feedback",
      action: "manage",
    })
    const current = await getClientFeedbackAutomationSchedule(access.dataOwnerUserId, scheduleId)
    if (!current || current.clientId !== access.clientId) {
      return NextResponse.json({ error: "自动报送计划不存在" }, { status: 404 })
    }
    await deleteClientFeedbackAutomationSchedule(access.dataOwnerUserId, scheduleId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "自动报送计划删除失败" },
      { status: isOperationAccessError(error) ? 403 : 400 },
    )
  }
}
