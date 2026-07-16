import { NextResponse } from "next/server"
import { getPenetrationModelReadiness } from "@/lib/penetration/model-readiness"
import { requireUserId } from "@/lib/with-credits"
import type { ModelKey } from "@/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MODELS: ModelKey[] = ["doubao", "deepseek", "qwen", "kimi", "ernie", "hunyuan"]

export async function GET() {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response

  const readiness = await Promise.all(MODELS.map(getPenetrationModelReadiness))
  return NextResponse.json(
    { readiness },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  )
}
