import { NextRequest, NextResponse } from "next/server"
import {
  deletePenetrationHistoryRecord,
  getPenetrationHistoryRecord,
} from "@/lib/penetration/history-store"
import {
  isPenetrationHistoryAccessError,
  requirePenetrationHistoryAccess,
} from "@/lib/penetration/history-access"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
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
      action: "view",
    })
    if (!authorized) {
      return NextResponse.json({ error: "检测历史不存在或已被删除" }, { status: 404 })
    }
    const record = await getPenetrationHistoryRecord(authorized.scope.ownerUserId, historyId)
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
