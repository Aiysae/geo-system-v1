import { NextRequest, NextResponse } from "next/server"
import { resolveWorkspaceAccess } from "@/lib/client-accounts"
import {
  deleteClientExecutionAction,
  saveClientExecutionAction,
} from "@/lib/client-feedback/store"
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
    const access = await resolveWorkspaceAccess(auth.userId, clientId)
    if (!access.ok) throw new Error(access.message)
    if (access.mode !== "standard") {
      return NextResponse.json({ error: "客户专属账号不能编辑动作记录" }, { status: 403 })
    }
    const body = await request.json() as { action?: Record<string, unknown> }
    const action = await saveClientExecutionAction({
      ownerUserId: access.ownerUserId,
      clientId,
      actorUserId: auth.userId,
      value: body.action || {},
    })
    return NextResponse.json({ action }, { status: 201 })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "动作记录保存失败",
    }, { status: 400 })
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
    const access = await resolveWorkspaceAccess(auth.userId, clientId)
    if (!access.ok) throw new Error(access.message)
    if (access.mode !== "standard") {
      return NextResponse.json({ error: "客户专属账号不能删除动作记录" }, { status: 403 })
    }
    const actionId = request.nextUrl.searchParams.get("actionId") || ""
    const deleted = await deleteClientExecutionAction(access.ownerUserId, clientId, actionId)
    return NextResponse.json({ ok: deleted })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "动作记录删除失败",
    }, { status: 400 })
  }
}
