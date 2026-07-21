import { NextRequest, NextResponse } from "next/server"
import { resolveWorkspaceAccess } from "@/lib/client-accounts"
import { listSystemClientExecutionActions } from "@/lib/client-feedback/builder"
import {
  executionCounters,
  feedbackPeriodForDate,
  getClientExecutionProfile,
  listClientExecutionActions,
  listClientFeedbackReports,
  saveClientExecutionProfile,
} from "@/lib/client-feedback/store"
import { requireUserId } from "@/lib/with-credits"
import { listWorkspaceClients } from "@/lib/workspace-store"
import type { ClientExecutionProfile } from "@/types/client-feedback"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return response
}

async function scopedClient(userId: string, clientId: string) {
  const access = await resolveWorkspaceAccess(userId, clientId)
  if (!access.ok) throw new Error(access.message)
  const client = (await listWorkspaceClients(access.ownerUserId))
    .find(record => record.client.id === access.clientId)?.client
  if (!client) throw new Error("客户面板不存在或无权访问")
  return { access, client }
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId } = await context.params
    const { access } = await scopedClient(auth.userId, clientId)
    const [profile, manualActions, systemActions, reports] = await Promise.all([
      getClientExecutionProfile(access.ownerUserId, access.clientId as string),
      listClientExecutionActions(access.ownerUserId, access.clientId as string),
      listSystemClientExecutionActions(access.ownerUserId, access.clientId as string),
      listClientFeedbackReports(access.ownerUserId, access.clientId as string),
    ])
    const actions = [...manualActions, ...systemActions]
      .filter(action => access.mode === "standard" || action.visibility === "client")
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    return noStore(NextResponse.json({
      accessMode: access.mode,
      canManage: access.mode === "standard",
      profile,
      counters: executionCounters(profile),
      currentWeek: feedbackPeriodForDate(profile, "weekly"),
      currentMonth: feedbackPeriodForDate(profile, "monthly"),
      actions,
      reports: reports.filter(report => access.mode === "standard" || report.status === "published"),
    }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "客户执行反馈读取失败",
    }, { status: 403 }))
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId } = await context.params
    const { access } = await scopedClient(auth.userId, clientId)
    if (access.mode !== "standard") {
      return noStore(NextResponse.json({ error: "客户专属账号只能查看执行设置" }, { status: 403 }))
    }
    const body = await request.json() as { patch?: Partial<ClientExecutionProfile> }
    const profile = await saveClientExecutionProfile({
      ownerUserId: access.ownerUserId,
      clientId: access.clientId as string,
      updatedByUserId: auth.userId,
      patch: body.patch || {},
    })
    return noStore(NextResponse.json({ profile, counters: executionCounters(profile) }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "客户执行设置保存失败",
    }, { status: 400 }))
  }
}
