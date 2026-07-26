import { NextRequest, NextResponse } from "next/server"
import { requireUserId } from "@/lib/with-credits"
import { resolveWorkspaceAccess } from "@/lib/client-accounts"
import { listAccessibleTeamClientShares } from "@/lib/team-store"
import { listWorkspaceClientSummaries } from "@/lib/workspace-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response

  try {
    const teamId = String(request.nextUrl.searchParams.get("teamId") || "").trim()
    if (teamId) {
      const accesses = await listAccessibleTeamClientShares(auth.userId, teamId)
      const ownerIds = Array.from(new Set(
        accesses.map(access => access.share.clientOwnerUserId),
      ))
      const summaryEntries = await Promise.all(ownerIds.map(async ownerUserId => (
        [ownerUserId, await listWorkspaceClientSummaries(ownerUserId)] as const
      )))
      const summariesByOwner = new Map(summaryEntries)
      const clients = accesses.flatMap(access => {
        const summary = summariesByOwner
          .get(access.share.clientOwnerUserId)
          ?.find(client => client.id === access.share.clientId)
        return summary ? [{
          ...summary,
          dataOwnerUserId: access.share.clientOwnerUserId,
          teamId: access.team.id,
        }] : []
      })
      return noStore(NextResponse.json({ clients }))
    }

    const access = await resolveWorkspaceAccess(auth.userId)
    if (!access.ok) {
      return noStore(NextResponse.json(
        { error: access.message, code: access.code },
        { status: 403 },
      ))
    }
    let clients = await listWorkspaceClientSummaries(access.ownerUserId)
    if (access.mode === "client") {
      clients = clients.filter(client => client.id === access.clientId)
    }
    return noStore(NextResponse.json({ clients }))
  } catch (error) {
    console.error("[workspace-client-summaries] list failed", error)
    return noStore(NextResponse.json({ error: "客户概览读取失败" }, { status: 503 }))
  }
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
  response.headers.set("Pragma", "no-cache")
  return response
}
