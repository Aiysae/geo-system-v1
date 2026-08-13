import { NextRequest, NextResponse } from "next/server"
import {
  clientFeedbackReportSharePath,
  deleteClientFeedbackReport,
  getClientFeedbackReport,
  publishClientFeedbackReport,
  revokeClientFeedbackShare,
} from "@/lib/client-feedback/store"
import { requireOperationAccess } from "@/lib/team-access"
import { hasTeamPermission } from "@/lib/team-permissions"
import {
  getClientExecutionPublicationPolicy,
  sanitizeFeedbackReportForClient,
} from "@/lib/client-feedback/publication"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ clientId: string; reportId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId, reportId } = await context.params
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      teamId: String(request.nextUrl.searchParams.get("teamId") || "").trim() || undefined,
      module: "feedback",
      action: "view",
    })
    const report = await getClientFeedbackReport(access.dataOwnerUserId, reportId)
    if (
      !report
      || report.clientId !== access.clientId
      || (access.mode === "client" && report.status !== "published")
    ) {
      return NextResponse.json({ error: "报告不存在或无权访问" }, { status: 404 })
    }
    const responseReport = access.mode === "client"
      ? sanitizeFeedbackReportForClient(
          report,
          await getClientExecutionPublicationPolicy(
            access.dataOwnerUserId,
            access.clientId,
          ),
          {
            allowPenetrationResults: hasTeamPermission(
              access.permissionKeys,
              "penetration",
              "view",
            ),
          },
        )
      : report
    return NextResponse.json({
      report: {
        ...responseReport,
        sharePath: clientFeedbackReportSharePath(report),
      },
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "反馈报告读取失败",
    }, { status: 403 })
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ clientId: string; reportId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId, reportId } = await context.params
    const body = await request.json() as { action?: unknown; teamId?: unknown }
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      teamId: typeof body.teamId === "string" ? body.teamId : undefined,
      module: "feedback",
      action: "manage",
    })
    if (body.action === "revoke-share") {
      const report = await revokeClientFeedbackShare({
        ownerUserId: access.dataOwnerUserId,
        clientId: access.clientId,
        reportId,
      })
      return NextResponse.json({ report })
    }
    const result = await publishClientFeedbackReport({
      ownerUserId: access.dataOwnerUserId,
      clientId: access.clientId,
      reportId,
      actorUserId: auth.userId,
    })
    return NextResponse.json({
      report: result.report,
      sharePath: result.sharePath,
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "反馈报告发布失败",
    }, { status: 403 })
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ clientId: string; reportId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId, reportId } = await context.params
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      teamId: String(request.nextUrl.searchParams.get("teamId") || "").trim() || undefined,
      module: "feedback",
      action: "manage",
    })
    const result = await deleteClientFeedbackReport({
      ownerUserId: access.dataOwnerUserId,
      clientId: access.clientId,
      reportId,
    })
    if (result === "not_found") {
      return NextResponse.json({ error: "反馈报告不存在或无权访问" }, { status: 404 })
    }
    if (result === "published") {
      return NextResponse.json({ error: "已发布报告不能删除，可先停止分享并保留交付记录" }, { status: 409 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "反馈报告删除失败",
    }, { status: 403 })
  }
}
