import { NextRequest, NextResponse } from "next/server"
import { getClientAccountLink } from "@/lib/client-accounts"
import {
  assertCanCreateTeam,
  getTeamEntitlement,
} from "@/lib/team-access"
import {
  createTeam,
  listTeamsForUser,
} from "@/lib/team-store"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return response
}

export async function GET() {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const [teams, entitlement, clientLink] = await Promise.all([
      listTeamsForUser(auth.userId),
      getTeamEntitlement(auth.userId),
      getClientAccountLink(auth.userId),
    ])
    return noStore(NextResponse.json({
      teams,
      entitlement,
      isClientAccount: Boolean(clientLink),
      canCreate: !clientLink
        && entitlement.eligible
        && !teams.some(summary => summary.team.ownerUserId === auth.userId),
    }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "团队列表读取失败",
    }, { status: 500 }))
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    await assertCanCreateTeam(auth.userId)
    const body = await request.json() as { name?: unknown }
    const name = String(body.name || "").trim().slice(0, 80)
    const team = await createTeam({
      ownerUserId: auth.userId,
      name: name || "我的 GEO 团队",
    })
    return noStore(NextResponse.json({ team }, { status: 201 }))
  } catch (error) {
    const message = error instanceof Error ? error.message : "团队创建失败"
    const status = error instanceof Error && error.name === "TeamVipRequiredError" ? 403 : 400
    return noStore(NextResponse.json({ error: message }, { status }))
  }
}
