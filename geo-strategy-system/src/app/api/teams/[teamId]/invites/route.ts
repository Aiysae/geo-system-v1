import { NextRequest, NextResponse } from "next/server"
import {
  getUserByEmail,
  getUserById,
} from "@/lib/auth"
import { getClientAccountLink } from "@/lib/client-accounts"
import {
  assertTeamSeatAvailable,
  requireTeamManager,
} from "@/lib/team-access"
import {
  TEAM_PERMISSION_PRESETS,
  normalizeTeamPermissions,
  permissionsForPreset,
  type TeamPermissionPresetKey,
} from "@/lib/team-permissions"
import {
  createTeamInvite,
  getTeamMember,
  listTeamInvites,
  listTeamMembers,
} from "@/lib/team-store"
import {
  sendTeamInviteEmail,
  teamInviteUrl,
} from "@/lib/team-notifications"
import { requireUserId } from "@/lib/with-credits"
import type { TeamInviteRecord } from "@/types/team"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return response
}

function publicInvite(invite: TeamInviteRecord): Omit<TeamInviteRecord, "tokenHash"> {
  const safe = { ...invite } as Partial<TeamInviteRecord>
  delete safe.tokenHash
  return safe as Omit<TeamInviteRecord, "tokenHash">
}

function validPreset(value: unknown): TeamPermissionPresetKey {
  const key = String(value || "")
  return TEAM_PERMISSION_PRESETS.some(preset => preset.key === key)
    ? key as TeamPermissionPresetKey
    : "viewer"
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ teamId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { teamId } = await context.params
    const manager = await requireTeamManager({ teamId, userId: auth.userId })
    const body = await request.json() as {
      email?: unknown
      role?: unknown
      preset?: unknown
      permissionKeys?: unknown
    }
    const email = String(body.email || "").trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("请输入有效的成员邮箱")
    const role = body.role === "admin" ? "admin" : "member"
    if (role === "admin" && manager.member.role !== "owner") {
      throw new Error("只有团队所有者可以邀请团队管理员")
    }

    const [members, invites, existingUser] = await Promise.all([
      listTeamMembers(teamId),
      listTeamInvites(teamId),
      getUserByEmail(email),
    ])
    const activeSeatCount = members.filter(member => (
      member.status === "active" && member.role !== "owner"
    )).length
    const pendingInviteCount = invites.filter(invite => (
      invite.status === "pending" && Date.parse(invite.expiresAt) > Date.now()
    )).length
    if (activeSeatCount + pendingInviteCount >= manager.entitlement.memberLimit) {
      throw new Error(`当前等级最多可配置 ${manager.entitlement.memberLimit} 个团队成员名额`)
    }
    if (invites.some(invite => invite.email === email && invite.status === "pending")) {
      throw new Error("该邮箱已有待接受的团队邀请")
    }
    if (existingUser) {
      if (await getClientAccountLink(existingUser.id)) {
        throw new Error("客户专属账号不能加入内部团队，请使用独立账号")
      }
      const existingMember = await getTeamMember(teamId, existingUser.id)
      if (existingMember?.status === "active") throw new Error("该账号已经是团队成员")
    }

    await assertTeamSeatAvailable(teamId)
    const permissionKeys = Array.isArray(body.permissionKeys)
      ? normalizeTeamPermissions(body.permissionKeys)
      : permissionsForPreset(validPreset(body.preset))
    const { invite, token } = await createTeamInvite({
      teamId,
      email,
      role,
      permissionKeys,
      operatorUserId: auth.userId,
    })
    const inviter = await getUserById(auth.userId)
    let emailSent = true
    let emailWarning = ""
    try {
      await sendTeamInviteEmail({
        to: invite.email,
        teamName: manager.team.name,
        inviterName: inviter?.name || inviter?.email || "团队管理员",
        token,
        expiresAt: invite.expiresAt,
      })
    } catch (error) {
      emailSent = false
      emailWarning = error instanceof Error ? error.message : "邀请邮件发送失败"
      console.error("[team-invite] email delivery failed", error)
    }
    return noStore(NextResponse.json({
      invite: publicInvite(invite),
      inviteUrl: teamInviteUrl(token),
      emailSent,
      emailWarning,
    }, { status: 201 }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "团队邀请创建失败",
    }, { status: 400 }))
  }
}
