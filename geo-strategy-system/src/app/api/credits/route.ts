import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { CREDITS_INITIAL, getCredits } from "@/lib/credits"
import { hasUnlimitedCreditAccess, UNLIMITED_CREDITS_BALANCE } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (hasUnlimitedCreditAccess(user)) {
    return NextResponse.json({
      credits: UNLIMITED_CREDITS_BALANCE,
      initial: CREDITS_INITIAL,
      unlimited: true,
    })
  }

  const credits = await getCredits(user.id)
  return NextResponse.json({ credits, initial: CREDITS_INITIAL, unlimited: false })
}
