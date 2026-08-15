import { NextRequest, NextResponse } from "next/server"
import {
  getClientFeedbackAutomationScheduleByClient,
  listClientFeedbackAutomationExecutions,
  upsertClientFeedbackAutomationSchedule,
} from "@/lib/client-feedback/automation-store"
import { saveClientExecutionProfile } from "@/lib/client-feedback/store"
import { requireOperationAccess, isOperationAccessError } from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"
import { listWorkspaceClients } from "@/lib/workspace-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ clientId: string }> }

function text(value: unknown, max = 254): string {
  return String(value || "").trim().slice(0, max)
}

function teamId(request: NextRequest, body?: Record<string, unknown>): string | undefined {
  return text(body?.teamId || request.nextUrl.searchParams.get("teamId"), 200) || undefined
}

export async function GET(request: NextRequest, context: Context) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId } = await context.params
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      teamId: teamId(request),
      module: "feedback",
      action: "manage",
    })
    const schedule = await getClientFeedbackAutomationScheduleByClient(
      access.dataOwnerUserId,
      access.clientId,
    )
    const executions = schedule
      ? await listClientFeedbackAutomationExecutions({
          ownerUserId: access.dataOwnerUserId,
          scheduleId: schedule.id,
          limit: 20,
        })
      : []
    return NextResponse.json({ schedule, executions }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "自动报送计划读取失败" },
      { status: isOperationAccessError(error) ? 403 : 400 },
    )
  }
}

export async function POST(request: NextRequest, context: Context) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId } = await context.params
    const body = await request.json() as Record<string, unknown>
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      teamId: teamId(request, body),
      module: "feedback",
      action: "manage",
    })
    const client = (await listWorkspaceClients(access.dataOwnerUserId))
      .find(item => item.client.id === access.clientId)?.client
    if (!client) return NextResponse.json({ error: "客户面板不存在" }, { status: 404 })
    const startDate = text(body.startDate, 10)
    const endDate = text(body.endDate, 10)
    const periodMode = body.periodMode === "calendar" ? "calendar" : "service"
    const schedule = await upsertClientFeedbackAutomationSchedule({
      ownerUserId: access.dataOwnerUserId,
      clientId: access.clientId,
      clientName: client.name,
      actorUserId: auth.userId,
      teamId: access.teamId,
      status: body.status === "paused" ? "paused" : "active",
      weeklyEnabled: body.weeklyEnabled !== false,
      monthlyEnabled: body.monthlyEnabled !== false,
      timeLocal: text(body.timeLocal, 5) || "10:00",
      startDate,
      endDate,
      periodMode,
      recipientEmails: Array.isArray(body.recipientEmails) ? body.recipientEmails.map(String) : [],
      sendEmptyReports: body.sendEmptyReports !== false,
      finalReportEnabled: body.finalReportEnabled !== false,
    })
    await saveClientExecutionProfile({
      ownerUserId: access.dataOwnerUserId,
      clientId: access.clientId,
      updatedByUserId: auth.userId,
      patch: { startDate, endDate, periodMode },
    })
    return NextResponse.json({ schedule }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "自动报送计划保存失败" },
      { status: isOperationAccessError(error) ? 403 : 400 },
    )
  }
}
