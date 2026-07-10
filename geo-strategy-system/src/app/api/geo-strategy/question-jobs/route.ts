import { NextRequest, NextResponse } from "next/server"
import { createQuestionJob, estimateQuestionJobCredits, getQuestionJob } from "@/lib/geo-strategy/question-jobs"
import {
  acquireJobRequest,
  jobIdFromRequest,
  normalizeJobRequestId,
  releaseJobRequestClaim,
  type JobRequestClaim,
} from "@/lib/job-request-idempotency"
import {
  refundReservedCreditsQuietly,
  requireUserId,
  reserveCreditsForUser,
  type CreditReservation,
} from "@/lib/with-credits"
import { estimateFeatureCredits, getFeaturePrice } from "@/lib/pricing"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  let reservation: CreditReservation | null = null
  let requestClaim: JobRequestClaim | null = null
  try {
    const userGuard = await requireUserId()
    if (!userGuard.ok) return userGuard.response

    const body = await req.json()
    const requestId = normalizeJobRequestId(body.requestId)
    const jobId = jobIdFromRequest("qjob", userGuard.userId, requestId)
    const featureKey = "keywordQuestionUnit"
    const requestedCount = estimateQuestionJobCredits(body)
    const credits = estimateFeatureCredits(featureKey, requestedCount)

    const acquired = await acquireJobRequest({
      namespace: "keyword-questions",
      ownerUserId: userGuard.userId,
      requestId,
      existingJobId: jobId,
      loadExisting: id => getQuestionJob(id, userGuard.userId),
    })
    if (acquired.status === "existing") {
      return NextResponse.json(acquired.job, { status: 202 })
    }
    if (acquired.status === "pending") {
      return NextResponse.json({ error: "疑问句任务正在创建，系统会自动重试" }, { status: 409 })
    }
    requestClaim = acquired.claim

    const creditGuard = await reserveCreditsForUser(userGuard.userId, credits, {
      featureKey,
      source: "api:geo-strategy:question-jobs",
      sourceId: jobId,
      description: getFeaturePrice(featureKey).label,
      metadata: { requestedCount, clientId: String(body.clientId || "").trim() || undefined },
    })
    if (!creditGuard.ok) {
      await releaseJobRequestClaim(requestClaim)
      requestClaim = null
      return creditGuard.response
    }
    reservation = creditGuard.reservation

    const job = await createQuestionJob(
      body,
      undefined,
      userGuard.userId,
      reservation.amount,
      jobId,
    )
    reservation = null
    await releaseJobRequestClaim(requestClaim)
    requestClaim = null
    return NextResponse.json(job, { status: 202 })
  } catch (error) {
    await releaseJobRequestClaim(requestClaim)
    await refundReservedCreditsQuietly(reservation)
    const message = error instanceof Error ? error.message : "创建疑问句生成任务失败"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
