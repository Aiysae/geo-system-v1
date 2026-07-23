import { NextResponse } from "next/server"
import {
  getOnboardingState,
  updateOnboardingState,
} from "@/lib/onboarding"
import { requireUserId } from "@/lib/with-credits"
import type { OnboardingAction } from "@/types/onboarding"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ACTIONS = new Set<OnboardingAction>([
  "start",
  "progress",
  "complete",
  "dismiss",
  "reset",
])

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store")
  return response
}

export async function GET() {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  return noStore(NextResponse.json({
    state: await getOnboardingState(auth.userId),
  }))
}

export async function PATCH(request: Request) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response

  try {
    const body = await request.json()
    const action = typeof body?.action === "string"
      ? body.action as OnboardingAction
      : null
    if (!action || !ACTIONS.has(action)) {
      return noStore(NextResponse.json(
        { error: "新手教程操作无效" },
        { status: 400 },
      ))
    }

    const state = await updateOnboardingState({
      userId: auth.userId,
      action,
      currentStep: body?.currentStep,
      subjectType: body?.subjectType === "person" ? "person" : "brand",
    })
    return noStore(NextResponse.json({ state }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "新手教程进度保存失败",
    }, { status: 400 }))
  }
}
