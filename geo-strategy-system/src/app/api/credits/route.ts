import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { CREDITS_INITIAL, getCredits } from "@/lib/credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const credits = await getCredits(userId)
  return NextResponse.json({ credits, initial: CREDITS_INITIAL })
}
