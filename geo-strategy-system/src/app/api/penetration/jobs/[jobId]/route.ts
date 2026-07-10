import { NextRequest, NextResponse } from "next/server"
import { cancelPenetrationJob, getPenetrationJob } from "@/lib/penetration/jobs"
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
  const job = await getPenetrationJob(jobId, userGuard.userId)
  if (!job) {
    return NextResponse.json({ error: "疑问句检测任务不存在或已过期" }, { status: 404 })
  }
  return NextResponse.json(job)
}

export async function PATCH(
  _req: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response
  const { jobId } = await context.params
  const job = await cancelPenetrationJob(jobId, userGuard.userId)
  if (!job) {
    return NextResponse.json({ error: "疑问句检测任务不存在或已过期" }, { status: 404 })
  }
  return NextResponse.json(job)
}
