import { NextRequest, NextResponse } from "next/server"
import { resolveWorkspaceAccess } from "@/lib/client-accounts"
import {
  getClientFeedbackReport,
  publishClientFeedbackReport,
  revokeClientFeedbackShare,
} from "@/lib/client-feedback/store"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ clientId: string; reportId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId, reportId } = await context.params
    const access = await resolveWorkspaceAccess(auth.userId, clientId)
    if (!access.ok) throw new Error(access.message)
    const report = await getClientFeedbackReport(access.ownerUserId, reportId)
    if (!report || report.clientId !== clientId || (access.mode === "client" && report.status !== "published")) {
      return NextResponse.json({ error: "报告不存在或无权访问" }, { status: 404 })
    }
    return NextResponse.json({ report })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "反馈报告读取失败" }, { status: 403 })
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
    const access = await resolveWorkspaceAccess(auth.userId, clientId)
    if (!access.ok) throw new Error(access.message)
    if (access.mode !== "standard") {
      return NextResponse.json({ error: "客户专属账号不能发布报告" }, { status: 403 })
    }
    const body = await request.json() as { action?: unknown }
    if (body.action === "revoke-share") {
      const report = await revokeClientFeedbackShare({
        ownerUserId: access.ownerUserId,
        clientId,
        reportId,
      })
      return NextResponse.json({ report })
    }
    const result = await publishClientFeedbackReport({
      ownerUserId: access.ownerUserId,
      clientId,
      reportId,
      actorUserId: auth.userId,
    })
    return NextResponse.json({
      report: result.report,
      sharePath: `/feedback/share/${encodeURIComponent(result.shareToken)}`,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "反馈报告发布失败" }, { status: 400 })
  }
}
