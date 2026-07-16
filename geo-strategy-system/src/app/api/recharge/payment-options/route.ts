import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { publicPaymentOptions } from "@/lib/payment-config"
import { RECHARGE_PACKAGES } from "@/lib/pricing"
import { getFirstPurchaseBlockReasonForUser } from "@/lib/recharge-eligibility"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const user = await getCurrentUser()
  const introPackage = RECHARGE_PACKAGES.find(item => item.firstPurchaseOnly)
  const firstPurchase = {
    available: false,
    reason: "signed_out" as "signed_out" | "completed_purchase" | "active_intro_order" | null,
  }

  if (user && introPackage) {
    const reason = await getFirstPurchaseBlockReasonForUser(user.id, introPackage.key)
    firstPurchase.available = reason === null
    firstPurchase.reason = reason
  }

  return NextResponse.json({
    ...publicPaymentOptions(),
    firstPurchase,
  }, {
    headers: { "Cache-Control": "private, no-store" },
  })
}
