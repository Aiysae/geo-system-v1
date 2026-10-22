import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { normalizeAnalysisSubjectType } from "@/lib/analysis-subject"
import { kv } from "@/lib/kv"
import { isPenetrationHistoryAccessError } from "@/lib/penetration/history-access"
import { reanalyzePenetrationEntities } from "@/lib/penetration/reanalyze-result"
import { mergeReextractedAnswers } from "@/lib/penetration/result-merge"
import { requireOperationAccess } from "@/lib/team-access"
import {
  listWorkspaceClients,
  mutateWorkspaceClientLatest,
} from "@/lib/workspace-store"
import { requireUserId } from "@/lib/with-credits"
import type { PenetrationResult } from "@/types"

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

    // One re-read per client at a time: a click repeated after a timeout used
    // to start a second one, and each wrote its own result back.
    const lockKey = `geo:penetration:reanalyze-lock:${access.dataOwnerUserId}:${clientId}`
    const lockToken = randomUUID()
    if (!await kv.set(lockKey, lockToken, { nx: true, ex: 10 * 60 })) {
      return NextResponse.json(
        { error: "品牌榜正在整理中，请稍候刷新查看" },
        { status: 409 },
      )
    }
    try {
      const startedFrom = client.penetration.generatedAt
      const reanalyzed = await reanalyzePenetrationEntities({
        result: client.penetration,
        ourBrand: client.ourBrand,
        brandAliases: client.brandAliases || [],
        competitors: client.competitors || [],
        subjectType: normalizeAnalysisSubjectType(client.subjectType),
        personProfile: client.personProfile,
      })
      // Write onto the report as it stands now, never over a change made while
      // the judges were reading: re-read answers merge in by sample, and a full
      // re-read is kept only if the report did not change underneath it.
      let written: PenetrationResult | undefined
      let refused = ""
      await mutateWorkspaceClientLatest({
        userId: access.dataOwnerUserId,
        clientId,
        mutate: current => {
          if (!current.penetration) {
            refused = "检测结果已被移除"
            return null
          }
          if (reanalyzed.scope === "all") {
            if (current.penetration.generatedAt !== startedFrom) {
              refused = "整理期间报告已更新，请刷新后再整理"
              return null
            }
            written = reanalyzed.result
          } else {
            written = mergeReextractedAnswers({
              base: current.penetration,
              incoming: reanalyzed.rereadByModel,
              ourBrand: current.ourBrand,
              brandAliases: current.brandAliases || [],
              competitors: current.competitors || [],
              subjectType: normalizeAnalysisSubjectType(current.subjectType),
              generatedAt: new Date().toISOString(),
            })
          }
          return { patch: { penetration: written } }
        },
      })
      if (!written || refused) {
        return NextResponse.json({ error: refused || "品牌榜整理结果未能保存" }, { status: 409 })
      }
      return NextResponse.json({
        result: written,
        judgeModels: reanalyzed.judgeModels,
        judgeErrors: reanalyzed.judgeErrors,
        reread: reanalyzed.reread,
      }, {
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      })
    } finally {
      if (await kv.get(lockKey) === lockToken) await kv.del(lockKey)
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "重新识别品牌失败" },
      { status: isPenetrationHistoryAccessError(error) ? 403 : 500 },
    )
  }
}
