import { NextRequest, NextResponse } from "next/server"
import { createClientFeedbackReport } from "@/lib/client-feedback/report-service"
import {
  clientFeedbackReportSharePath,
  feedbackPeriodForDate,
  getClientExecutionProfile,
  listClientFeedbackReports,
  shanghaiDateOnly,
} from "@/lib/client-feedback/store"
import { requireOperationAccess } from "@/lib/team-access"
import { hasTeamPermission } from "@/lib/team-permissions"
import {
  getClientExecutionPublicationPolicy,
  sanitizeFeedbackReportForClient,
} from "@/lib/client-feedback/publication"
import { requireUserId } from "@/lib/with-credits"
import { listWorkspaceClients } from "@/lib/workspace-store"
import type { ClientFeedbackReportType } from "@/types/client-feedback"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId } = await context.params
    const teamId = String(request.nextUrl.searchParams.get("teamId") || "").trim() || undefined
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      module: "feedback",
      action: "view",
      teamId,
    })
    const [reports, publicationPolicy] = await Promise.all([
      listClientFeedbackReports(access.dataOwnerUserId, access.clientId),
      getClientExecutionPublicationPolicy(access.dataOwnerUserId, access.clientId),
    ])
    return NextResponse.json({
      reports: reports
        .filter(report => access.mode !== "client" || report.status === "published")
        .map(report => access.mode === "client"
          ? sanitizeFeedbackReportForClient(report, publicationPolicy, {
              allowPenetrationResults: hasTeamPermission(
                access.permissionKeys,
                "penetration",
                "view",
              ),
            })
          : {
              ...report,
              sharePath: clientFeedbackReportSharePath(report),
            }),
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
    const body = await request.json() as {
      type?: unknown
      targetDate?: unknown
      teamId?: unknown
      requestId?: unknown
      baselineHistoryRecordId?: unknown
      currentHistoryRecordId?: unknown
      publish?: unknown
    }
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      module: "feedback",
      action: body.publish === true ? "manage" : "edit",
      teamId: typeof body.teamId === "string" ? body.teamId : undefined,
    })
    const type: ClientFeedbackReportType = body.type === "monthly" ? "monthly" : "weekly"
    const profile = await getClientExecutionProfile(access.dataOwnerUserId, access.clientId)
    const client = (await listWorkspaceClients(access.dataOwnerUserId))
      .find(record => record.client.id === access.clientId)?.client
    if (!client) throw new Error("客户面板不存在")
    const targetDate = typeof body.targetDate === "string" ? body.targetDate : undefined
    const period = feedbackPeriodForDate(profile, type, targetDate)
    if (period.end > shanghaiDateOnly()) throw new Error("报告截止日期不能晚于今天")
    const created = await createClientFeedbackReport({
      ownerUserId: access.dataOwnerUserId,
      actorUserId: auth.userId,
      client,
      profile,
      period,
      baselineHistoryRecordId: typeof body.baselineHistoryRecordId === "string"
        ? body.baselineHistoryRecordId
        : undefined,
      currentHistoryRecordId: typeof body.currentHistoryRecordId === "string"
        ? body.currentHistoryRecordId
        : undefined,
      publish: body.publish === true,
      requestId: typeof body.requestId === "string" ? body.requestId : undefined,
    })
    return NextResponse.json({
      report: created.report,
      sharePath: created.sharePath,
    }, { status: 201 })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "反馈报告生成失败",
    }, { status: 403 })
  }
}
