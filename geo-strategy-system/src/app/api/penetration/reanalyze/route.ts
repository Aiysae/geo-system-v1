import { NextRequest, NextResponse } from "next/server"
import { normalizeAnalysisSubjectType } from "@/lib/analysis-subject"
import { isPenetrationHistoryAccessError } from "@/lib/penetration/history-access"
import { reanalyzePenetrationEntities } from "@/lib/penetration/reanalyze-result"
import { requireOperationAccess } from "@/lib/team-access"
import {
  listWorkspaceClients,
  mutateWorkspaceClientLatest,
} from "@/lib/workspace-store"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response

  try {
    const body = await request.json() as { clientId?: unknown; teamId?: unknown }
    const clientId = String(body.clientId || "").trim()
    const teamId = String(body.teamId || "").trim() || undefined
    if (!clientId) {
      return NextResponse.json({ error: "客户标识缺失" }, { status: 400 })
    }
    const access = await requireOperationAccess({
      userId: userGuard.userId,
      clientId,
      module: "penetration",
      action: "execute",
      teamId,
    })
    const synced = (await listWorkspaceClients(access.dataOwnerUserId))
      .find(record => record.client.id === clientId)
    const client = synced?.client
    if (!client?.penetration) {
      return NextResponse.json({ error: "当前客户还没有可重新识别的检测结果" }, { status: 404 })
    }

    const reanalyzed = await reanalyzePenetrationEntities({
      result: client.penetration,
      ourBrand: client.ourBrand,
      brandAliases: client.brandAliases || [],
      competitors: client.competitors || [],
      subjectType: normalizeAnalysisSubjectType(client.subjectType),
      personProfile: client.personProfile,
    })
    await mutateWorkspaceClientLatest({
      userId: access.dataOwnerUserId,
      clientId,
      mutate: () => ({ patch: { penetration: reanalyzed.result } }),
    })

    return NextResponse.json(reanalyzed, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "重新识别品牌失败" },
      { status: isPenetrationHistoryAccessError(error) ? 403 : 500 },
    )
  }
}
