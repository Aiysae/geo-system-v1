import { NextRequest, NextResponse } from "next/server"
import {
  acquireJobRequest,
  jobIdFromRequest,
  normalizeJobRequestId,
  releaseJobRequestClaim,
  type JobRequestClaim,
} from "@/lib/job-request-idempotency"
import { getPenetrationJob } from "@/lib/penetration/jobs"
import {
  PenetrationJobSubmissionError,
  submitPenetrationJob,
} from "@/lib/penetration/job-creation"
import { isOperationAccessError } from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  let requestClaim: JobRequestClaim | null = null
  try {
    const userGuard = await requireUserId()
    if (!userGuard.ok) return userGuard.response

    const body = await req.json()
    const requestId = normalizeJobRequestId(body.requestId)
    const jobId = jobIdFromRequest("pjob", userGuard.userId, requestId)
    const acquired = await acquireJobRequest({
      namespace: "penetration",
      ownerUserId: userGuard.userId,
      requestId,
      existingJobId: jobId,
      loadExisting: id => getPenetrationJob(id, userGuard.userId),
    })
    if (acquired.status === "existing") {
      return NextResponse.json(acquired.job, { status: 202 })
    }
    if (acquired.status === "pending") {
      return NextResponse.json({ error: "检测任务正在创建，系统会自动重试" }, { status: 409 })
    }
    requestClaim = acquired.claim

    const result = await submitPenetrationJob({
      actorUserId: userGuard.userId,
      clientId: body.clientId,
      teamId: body.teamId,
      requestId,
      operation: body.operation,
      questions: body.questions,
      questionIntents: body.questionIntents,
      models: body.models,
      slotSelection: body.slotSelection,
      subjectType: body.subjectType,
      personProfile: body.personProfile,
      ourBrand: body.ourBrand,
      brandAliases: body.brandAliases,
      industry: body.industry,
      competitors: body.competitors,
      origin: "manual",
    })
    await releaseJobRequestClaim(requestClaim)
    requestClaim = null
    return NextResponse.json(result.job, { status: 202 })
  } catch (error) {
    await releaseJobRequestClaim(requestClaim)
    const status = error instanceof PenetrationJobSubmissionError
      ? error.status
      : isOperationAccessError(error)
        ? 403
        : 400
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "创建疑问句检测任务失败",
        code: error instanceof Error ? error.name : undefined,
        ...(error instanceof PenetrationJobSubmissionError && error.details
          ? error.details
          : {}),
      },
      { status },
    )
  }
}
