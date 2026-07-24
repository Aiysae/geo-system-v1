import { NextRequest, NextResponse } from "next/server"
import { getUserById } from "@/lib/auth"
import {
  getTeamEntitlement,
  requireTeamManager,
} from "@/lib/team-access"
import {
  getTeam,
  getTeamMember,
  listTeamAudit,
  listTeamClientShares,
  listTeamInvites,
  listTeamMembers,
  updateTeam,
} from "@/lib/team-store"
import { requireUserId } from "@/lib/with-credits"
import { listWorkspaceClientSummaries } from "@/lib/workspace-store"
import type { TeamClientShareRecord, TeamInviteRecord } from "@/types/team"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return response
}

function visibleShares(
  shares: TeamClientShareRecord[],
  userId: string,
  canManage: boolean,
): TeamClientShareRecord[] {
  if (canManage) return shares
  return shares.filter(share => (
    share.clientOwnerUserId === userId
      || share.scope === "all"
      || share.memberUserIds.includes(userId)
  ))
}

function publicInvite(invite: TeamInviteRecord): Omit<TeamInviteRecord, "tokenHash"> {
  const safe = { ...invite } as Partial<TeamInviteRecord>
  delete safe.tokenHash
  return safe as Omit<TeamInviteRecord, "tokenHash">
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ teamId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { teamId } = await context.params
    const [team, membership] = await Promise.all([
      getTeam(teamId),
      getTeamMember(teamId, auth.userId),
    ])
    if (!team || !membership || membership.status !== "active") {
      return noStore(NextResponse.json({ error: "团队不存在或当前账号无权访问" }, { status: 403 }))
    }
    const canManageTeam = membership.role === "owner" || membership.role === "admin"
    const [memberRecords, allShares, entitlement, ownClients, invites, audit] = await Promise.all([
      listTeamMembers(teamId),
      listTeamClientShares(teamId),
      getTeamEntitlement(team.ownerUserId),
      listWorkspaceClientSummaries(auth.userId),
      canManageTeam ? listTeamInvites(teamId) : Promise.resolve([]),
      canManageTeam ? listTeamAudit(teamId, 80) : Promise.resolve([]),
    ])
    const members = await Promise.all(memberRecords.map(async member => {
      const user = await getUserById(member.userId)
      return {
        ...member,
        name: user?.name || "已停用账号",
        email: user?.email || "",
      }
    }))
    const ownerNames = new Map<string, string>()
    await Promise.all(Array.from(new Set(allShares.map(share => share.clientOwnerUserId))).map(async userId => {
      const user = await getUserById(userId)
      ownerNames.set(userId, user?.name || user?.email || "团队成员")
    }))
    const shares = visibleShares(allShares, auth.userId, canManageTeam).map(share => ({
      ...share,
      ownerName: ownerNames.get(share.clientOwnerUserId) || "团队成员",
    }))
    return noStore(NextResponse.json({
      team,
      membership,
      members,
      shares,
      invites: invites.map(publicInvite),
      audit,
      entitlement,
      canManageTeam,
      canArchiveTeam: membership.role === "owner",
      ownClients,
    }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "团队详情读取失败",
    }, { status: 500 }))
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ teamId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { teamId } = await context.params
    await requireTeamManager({
      teamId,
      userId: auth.userId,
      ownerOnly: true,
      requireActiveEntitlement: false,
    })
    const body = await request.json() as { name?: unknown; status?: unknown }
    const status = body.status === "archived" ? "archived" : undefined
    const name = body.name === undefined
      ? undefined
      : String(body.name || "").trim().slice(0, 80)
    const team = await updateTeam({
      teamId,
      actorUserId: auth.userId,
      name,
      status,
    })
    return noStore(NextResponse.json({ team }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "团队更新失败",
    }, { status: 400 }))
  }
}
