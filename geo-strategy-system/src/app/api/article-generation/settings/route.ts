import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { listArticleModelCatalog } from "@/lib/article-models"
import { ARTICLE_PROMPT_OPTIONS } from "@/lib/article-prompt-meta"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { providers, gateways } = await listArticleModelCatalog()

  return NextResponse.json(
    { prompts: ARTICLE_PROMPT_OPTIONS, providers, gateways },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    }
  )
}
