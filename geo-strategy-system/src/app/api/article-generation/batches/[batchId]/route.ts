import { NextRequest, NextResponse } from "next/server"
import {
  cancelArticleBatch,
  getArticleBatch,
  retryFailedArticleBatchItems,
} from "@/lib/article-batches/manager"
import { requireUserId } from "@/lib/with-credits"
import {
  requireStandardAccountMode,
  resolveWorkspaceAccess,
} from "@/lib/client-accounts"

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
  const access = await resolveWorkspaceAccess(auth.userId)
  if (!access.ok) {
    return NextResponse.json({ error: access.message, code: access.code }, { status: 403 })
  }
  const batch = await getArticleBatch(batchId, access.ownerUserId)
  if (batch && access.mode === "client" && batch.clientId !== access.clientId) {
    return NextResponse.json({ error: "批量任务不存在" }, { status: 404 })
  }
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
  const accountAccess = await requireStandardAccountMode(auth.userId)
  if (!accountAccess.ok) {
    return NextResponse.json(
      { error: accountAccess.message, code: "CLIENT_ACCOUNT_READ_ONLY" },
      { status: 403 },
    )
  }
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
