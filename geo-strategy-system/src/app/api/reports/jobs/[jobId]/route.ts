import { NextRequest, NextResponse } from "next/server"
import { deleteCommercialReportJob, getCommercialReportJob } from "@/lib/reports/report-jobs"
import { requireUserId } from "@/lib/with-credits"
import {
  requireStandardAccountMode,
  resolveWorkspaceAccess,
} from "@/lib/client-accounts"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response
  const { jobId } = await context.params
  const access = await resolveWorkspaceAccess(userGuard.userId)
  if (!access.ok) {
    return NextResponse.json({ error: access.message, code: access.code }, { status: 403 })
  }
  const job = await getCommercialReportJob(jobId, access.ownerUserId)
  if (job && access.mode === "client" && job.clientId !== access.clientId) {
    return NextResponse.json({ error: "报告任务不存在或无权查看" }, { status: 404 })
  }
  if (!job) {
    return NextResponse.json({ error: "报告任务不存在或已过期" }, { status: 404 })
  }
  return NextResponse.json(job, { headers: { "Cache-Control": "private, no-store" } })
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response
  const accountAccess = await requireStandardAccountMode(userGuard.userId)
  if (!accountAccess.ok) {
    return NextResponse.json(
      { error: accountAccess.message, code: "CLIENT_ACCOUNT_READ_ONLY" },
      { status: 403 },
    )
  }
  const { jobId } = await context.params
  const result = await deleteCommercialReportJob(jobId, userGuard.userId)
  if (result === "not_found") {
    return NextResponse.json({ error: "报告不存在或无权删除" }, { status: 404 })
  }
  if (result === "active") {
    return NextResponse.json({ error: "报告正在生成，完成后才能删除" }, { status: 409 })
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } })
}
