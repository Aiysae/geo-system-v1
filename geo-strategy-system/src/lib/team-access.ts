import "server-only"

import { getUserById } from "@/lib/auth"
import { isAdminUser } from "@/lib/admin"
import {
  getClientAccountLink,
  getClientAccountSourceState,
} from "@/lib/client-accounts"
import {
  hasMembershipTier,
  getMembershipWithPaymentRepair,
} from "@/lib/membership"
import { membershipTeamMemberLimit } from "@/lib/membership-catalog"
import {
  ALL_TEAM_PERMISSIONS,
  hasTeamPermission,
  type TeamModuleKey,
  type TeamPermissionAction,
  type TeamPermissionKey,
} from "@/lib/team-permissions"
import {
  findTeamClientAccess,
  getTeam,
  getTeamMember,
  listTeamMembers,
} from "@/lib/team-store"
import { listWorkspaceClients } from "@/lib/workspace-store"
import type { TeamClientAccess, TeamMemberRecord, TeamRecord } from "@/types/team"

export type TeamEntitlement = {
  eligible: boolean
  memberLimit: number
  tier: string
  reason?: string
}

export type OperationAccessContext = {
  mode: "personal" | "client" | "team"
  actorUserId: string
  dataOwnerUserId: string
  billingUserId: string
  clientId: string
  teamId?: string
  teamName?: string
  permissionKeys: TeamPermissionKey[]
}

export type OperationAccessResult =
  | { ok: true; access: OperationAccessContext }
  | {
      ok: false
      code:
        | "CLIENT_ACCESS_DENIED"
        | "TEAM_ACCESS_DENIED"
        | "TEAM_PERMISSION_DENIED"
        | "TEAM_MEMBERSHIP_REQUIRED"
        | "TEAM_VIP4_REQUIRED"
      message: string
    }

export async function getTeamEntitlement(ownerUserId: string): Promise<TeamEntitlement> {
  const [user, membership] = await Promise.all([
    getUserById(ownerUserId),
    getMembershipWithPaymentRepair(ownerUserId),
  ])
  if (isAdminUser(user)) {
    return {
      eligible: true,
      memberLimit: Math.max(50, membershipTeamMemberLimit(membership.tier)),
      tier: "admin",
    }
  }
  const eligible = hasMembershipTier(membership, "vip4")
  return {
    eligible,
    memberLimit: membershipTeamMemberLimit(membership.tier),
    tier: membership.tier,
    reason: eligible
      ? undefined
      : "VIP4 及以上可以创建和运行团队空间",
  }
}

export async function assertCanCreateTeam(userId: string): Promise<TeamEntitlement> {
  const link = await getClientAccountLink(userId)
  if (link) throw new Error("客户专属账号不能创建或加入内部团队")
  const entitlement = await getTeamEntitlement(userId)
  if (!entitlement.eligible) {
    const error = new Error(entitlement.reason || "VIP4 及以上可以创建团队")
    error.name = "TeamVipRequiredError"
    throw error
  }
  return entitlement
}

export async function requireTeamManager(input: {
  teamId: string
  userId: string
  ownerOnly?: boolean
  requireActiveEntitlement?: boolean
}): Promise<{ team: TeamRecord; member: TeamMemberRecord; entitlement: TeamEntitlement }> {
  const [team, member] = await Promise.all([
    getTeam(input.teamId),
    getTeamMember(input.teamId, input.userId),
  ])
  if (!team || team.status !== "active" || !member || member.status !== "active") {
    throw new Error("团队不存在或当前账号无权访问")
  }
  const canManage = member.role === "owner" || (!input.ownerOnly && member.role === "admin")
  if (!canManage) throw new Error("当前成员没有团队管理权限")
  const entitlement = await getTeamEntitlement(team.ownerUserId)
  if (input.requireActiveEntitlement !== false && !entitlement.eligible) {
    throw new Error("团队所有者当前未达到 VIP4，团队已进入只读状态")
  }
  return { team, member, entitlement }
}

export async function assertTeamSeatAvailable(teamId: string): Promise<TeamEntitlement> {
  const team = await getTeam(teamId)
  if (!team) throw new Error("团队不存在")
  const entitlement = await getTeamEntitlement(team.ownerUserId)
  if (!entitlement.eligible) throw new Error("团队所有者当前未达到 VIP4")
  const activeMembers = (await listTeamMembers(teamId))
    .filter(member => member.status === "active" && member.role !== "owner")
  if (activeMembers.length >= entitlement.memberLimit) {
    throw new Error(`当前等级最多可邀请 ${entitlement.memberLimit} 名团队成员`)
  }
  return entitlement
}

async function personalClientExists(userId: string, clientId: string): Promise<boolean> {
  if (!clientId) return false
  return (await listWorkspaceClients(userId)).some(record => record.client.id === clientId)
}

function teamPermissionDenied(
  module: TeamModuleKey,
  action: TeamPermissionAction,
): OperationAccessResult {
  const actionLabel = {
    view: "查看",
    execute: "执行",
    edit: "编辑",
    export: "导出",
    manage: "管理",
  }[action]
  return {
    ok: false,
    code: "TEAM_PERMISSION_DENIED",
    message: `团队所有者尚未授予当前模块的${actionLabel}权限`,
  }
}

async function teamContextResult(input: {
  teamAccess: TeamClientAccess
  userId: string
  clientId: string
  module: TeamModuleKey
  action: TeamPermissionAction
}): Promise<OperationAccessResult> {
  const entitlement = await getTeamEntitlement(input.teamAccess.team.ownerUserId)
  const writeAction = input.action === "execute"
    || input.action === "edit"
    || input.action === "manage"
  if (!entitlement.eligible && writeAction) {
    return {
      ok: false,
      code: "TEAM_VIP4_REQUIRED",
      message: "团队所有者当前未达到 VIP4，团队暂时只能查看历史数据",
    }
  }
  if (!hasTeamPermission(input.teamAccess.permissionKeys, input.module, input.action)) {
    return teamPermissionDenied(input.module, input.action)
  }
  return {
    ok: true,
    access: {
      mode: "team",
      actorUserId: input.userId,
      dataOwnerUserId: input.teamAccess.share.clientOwnerUserId,
      billingUserId: input.teamAccess.billingUserId,
      clientId: input.clientId,
      teamId: input.teamAccess.team.id,
      teamName: input.teamAccess.team.name,
      permissionKeys: input.teamAccess.permissionKeys,
    },
  }
}

export async function resolveOperationAccess(input: {
  userId: string
  clientId: string
  module: TeamModuleKey
  action: TeamPermissionAction
  teamId?: string
}): Promise<OperationAccessResult> {
  const userId = String(input.userId || "").trim()
  const clientId = String(input.clientId || "").trim()
  if (!userId || !clientId) {
    return {
      ok: false,
      code: "CLIENT_ACCESS_DENIED",
      message: "客户标识缺失，请刷新页面后重试",
    }
  }

  const clientLink = await getClientAccountLink(userId)
  if (clientLink) {
    if (clientLink.status !== "active" || clientLink.clientId !== clientId) {
      return {
        ok: false,
        code: "CLIENT_ACCESS_DENIED",
        message: "该账号只能访问已授权的客户面板",
      }
    }
    const source = await getClientAccountSourceState(clientLink)
    if (!source.ok) {
      return {
        ok: false,
        code: "CLIENT_ACCESS_DENIED",
        message: source.message,
      }
    }
    const permissions = clientLink.permissionKeys
    if (!hasTeamPermission(permissions, input.module, input.action)) {
      return {
        ok: false,
        code: "CLIENT_ACCESS_DENIED",
        message: "客户专属账号在当前功能仅支持查看",
      }
    }
    return {
      ok: true,
      access: {
        mode: "client",
        actorUserId: userId,
        dataOwnerUserId: clientLink.dataOwnerUserId,
        billingUserId: userId,
        clientId,
        permissionKeys: permissions,
      },
    }
  }

  if (input.teamId) {
    const teamAccess = await findTeamClientAccess({
      userId,
      clientId,
      teamId: input.teamId,
    })
    if (!teamAccess) {
      return {
        ok: false,
        code: "TEAM_ACCESS_DENIED",
        message: "该客户没有共享给当前团队成员",
      }
    }
    return teamContextResult({ teamAccess, userId, clientId, module: input.module, action: input.action })
  }

  if (await personalClientExists(userId, clientId)) {
    return {
      ok: true,
      access: {
        mode: "personal",
        actorUserId: userId,
        dataOwnerUserId: userId,
        billingUserId: userId,
        clientId,
        permissionKeys: [...ALL_TEAM_PERMISSIONS],
      },
    }
  }

  const teamAccess = await findTeamClientAccess({ userId, clientId })
  if (teamAccess) {
    return teamContextResult({ teamAccess, userId, clientId, module: input.module, action: input.action })
  }

  return {
    ok: false,
    code: "CLIENT_ACCESS_DENIED",
    message: "客户不存在或当前账号无权访问",
  }
}

export async function requireOperationAccess(input: {
  userId: string
  clientId: string
  module: TeamModuleKey
  action: TeamPermissionAction
  teamId?: string
}): Promise<OperationAccessContext> {
  const result = await resolveOperationAccess(input)
  if (!result.ok) {
    const error = new Error(result.message)
    error.name = result.code
    throw error
  }
  return result.access
}

export function isOperationAccessError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name.startsWith("TEAM_")
    || error.name.startsWith("CLIENT_")
    || /权限|无权|只读|VIP4/.test(error.message)
}
