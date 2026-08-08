import { NextRequest, NextResponse } from "next/server"
import {
  isTeamAccessError,
  requireArticleBatchAccess,
} from "@/lib/article-batches/access"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ batchId: string; itemId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { batchId, itemId } = await context.params
    const authorized = await requireArticleBatchAccess({
      batchId,
      userId: auth.userId,
      action: "view",
    })
    if (!authorized) return NextResponse.json({ error: "文章不存在" }, { status: 404 })
    const item = authorized.batch.items.find(candidate => candidate.id === itemId)
    if (!item) return NextResponse.json({ error: "文章不存在" }, { status: 404 })
    return NextResponse.json({
      id: item.id,
      title: item.title,
      topic: item.topic,
      markdown: item.markdown,
      mediaMarkdown: item.mediaRevision?.markdown,
      mediaPlacements: item.mediaRevision?.placements,
      status: item.status,
      stage: item.stage,
      qualityStatus: item.qualityStatus,
      qualityAudit: item.qualityAudit,
      promptTitle: item.promptTitle,
      model: authorized.batch.model,
      generatedAt: item.generatedAt,
    }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取文章失败" },
      { status: isTeamAccessError(error) ? 403 : 500 },
    )
  }
}
