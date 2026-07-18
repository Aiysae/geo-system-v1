import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { getMembershipWithPaymentRepair } from "@/lib/membership"
import { getWorkspaceAccountAccess } from "@/lib/client-accounts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [membership, access] = await Promise.all([
    getMembershipWithPaymentRepair(user.id),
    getWorkspaceAccountAccess(user.id),
  ])
  return NextResponse.json(
    { user, membership, access },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}
