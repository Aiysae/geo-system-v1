import { NextRequest, NextResponse } from "next/server"
import { getQuestionJob } from "@/lib/geo-strategy/question-jobs"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await ctx.params
  const job = await getQuestionJob(jobId)

  if (!job) {
    return NextResponse.json({ error: "疑问句生成任务不存在或已过期" }, { status: 404 })
  }

  return NextResponse.json(job)
}
