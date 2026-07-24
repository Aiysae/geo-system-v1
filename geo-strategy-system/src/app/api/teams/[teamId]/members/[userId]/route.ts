import { NextRequest, NextResponse } from "next/server"
import {
  assertTeamSeatAvailable,
  requireTeamManager,
} from "@/lib/team-access"
import {
  normalizeTeamPermissions,
  type TeamMemberStatus,
} from "@/lib/team-permissions"
import {
  getTeamMember,
  removeTeamMember,
  saveTeamMember,
} from "@/lib/team-store"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return response
}

async function managerAndTarget(teamId: string, actorUserId: string, targetUserId: string) {
  const manager = await requireTeamManager({ teamId, userId: actorUserId })
  const target = await getTeamMember(teamId, targetUserId)
  if (!target) throw new Error("团队成员不存在")
  if (target.role === "owner") throw new Error("不能修改团队所有者")
  if (manager.member.role === "admin" && target.role === "admin") {
    throw new Error("团队管理员不能修改其他管理员")
  }
  return { manager, target }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ teamId: string; userId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { teamId, userId } = await context.params
    const targetUserId = decodeURIComponent(userId)
    const { manager, target } = await managerAndTarget(teamId, auth.userId, targetUserId)
    const body = await request.json() as {
      role?: unknown
      status?: unknown
      permissionKeys?: unknown
    }
    const role = body.role === "admin" ? "admin" : "member"
    if (role === "admin" && manager.member.role !== "owner") {
      throw new Error("只有团队所有者可以设置管理员")
    }
    const status: TeamMemberStatus = body.status === "suspended" ? "suspended" : "active"
    if (target.status === "suspended" && status === "active") {
      await assertTeamSeatAvailable(teamId)
    }
    const permissionKeys = body.permissionKeys === undefined
      ? target.permissionKeys
      : normalizeTeamPermissions(body.permissionKeys)
    const member = await saveTeamMember({
      teamId,
      userId: targetUserId,
      role,
      status,
      permissionKeys,
      operatorUserId: auth.userId,
    })
    return noStore(NextResponse.json({ member }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "团队成员更新失败",
    }, { status: 400 }))
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ teamId: string; userId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { teamId, userId } = await context.params
    const targetUserId = decodeURIComponent(userId)
    await managerAndTarget(teamId, auth.userId, targetUserId)
    const removed = await removeTeamMember({
      teamId,
      userId: targetUserId,
      operatorUserId: auth.userId,
    })
    return noStore(NextResponse.json({ removed }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "团队成员移除失败",
    }, { status: 400 }))
  }
}
