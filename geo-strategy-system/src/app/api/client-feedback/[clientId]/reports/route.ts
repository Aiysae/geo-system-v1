import { NextRequest, NextResponse } from "next/server"
import { buildClientFeedbackReport } from "@/lib/client-feedback/builder"
import {
  feedbackPeriodForDate,
  getClientExecutionProfile,
  listClientFeedbackReports,
} from "@/lib/client-feedback/store"
import { requireOperationAccess } from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"
import { listWorkspaceClients } from "@/lib/workspace-store"
import type { ClientFeedbackReportType } from "@/types/client-feedback"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId } = await context.params
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      module: "feedback",
      action: "view",
    })
    const reports = await listClientFeedbackReports(access.dataOwnerUserId, access.clientId)
    return NextResponse.json({
      reports: reports.filter(report => access.mode !== "client" || report.status === "published"),
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "反馈报告读取失败",
    }, { status: 403 })
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId } = await context.params
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      module: "feedback",
      action: "execute",
    })
    const body = await request.json() as { type?: unknown; targetDate?: unknown }
    const type: ClientFeedbackReportType = body.type === "monthly" ? "monthly" : "weekly"
    const profile = await getClientExecutionProfile(access.dataOwnerUserId, access.clientId)
    const client = (await listWorkspaceClients(access.dataOwnerUserId))
      .find(record => record.client.id === access.clientId)?.client
    if (!client) throw new Error("客户面板不存在")
    const targetDate = typeof body.targetDate === "string" ? body.targetDate : undefined
    const period = feedbackPeriodForDate(profile, type, targetDate)
    const report = await buildClientFeedbackReport({
      ownerUserId: access.dataOwnerUserId,
      actorUserId: auth.userId,
      client,
      profile,
      period,
    })
    return NextResponse.json({ report }, { status: 201 })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "反馈报告生成失败",
    }, { status: 403 })
  }
}
