import { NextRequest, NextResponse } from "next/server"
import { getOwnedStoredArticleBatch } from "@/lib/article-batches/store"
import { requireUserId } from "@/lib/with-credits"
import { resolveWorkspaceAccess } from "@/lib/client-accounts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ batchId: string; itemId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  const { batchId, itemId } = await context.params
  const access = await resolveWorkspaceAccess(auth.userId)
  if (!access.ok) {
    return NextResponse.json({ error: access.message, code: access.code }, { status: 403 })
  }
  const batch = await getOwnedStoredArticleBatch(batchId, access.ownerUserId)
  if (batch && access.mode === "client" && batch.clientId !== access.clientId) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 })
  }
  const item = batch?.items.find(candidate => candidate.id === itemId)
  if (!batch || !item) return NextResponse.json({ error: "文章不存在" }, { status: 404 })
  return NextResponse.json({
    id: item.id,
    title: item.title,
    topic: item.topic,
    markdown: item.markdown,
    status: item.status,
    generatedAt: item.generatedAt,
  }, { headers: { "Cache-Control": "no-store" } })
}
