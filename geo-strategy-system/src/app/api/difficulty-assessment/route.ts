import { NextRequest, NextResponse } from "next/server"
import {
  normalizeDifficultyInput,
  runDifficultyAssessment,
} from "@/lib/difficulty/assessment"
import { ADAPTERS } from "@/lib/llm"
import { estimateFeatureCredits, getFeaturePrice } from "@/lib/pricing"
import {
  authAndReserveCredits,
  refundReservedCreditsQuietly,
  settleReservedCredits,
  type CreditReservation,
} from "@/lib/with-credits"
import type { ModelKey } from "@/types"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  let reservation: CreditReservation | null = null
  try {
    const body = await req.json()
    const input = normalizeDifficultyInput(body)
    const requestedModel = typeof body.model === "string" && body.model in ADAPTERS
      ? body.model as ModelKey
      : undefined
    const featureKey = "difficultyAssessment"
    const cost = estimateFeatureCredits(featureKey)
    const guard = await authAndReserveCredits(cost, {
      featureKey,
      source: "api:difficulty-assessment",
      description: getFeaturePrice(featureKey).label,
      metadata: { mode: input.mode, compatibilityRoute: true },
    })
    if (!guard.ok) return guard.response
    reservation = guard.reservation

    const { result } = await runDifficultyAssessment(input, { preferredModel: requestedModel })
    await settleReservedCredits(reservation, cost)
    reservation = null
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    await refundReservedCreditsQuietly(reservation)
    console.error("[difficulty-assessment]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "服务器错误" },
      { status: 500 },
    )
  }
}
