import { NextRequest, NextResponse } from "next/server"
import { getUserById } from "@/lib/auth"
import { getClientAccountLink } from "@/lib/client-accounts"
import { assertTeamSeatAvailable } from "@/lib/team-access"
import {
  acceptTeamInvite,
  getTeam,
  getTeamInviteByToken,
  getTeamMember,
} from "@/lib/team-store"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return response
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@")
  if (!domain) return email
  return `${local.slice(0, 2)}***@${domain}`
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await context.params
    const invite = await getTeamInviteByToken(token)
    if (!invite) {
      return noStore(NextResponse.json({ error: "团队邀请不存在" }, { status: 404 }))
    }
    const team = await getTeam(invite.teamId)
    return noStore(NextResponse.json({
      invite: {
        id: invite.id,
        status: invite.status,
        emailMasked: maskEmail(invite.email),
        role: invite.role,
        permissionKeys: invite.permissionKeys,
        expiresAt: invite.expiresAt,
      },
      team: team ? { id: team.id, name: team.name, status: team.status } : null,
    }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "团队邀请读取失败",
    }, { status: 500 }))
  }
}

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { token } = await context.params
    const [user, clientLink, invite] = await Promise.all([
      getUserById(auth.userId),
      getClientAccountLink(auth.userId),
      getTeamInviteByToken(token),
    ])
    if (!user) throw new Error("当前登录账号不存在")
    if (clientLink) throw new Error("客户专属账号不能加入内部团队，请使用独立账号")
    if (!invite) throw new Error("团队邀请不存在或已失效")
    const existing = await getTeamMember(invite.teamId, auth.userId)
    if (existing?.status === "active") {
      return noStore(NextResponse.json({ member: existing, alreadyJoined: true }))
    }
    await assertTeamSeatAvailable(invite.teamId)
    const member = await acceptTeamInvite({
      token,
      userId: auth.userId,
      userEmail: user.email,
    })
    return noStore(NextResponse.json({ member, alreadyJoined: false }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "接受团队邀请失败",
    }, { status: 400 }))
  }
}
