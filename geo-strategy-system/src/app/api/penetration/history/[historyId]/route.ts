import { NextRequest, NextResponse } from "next/server"
import {
  deletePenetrationHistoryRecord,
  getPenetrationHistoryRecord,
} from "@/lib/penetration/history-store"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ historyId: string }> },
) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response
  const { historyId } = await context.params
  const record = await getPenetrationHistoryRecord(userGuard.userId, historyId)
  if (!record) {
    return NextResponse.json({ error: "检测历史不存在或已被删除" }, { status: 404 })
  }
  return NextResponse.json(record, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  })
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ historyId: string }> },
) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response
  const { historyId } = await context.params
  const deleted = await deletePenetrationHistoryRecord(userGuard.userId, historyId)
  if (!deleted) {
    return NextResponse.json({ error: "检测历史不存在或已被删除" }, { status: 404 })
  }
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  )
}
