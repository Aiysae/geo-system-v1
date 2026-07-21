import { NextRequest, NextResponse } from "next/server"
import { resolveWorkspaceAccess } from "@/lib/client-accounts"
import { buildClientFeedbackReport } from "@/lib/client-feedback/builder"
import {
  feedbackPeriodForDate,
  getClientExecutionProfile,
  listClientFeedbackReports,
} from "@/lib/client-feedback/store"
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
    const access = await resolveWorkspaceAccess(auth.userId, clientId)
    if (!access.ok) throw new Error(access.message)
    const reports = await listClientFeedbackReports(access.ownerUserId, clientId)
    return NextResponse.json({
      reports: reports.filter(report => access.mode === "standard" || report.status === "published"),
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "反馈报告读取失败" }, { status: 403 })
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
    const access = await resolveWorkspaceAccess(auth.userId, clientId)
    if (!access.ok) throw new Error(access.message)
    if (access.mode !== "standard") {
      return NextResponse.json({ error: "客户专属账号不能生成或发布反馈报告" }, { status: 403 })
    }
    const body = await request.json() as { type?: unknown; targetDate?: unknown }
    const type: ClientFeedbackReportType = body.type === "monthly" ? "monthly" : "weekly"
    const profile = await getClientExecutionProfile(access.ownerUserId, clientId)
    const client = (await listWorkspaceClients(access.ownerUserId))
      .find(record => record.client.id === clientId)?.client
    if (!client) throw new Error("客户面板不存在")
    const targetDate = typeof body.targetDate === "string" ? body.targetDate : undefined
    const period = feedbackPeriodForDate(profile, type, targetDate)
    const report = await buildClientFeedbackReport({
      ownerUserId: access.ownerUserId,
      actorUserId: auth.userId,
      client,
      profile,
      period,
    })
    return NextResponse.json({ report }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "反馈报告生成失败" }, { status: 400 })
  }
}
