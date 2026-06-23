import { NextRequest, NextResponse } from "next/server"
import { cancelQuestionJob, getQuestionJob } from "@/lib/geo-strategy/question-jobs"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> },
) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response

  const { jobId } = await ctx.params
  const job = await getQuestionJob(jobId, userGuard.userId)

  if (!job) {
    return NextResponse.json({ error: "疑问句生成任务不存在或已过期" }, { status: 404 })
  }

  return NextResponse.json(job)
}

export async function PATCH(
  _req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> },
) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response

  const { jobId } = await ctx.params
  const job = await cancelQuestionJob(jobId, userGuard.userId)

  if (!job) {
    return NextResponse.json({ error: "疑问句生成任务不存在或已过期" }, { status: 404 })
  }

  return NextResponse.json(job)
}
