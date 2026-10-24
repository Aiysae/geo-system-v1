import "server-only"

import { aggregatePenetration } from "@/lib/score-utils"
import { normalizeAnalysisSubjectType } from "@/lib/analysis-subject"
import { listWorkspaceClients } from "@/lib/workspace-store"
import { excludedSubjectsFor } from "@/lib/penetration/excluded-subjects"
import type { PenetrationByModel, PenetrationHistoryRecord } from "@/types"

/**
 * A history record with its figures worked out again from the answers it
 * saved, under today's rules and the client's current "not a competitor"
 * names. Records saved before the per-question ranking existed gain it; the
 * answers themselves stay as they were. byModel is what the record saved,
 * passed apart because the overview leaves it out.
 */
export async function historyRecordWithCurrentFigures(
  record: PenetrationHistoryRecord,
  byModel: PenetrationByModel,
  ownerUserId: string,
): Promise<PenetrationHistoryRecord> {
  const result = record.result
  if (!result || Object.keys(byModel).length === 0) return record
  const client = (await listWorkspaceClients(ownerUserId).catch(() => []))
    .find(item => item.client.id === record.clientId)?.client
  const request = record.request
  return {
    ...record,
    result: {
      ...result,
      aggregated: aggregatePenetration(
        byModel,
        request.ourBrand,
        request.brandAliases || [],
        request.competitors || [],
        normalizeAnalysisSubjectType(request.subjectType),
        {
          questionIntents: result.questionIntents || request.questionIntents,
          plannedSlots: result.aggregated.plannedSlots,
          modelCount: Object.keys(byModel).length,
          excludedSubjects: await excludedSubjectsFor(client),
        },
      ),
    },
  }
}
