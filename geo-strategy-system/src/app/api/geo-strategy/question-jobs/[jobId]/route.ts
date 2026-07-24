import { NextRequest, NextResponse } from "next/server"
import {
  cancelQuestionJob,
  getQuestionJob,
} from "@/lib/geo-strategy/question-jobs"
import { resolveOperationAccess } from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

async function authorize(input: {
  jobId: string
  userId: string
  action: "view" | "execute"
}) {
  const job = await getQuestionJob(input.jobId, input.userId)
  if (!job) {
    return {
      response: NextResponse.json(
        { error: "疑问句生成任务不存在或已过期" },
        { status: 404 },
      ),
    }
  }
  if (job.clientId) {
    const access = await resolveOperationAccess({
      userId: input.userId,
      clientId: job.clientId,
      module: "keyword",
      action: input.action,
    })
    if (!access.ok) {
      return {
        response: NextResponse.json(
          { error: access.message, code: access.code },
          { status: 403 },
        ),
      }
    }
  }
  return { job }
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> },
) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response
  const { jobId } = await ctx.params
  const authorized = await authorize({ jobId, userId: userGuard.userId, action: "view" })
  if (authorized.response) return authorized.response
  return NextResponse.json(authorized.job)
}

export async function PATCH(
  _req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> },
) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response
  const { jobId } = await ctx.params
  const authorized = await authorize({ jobId, userId: userGuard.userId, action: "execute" })
  if (authorized.response) return authorized.response
  const job = await cancelQuestionJob(jobId, userGuard.userId)
  if (!job) {
    return NextResponse.json({ error: "疑问句生成任务不存在或已过期" }, { status: 404 })
  }
  return NextResponse.json(job)
}
