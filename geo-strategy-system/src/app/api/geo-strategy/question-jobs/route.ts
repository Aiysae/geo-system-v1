import { NextRequest, NextResponse } from "next/server"
import { createQuestionJob, estimateQuestionJobCredits } from "@/lib/geo-strategy/question-jobs"
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
  try {
    const userGuard = await requireUserId()
    if (!userGuard.ok) return userGuard.response

    const body = await req.json()
    const featureKey = "keywordQuestionUnit"
    const requestedCount = estimateQuestionJobCredits(body)
    const credits = estimateFeatureCredits(featureKey, requestedCount)
    const creditGuard = await reserveCreditsForUser(userGuard.userId, credits, {
      featureKey,
      source: "api:geo-strategy:question-jobs",
      description: getFeaturePrice(featureKey).label,
      metadata: { requestedCount },
    })
    if (!creditGuard.ok) return creditGuard.response
    reservation = creditGuard.reservation

    const job = await createQuestionJob(
      body,
      undefined,
      userGuard.userId,
      reservation.amount,
    )
    reservation = null
    return NextResponse.json(job, { status: 202 })
  } catch (error) {
    await refundReservedCreditsQuietly(reservation)
    const message = error instanceof Error ? error.message : "创建疑问句生成任务失败"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
