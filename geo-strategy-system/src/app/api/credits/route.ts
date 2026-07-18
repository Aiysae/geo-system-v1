import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { CREDITS_INITIAL, getCreditBalanceSnapshot } from "@/lib/credits"
import { hasUnlimitedCreditAccess, UNLIMITED_CREDITS_BALANCE } from "@/lib/with-credits"
import { getMembershipWithPaymentRepair } from "@/lib/membership"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const membership = await getMembershipWithPaymentRepair(user.id)
  if (hasUnlimitedCreditAccess(user)) {
    return NextResponse.json({
      credits: UNLIMITED_CREDITS_BALANCE,
      initial: CREDITS_INITIAL,
      unlimited: true,
      membership,
      permanentCredits: UNLIMITED_CREDITS_BALANCE,
      monthlyCredits: 0,
    }, { headers: { "Cache-Control": "private, no-store" } })
  }

  const balance = await getCreditBalanceSnapshot(user.id)
  return NextResponse.json(
    {
      credits: balance.total,
      permanentCredits: balance.permanent,
      monthlyCredits: balance.monthly,
      monthlyAllowance: balance.monthlyAllowance,
      monthlyPeriod: balance.monthlyPeriod,
      renewsAt: balance.renewsAt,
      initial: CREDITS_INITIAL,
      unlimited: false,
      membership,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}
