import { NextRequest, NextResponse } from "next/server"
import {
  cancelArticleBatch,
  getArticleBatch,
  retryFailedArticleBatchItems,
} from "@/lib/article-batches/manager"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ batchId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  const { batchId } = await context.params
  const batch = await getArticleBatch(batchId, auth.userId)
  if (!batch) return NextResponse.json({ error: "批量任务不存在" }, { status: 404 })
  return NextResponse.json(batch, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  })
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ batchId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  const { batchId } = await context.params
  const body = await req.json().catch(() => ({})) as { action?: string }
  if (body.action === "cancel") {
    const batch = await cancelArticleBatch(batchId, auth.userId)
    if (!batch) return NextResponse.json({ error: "批量任务不存在" }, { status: 404 })
    return NextResponse.json(batch)
  }
  if (body.action === "retryFailed") {
    const result = await retryFailedArticleBatchItems(batchId, auth.userId)
    if (!result.ok) return result.response
    return NextResponse.json(result.batch, { status: result.reused ? 200 : 202 })
  }
  return NextResponse.json({ error: "批量任务操作无效" }, { status: 400 })
}
