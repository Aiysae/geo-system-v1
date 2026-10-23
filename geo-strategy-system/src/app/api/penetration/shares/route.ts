import { NextRequest, NextResponse } from "next/server"
import { isOperationAccessError, requireOperationAccess } from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"
import { listWorkspaceClients } from "@/lib/workspace-store"
import {
  createPenetrationShare,
  listPenetrationShares,
  PenetrationShareError,
  revokePenetrationShare,
} from "@/lib/penetration/share-store"

// Share links for a client's detection results. Viewing them is public; making,
// listing and turning them off takes the right to run detection.

function failure(error: unknown, fallback: string) {
  const status = error instanceof PenetrationShareError
    ? error.status
    : isOperationAccessError(error)
      ? 403
      : 400
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status })
}

async function access(userId: string, clientId: unknown, teamId: unknown) {
  const id = String(clientId || "").trim()
  if (!id) throw new PenetrationShareError("客户标识缺失，请刷新页面后重试")
  return requireOperationAccess({
    userId,
    clientId: id,
    module: "penetration",
    action: "execute",
    teamId: String(teamId || "").trim() || undefined,
  })
}

export async function GET(req: NextRequest) {
  try {
    const userGuard = await requireUserId()
    if (!userGuard.ok) return userGuard.response
    const params = req.nextUrl.searchParams
    const context = await access(userGuard.userId, params.get("clientId"), params.get("teamId"))
    return NextResponse.json({ shares: await listPenetrationShares(context.dataOwnerUserId, context.clientId) })
  } catch (error) {
    return failure(error, "分享链接读取失败")
  }
}

export async function POST(req: NextRequest) {
  try {
    const userGuard = await requireUserId()
    if (!userGuard.ok) return userGuard.response
    const body = await req.json().catch(() => ({})) as { clientId?: unknown; teamId?: unknown }
    const context = await access(userGuard.userId, body.clientId, body.teamId)
    const client = (await listWorkspaceClients(context.dataOwnerUserId))
      .find(item => item.client.id === context.clientId)?.client
    if (!client) throw new PenetrationShareError("当前客户不存在或已被删除，请刷新页面后重试", 404)
    const share = await createPenetrationShare({
      ownerUserId: context.dataOwnerUserId,
      createdByUserId: userGuard.userId,
      client,
    })
    return NextResponse.json({ share }, { status: 201 })
  } catch (error) {
    return failure(error, "分享链接生成失败")
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userGuard = await requireUserId()
    if (!userGuard.ok) return userGuard.response
    const params = req.nextUrl.searchParams
    const context = await access(userGuard.userId, params.get("clientId"), params.get("teamId"))
    const revoked = await revokePenetrationShare({
      ownerUserId: context.dataOwnerUserId,
      clientId: context.clientId,
      token: String(params.get("token") || ""),
    })
    if (!revoked) throw new PenetrationShareError("分享链接不存在或已关闭", 404)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return failure(error, "分享链接关闭失败")
  }
}
