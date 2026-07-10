import { NextRequest, NextResponse } from "next/server"
import { getCommercialReportJob } from "@/lib/reports/report-jobs"
import { requireUserId } from "@/lib/with-credits"

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
  const job = await getCommercialReportJob(jobId, userGuard.userId)
  if (!job) {
    return NextResponse.json({ error: "报告任务不存在或已过期" }, { status: 404 })
  }
  return NextResponse.json(job, { headers: { "Cache-Control": "private, no-store" } })
}
