import { NextRequest, NextResponse } from "next/server"
import { isOperationAccessError, requireOperationAccess } from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"
import { mutateWorkspaceClientLatest } from "@/lib/workspace-store"
import { aggregatePenetration } from "@/lib/score-utils"
import { getClientSubjectType } from "@/lib/analysis-subject"
import {
  getGlobalExcludedSubjects,
  normalizeExcludedSubjects,
} from "@/lib/penetration/excluded-subjects"
import type { Client } from "@/types"

// One client's own "not a competitor" names. The saved rankings are worked out
// again in the same write, so pages that read them (research, difficulty)
// leave the names out too.

export async function POST(req: NextRequest) {
  try {
    const userGuard = await requireUserId()
    if (!userGuard.ok) return userGuard.response
    const body = await req.json().catch(() => ({})) as {
      clientId?: unknown
      teamId?: unknown
      add?: unknown
      remove?: unknown
    }
    const clientId = String(body.clientId || "").trim()
    if (!clientId) return NextResponse.json({ error: "客户标识缺失，请刷新页面后重试" }, { status: 400 })
    const access = await requireOperationAccess({
      userId: userGuard.userId,
      clientId,
      module: "penetration",
      action: "edit",
      teamId: String(body.teamId || "").trim() || undefined,
    })
    const add = String(body.add || "").trim()
    const remove = String(body.remove || "").trim()
    if (!add && !remove) return NextResponse.json({ error: "请指定要排除或恢复的名称" }, { status: 400 })

    const global = await getGlobalExcludedSubjects()
    let excludedSubjects: string[] = []
    const saved = await mutateWorkspaceClientLatest({
      userId: access.dataOwnerUserId,
      clientId,
      mutate: current => {
        excludedSubjects = normalizeExcludedSubjects([
          ...(current.excludedSubjects || []).filter(name => name !== remove),
          ...(add ? [add] : []),
        ])
        const patch: Partial<Client> = { excludedSubjects }
        const report = current.penetration
        if (report) {
          patch.penetration = {
            ...report,
            aggregated: aggregatePenetration(
              report.byModel,
              current.ourBrand,
              current.brandAliases || [],
              current.competitors || [],
              getClientSubjectType(current),
              {
                questionIntents: report.questionIntents,
                plannedSlots: report.aggregated.plannedSlots,
                modelCount: Object.keys(report.byModel).length,
                excludedSubjects: [...global, ...excludedSubjects],
              },
            ),
          }
        }
        if (excludedSubjects.length) return { patch }
        const { excludedSubjects: _emptied, ...rest } = patch
        return { patch: rest, unsetFields: ["excludedSubjects"] }
      },
    })
    if (!saved) return NextResponse.json({ error: "当前客户不存在或已被删除" }, { status: 404 })
    return NextResponse.json({ excludedSubjects, global })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "排除名单保存失败" },
      { status: isOperationAccessError(error) ? 403 : 400 },
    )
  }
}
