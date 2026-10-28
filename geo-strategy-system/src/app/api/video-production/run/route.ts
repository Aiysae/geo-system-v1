import { NextRequest, NextResponse } from "next/server"
import { getInternalApiUserId } from "@/lib/internal-api"
import { runVideoProductionItem } from "@/lib/video-production/generate"

export const runtime = "nodejs"
export const maxDuration = 900
export const dynamic = "force-dynamic"

/** Background job endpoint: credits are reserved by the job, so only its signed call is accepted. */
export async function POST(req: NextRequest) {
  if (!getInternalApiUserId(req, "background-job")) {
    return NextResponse.json({ error: "无权调用" }, { status: 403 })
  }
  try {
    const body = await req.json() as { itemId?: string }
    const item = await runVideoProductionItem(String(body.itemId || ""), req.signal)
    return NextResponse.json({ itemId: item.id, status: item.status })
  } catch (error) {
    const message = error instanceof Error ? error.message : "视频生成失败"
    // 422 stops the job runner from replaying a paid generation that already failed for content reasons.
    return NextResponse.json({ error: message }, { status: /超时|timeout/i.test(message) ? 504 : 422 })
  }
}
