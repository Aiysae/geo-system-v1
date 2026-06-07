import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { CREDITS_INITIAL, getCredits } from "@/lib/credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const credits = await getCredits(user.id)
  return NextResponse.json({ credits, initial: CREDITS_INITIAL })
}
