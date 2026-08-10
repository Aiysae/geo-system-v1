import { NextRequest, NextResponse } from "next/server"
import {
  deleteClientExecutionAction,
  deleteClientExecutionActionBatch,
  saveClientExecutionAction,
} from "@/lib/client-feedback/store"
import { requireOperationAccess } from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId } = await context.params
    const body = await request.json() as { action?: Record<string, unknown>; teamId?: unknown }
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      module: "feedback",
      action: "edit",
      teamId: typeof body.teamId === "string" ? body.teamId : undefined,
    })
    const action = await saveClientExecutionAction({
      ownerUserId: access.dataOwnerUserId,
      clientId: access.clientId,
      actorUserId: auth.userId,
      value: body.action || {},
    })
    return NextResponse.json({ action }, { status: 201 })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "动作记录保存失败",
    }, { status: 403 })
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId } = await context.params
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      module: "feedback",
      action: "manage",
    })
    const importBatchId = request.nextUrl.searchParams.get("importBatchId") || ""
    if (importBatchId) {
      const deletedCount = await deleteClientExecutionActionBatch(
        access.dataOwnerUserId,
        access.clientId,
        importBatchId,
      )
      return NextResponse.json({ ok: deletedCount > 0, deletedCount })
    }
    const actionId = request.nextUrl.searchParams.get("actionId") || ""
    const deleted = await deleteClientExecutionAction(
      access.dataOwnerUserId,
      access.clientId,
      actionId,
    )
    return NextResponse.json({ ok: deleted })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "动作记录删除失败",
    }, { status: 403 })
  }
}
