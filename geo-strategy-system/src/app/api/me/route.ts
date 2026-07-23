import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { isAdminUser } from "@/lib/admin"
import { getMembershipWithPaymentRepair } from "@/lib/membership"
import { getWorkspaceAccountAccess } from "@/lib/client-accounts"
import {
  getOnboardingState,
  shouldAutoLaunchOnboarding,
} from "@/lib/onboarding"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [membership, access, onboardingState] = await Promise.all([
    getMembershipWithPaymentRepair(user.id),
    getWorkspaceAccountAccess(user.id),
    getOnboardingState(user.id),
  ])
  return NextResponse.json(
    {
      user,
      membership,
      access,
      isAdmin: isAdminUser(user),
      onboarding: {
        state: onboardingState,
        autoLaunch: shouldAutoLaunchOnboarding({
          userCreatedAt: user.createdAt,
          state: onboardingState,
        }),
      },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}
