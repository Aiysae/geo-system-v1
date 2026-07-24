import { NextRequest, NextResponse } from "next/server"
import {
  cancelArticleBatch,
  deleteArticleBatch,
  getArticleBatch,
  restartArticleBatch,
  retryFailedArticleBatchItems,
} from "@/lib/article-batches/manager"
import {
  isTeamAccessError,
  requireArticleBatchAccess,
} from "@/lib/article-batches/access"
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
  try {
    const { batchId } = await context.params
    const authorized = await requireArticleBatchAccess({
      batchId,
      userId: auth.userId,
      action: "view",
    })
    if (!authorized) return NextResponse.json({ error: "批量任务不存在" }, { status: 404 })
    const batch = await getArticleBatch(batchId, auth.userId)
    if (!batch) return NextResponse.json({ error: "批量任务不存在" }, { status: 404 })
    return NextResponse.json(batch, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取批量任务失败" },
      { status: isTeamAccessError(error) ? 403 : 500 },
    )
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ batchId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { batchId } = await context.params
    const authorized = await requireArticleBatchAccess({
      batchId,
      userId: auth.userId,
      action: "manage",
    })
    if (!authorized) return NextResponse.json({ error: "批量任务不存在" }, { status: 404 })
    const result = await deleteArticleBatch(batchId, auth.userId)
    if (result === "not_found") {
      return NextResponse.json({ error: "批量任务不存在" }, { status: 404 })
    }
    if (result === "active") {
      return NextResponse.json({ error: "批量任务仍在进行，请先停止任务再删除" }, { status: 409 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除批量任务失败" },
      { status: isTeamAccessError(error) ? 403 : 500 },
    )
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ batchId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { batchId } = await context.params
    const authorized = await requireArticleBatchAccess({
      batchId,
      userId: auth.userId,
      action: "execute",
    })
    if (!authorized) return NextResponse.json({ error: "批量任务不存在" }, { status: 404 })
    const body = await req.json().catch(() => ({})) as { action?: string; requestId?: string }
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
    if (body.action === "restart") {
      const requestId = String(body.requestId || "").trim()
      if (!/^[A-Za-z0-9_-]{16,160}$/.test(requestId)) {
        return NextResponse.json({ error: "重新生成请求编号无效，请刷新后重试" }, { status: 400 })
      }
      const result = await restartArticleBatch(batchId, auth.userId, requestId)
      if (!result.ok) return result.response
      return NextResponse.json(result.batch, { status: result.reused ? 200 : 202 })
    }
    return NextResponse.json({ error: "批量任务操作无效" }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "操作批量任务失败" },
      { status: isTeamAccessError(error) ? 403 : 500 },
    )
  }
}
