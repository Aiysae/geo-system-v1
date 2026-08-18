import { NextRequest, NextResponse } from "next/server"
import {
  deleteClientExecutionAction,
  deleteClientExecutionActionBatch,
  getClientExecutionAction,
  listClientExecutionActions,
  saveClientExecutionAction,
} from "@/lib/client-feedback/store"
import {
  isPublicationExecutionAction,
  reconcilePublishingEvidenceActions,
} from "@/lib/publishing-plan/evidence-reconciliation"
import { reopenPublishingTaskByExecutionAction } from "@/lib/publishing-plan/store"
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
    let action = await saveClientExecutionAction({
      ownerUserId: access.dataOwnerUserId,
      clientId: access.clientId,
      actorUserId: auth.userId,
      value: body.action || {},
    })
    if (isPublicationExecutionAction(action)) {
      const reconciled = await reconcilePublishingEvidenceActions({
        ownerUserId: access.dataOwnerUserId,
        clientId: access.clientId,
        actorUserId: auth.userId,
        actions: [action],
      })
      action = reconciled.actions[0] || action
    }
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
      teamId: request.nextUrl.searchParams.get("teamId") || undefined,
    })
    const importBatchId = request.nextUrl.searchParams.get("importBatchId") || ""
    if (importBatchId) {
      const actionIds = (await listClientExecutionActions(access.dataOwnerUserId, access.clientId))
        .filter(action => action.importBatchId === importBatchId)
        .map(action => action.id)
      const deletedCount = await deleteClientExecutionActionBatch(
        access.dataOwnerUserId,
        access.clientId,
        importBatchId,
      )
      await Promise.all(actionIds.map(executionActionId => reopenPublishingTaskByExecutionAction({
        ownerUserId: access.dataOwnerUserId,
        clientId: access.clientId,
        executionActionId,
      })))
      return NextResponse.json({ ok: deletedCount > 0, deletedCount })
    }
    const actionId = request.nextUrl.searchParams.get("actionId") || ""
    const existing = await getClientExecutionAction(
      access.dataOwnerUserId,
      access.clientId,
      actionId,
    )
    const deleted = await deleteClientExecutionAction(
      access.dataOwnerUserId,
      access.clientId,
      actionId,
    )
    if (deleted && existing?.publicationReconciliation?.taskId) {
      await reopenPublishingTaskByExecutionAction({
        ownerUserId: access.dataOwnerUserId,
        clientId: access.clientId,
        executionActionId: actionId,
      })
    }
    return NextResponse.json({ ok: deleted })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "动作记录删除失败",
    }, { status: 403 })
  }
}
