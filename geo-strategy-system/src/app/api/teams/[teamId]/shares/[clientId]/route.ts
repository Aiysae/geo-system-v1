import { NextRequest, NextResponse } from "next/server"
import {
  getTeamEntitlement,
} from "@/lib/team-access"
import {
  hasTeamPermission,
  type TeamShareScope,
} from "@/lib/team-permissions"
import {
  deleteTeamClientShare,
  getTeam,
  getTeamMember,
  listTeamClientShares,
  listTeamMembers,
  saveTeamClientShare,
} from "@/lib/team-store"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return response
}

async function requireShareOwner(teamId: string, userId: string, clientId: string) {
  const [team, member, shares] = await Promise.all([
    getTeam(teamId),
    getTeamMember(teamId, userId),
    listTeamClientShares(teamId),
  ])
  if (!team || team.status !== "active" || !member || member.status !== "active") {
    throw new Error("团队不存在或当前账号无权访问")
  }
  if (member.role !== "owner" && !hasTeamPermission(member.permissionKeys, "client", "manage")) {
    throw new Error("当前账号没有管理客户共享的权限")
  }
  const entitlement = await getTeamEntitlement(team.ownerUserId)
  if (!entitlement.eligible) throw new Error("团队所有者当前未达到 VIP4，团队已进入只读状态")
  const share = shares.find(item => (
    item.clientId === clientId && item.clientOwnerUserId === userId
  ))
  if (!share) throw new Error("只能管理当前账号自己开放的客户档案")
  return share
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ teamId: string; clientId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { teamId, clientId: encodedClientId } = await context.params
    const clientId = decodeURIComponent(encodedClientId)
    const share = await requireShareOwner(teamId, auth.userId, clientId)
    const body = await request.json() as { scope?: unknown; memberUserIds?: unknown }
    const scope: TeamShareScope = body.scope === "selected" ? "selected" : "all"
    const members = await listTeamMembers(teamId)
    const activeMemberIds = new Set(members
      .filter(member => member.status === "active")
      .map(member => member.userId))
    const memberUserIds = Array.isArray(body.memberUserIds)
      ? body.memberUserIds
        .map(String)
        .filter(userId => activeMemberIds.has(userId) && userId !== auth.userId)
      : []
    const next = await saveTeamClientShare({
      teamId,
      clientOwnerUserId: auth.userId,
      clientId: share.clientId,
      clientName: share.clientName,
      scope,
      memberUserIds,
      operatorUserId: auth.userId,
    })
    return noStore(NextResponse.json({ share: next }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "客户共享更新失败",
    }, { status: 400 }))
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ teamId: string; clientId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { teamId, clientId: encodedClientId } = await context.params
    const clientId = decodeURIComponent(encodedClientId)
    await requireShareOwner(teamId, auth.userId, clientId)
    const removed = await deleteTeamClientShare({
      teamId,
      clientOwnerUserId: auth.userId,
      clientId,
      operatorUserId: auth.userId,
    })
    return noStore(NextResponse.json({ removed }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "取消客户共享失败",
    }, { status: 400 }))
  }
}
