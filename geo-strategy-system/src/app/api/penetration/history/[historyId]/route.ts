import { NextRequest, NextResponse } from "next/server"
import {
  deletePenetrationHistoryRecord,
  getPenetrationHistoryModelAnswers,
  getPenetrationHistoryOverviewRecord,
  getPenetrationHistoryRecord,
} from "@/lib/penetration/history-store"
import {
  isPenetrationHistoryAccessError,
  getPenetrationHistoryViewerPolicy,
  requirePenetrationHistoryAccess,
} from "@/lib/penetration/history-access"
import { requireUserId } from "@/lib/with-credits"
import type { ModelKey } from "@/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MODEL_KEYS = new Set<ModelKey>([
  "doubao",
  "deepseek",
  "qwen",
  "kimi",
  "ernie",
  "hunyuan",
])

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ historyId: string }> },
) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response
  try {
    const { historyId } = await context.params
    const authorized = await requirePenetrationHistoryAccess({
      historyId,
      userId: userGuard.userId,
      action: "view",
    })
    if (!authorized) {
      return NextResponse.json({ error: "检测历史不存在或已被删除" }, { status: 404 })
    }
    const overview = await getPenetrationHistoryOverviewRecord(
      authorized.scope.ownerUserId,
      historyId,
    )
    if (!overview) {
      return NextResponse.json({ error: "检测历史不存在或已被删除" }, { status: 404 })
    }
    const viewerPolicy = await getPenetrationHistoryViewerPolicy({
      userId: userGuard.userId,
      access: authorized.access,
      record: overview,
    })
    if (!viewerPolicy.visible) {
      return NextResponse.json({ error: "该检测报告尚未向当前客户开放" }, { status: 403 })
    }
    const view = String(request.nextUrl.searchParams.get("view") || "full").trim()
    if (view === "answers") {
      if (!viewerPolicy.canViewRawAnswers) {
        return NextResponse.json({
          error: "当前账号仅可查看报告数据概览",
        }, { status: 403 })
      }
      const model = String(request.nextUrl.searchParams.get("model") || "") as ModelKey
      if (!MODEL_KEYS.has(model)) {
        return NextResponse.json({ error: "请选择有效的检测模型" }, { status: 400 })
      }
      const items = await getPenetrationHistoryModelAnswers(
        authorized.scope.ownerUserId,
        historyId,
        model,
      )
      if (!items) {
        return NextResponse.json({ error: "检测历史不存在或已被删除" }, { status: 404 })
      }
      return NextResponse.json({ model, items }, {
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      })
    }
    const record = view === "overview" || !viewerPolicy.canViewRawAnswers
      ? overview
      : await getPenetrationHistoryRecord(authorized.scope.ownerUserId, historyId)
    if (!record) {
      return NextResponse.json({ error: "检测历史不存在或已被删除" }, { status: 404 })
    }
    return NextResponse.json(record, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取检测历史失败" },
      { status: isPenetrationHistoryAccessError(error) ? 403 : 500 },
    )
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ historyId: string }> },
) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response
  try {
    const { historyId } = await context.params
    const authorized = await requirePenetrationHistoryAccess({
      historyId,
      userId: userGuard.userId,
      action: "manage",
    })
    if (!authorized) {
      return NextResponse.json({ error: "检测历史不存在或已被删除" }, { status: 404 })
    }
    const deleted = await deletePenetrationHistoryRecord(authorized.scope.ownerUserId, historyId)
    if (!deleted) {
      return NextResponse.json({ error: "检测历史不存在或已被删除" }, { status: 404 })
    }
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除检测历史失败" },
      { status: isPenetrationHistoryAccessError(error) ? 403 : 500 },
    )
  }
}
