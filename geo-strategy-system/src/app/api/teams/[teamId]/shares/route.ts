import { NextRequest, NextResponse } from "next/server"
import {
  getTeamEntitlement,
} from "@/lib/team-access"
import {
  hasTeamPermission,
  type TeamShareScope,
} from "@/lib/team-permissions"
import {
  getTeam,
  getTeamMember,
  listTeamMembers,
  saveTeamClientShare,
} from "@/lib/team-store"
import { requireUserId } from "@/lib/with-credits"
import { listWorkspaceClientSummaries } from "@/lib/workspace-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return response
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ teamId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { teamId } = await context.params
    const [team, membership, ownClients, teamMembers] = await Promise.all([
      getTeam(teamId),
      getTeamMember(teamId, auth.userId),
      listWorkspaceClientSummaries(auth.userId),
      listTeamMembers(teamId),
    ])
    if (!team || team.status !== "active" || !membership || membership.status !== "active") {
      throw new Error("团队不存在或当前账号无权访问")
    }
    if (membership.role !== "owner" && !hasTeamPermission(
      membership.permissionKeys,
      "client",
      "manage",
    )) {
      throw new Error("当前账号没有开放客户档案的权限")
    }
    const entitlement = await getTeamEntitlement(team.ownerUserId)
    if (!entitlement.eligible) throw new Error("团队所有者当前未达到 VIP4，团队已进入只读状态")
    const body = await request.json() as {
      clientId?: unknown
      scope?: unknown
      memberUserIds?: unknown
    }
    const clientId = String(body.clientId || "").trim()
    const client = ownClients.find(item => item.id === clientId)
    if (!client) throw new Error("只能开放当前账号所属的客户档案")
    const scope: TeamShareScope = body.scope === "selected" ? "selected" : "all"
    const activeMemberIds = new Set(teamMembers
      .filter(member => member.status === "active")
      .map(member => member.userId))
    const memberUserIds = Array.isArray(body.memberUserIds)
      ? body.memberUserIds
        .map(String)
        .filter(userId => activeMemberIds.has(userId) && userId !== auth.userId)
      : []
    const share = await saveTeamClientShare({
      teamId,
      clientOwnerUserId: auth.userId,
      clientId: client.id,
      clientName: client.name,
      scope,
      memberUserIds,
      operatorUserId: auth.userId,
    })
    return noStore(NextResponse.json({ share }, { status: 201 }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "客户档案共享失败",
    }, { status: 400 }))
  }
}
