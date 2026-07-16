import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
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
  return NextResponse.json(
    { user, membership },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}
