import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { listAiProviderPublicSettings } from "@/lib/ai-settings"
import { ARTICLE_PROMPT_OPTIONS } from "@/lib/article-prompt-meta"
import type { AiProviderKey } from "@/types/ai-settings"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const ARTICLE_MODEL_PROVIDERS: AiProviderKey[] = [
  "article",
  "deepseek",
  "qwen",
  "doubao",
  "kimi",
  "ernie",
  "hunyuan",
]

export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const settings = await listAiProviderPublicSettings()
  const providers = ARTICLE_MODEL_PROVIDERS
    .map(key => settings.find(item => item.key === key))
    .filter(Boolean)

  return NextResponse.json(
    { prompts: ARTICLE_PROMPT_OPTIONS, providers },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    }
  )
}
