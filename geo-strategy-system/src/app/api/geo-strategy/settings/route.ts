import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { listAiProviderPublicSettings } from "@/lib/ai-settings"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const settings = await listAiProviderPublicSettings()
  const keywordStrategy = settings.find(item => item.key === "keywordStrategy")

  return NextResponse.json(
    { keywordStrategy },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    }
  )
}
