import { NextRequest, NextResponse } from "next/server"
import {
  deletePenetrationHistoryRecord,
  getPenetrationHistoryRecord,
} from "@/lib/penetration/history-store"
import { requireUserId } from "@/lib/with-credits"
import { resolveWorkspaceAccess } from "@/lib/client-accounts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ historyId: string }> },
) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response
  const { historyId } = await context.params
  const access = await resolveWorkspaceAccess(userGuard.userId)
  if (!access.ok) {
    return NextResponse.json({ error: access.message, code: access.code }, { status: 403 })
  }
  const record = await getPenetrationHistoryRecord(access.ownerUserId, historyId)
  if (record && access.mode === "client" && record.clientId !== access.clientId) {
    return NextResponse.json({ error: "检测历史不存在或无权查看" }, { status: 404 })
  }
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
  const access = await resolveWorkspaceAccess(userGuard.userId)
  if (!access.ok || access.mode === "client") {
    return NextResponse.json({
      error: access.ok ? "客户专属账号不能删除检测历史" : access.message,
      code: "CLIENT_ACCOUNT_READ_ONLY",
    }, { status: 403 })
  }
  const deleted = await deletePenetrationHistoryRecord(access.ownerUserId, historyId)
  if (!deleted) {
    return NextResponse.json({ error: "检测历史不存在或已被删除" }, { status: 404 })
  }
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  )
}
