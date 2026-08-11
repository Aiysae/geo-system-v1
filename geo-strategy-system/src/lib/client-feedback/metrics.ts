import "server-only"

import { listPenetrationHistoryRecords } from "@/lib/penetration/history-store"
import { shanghaiDateOnly } from "@/lib/client-feedback/store"
import type { PenetrationHistoryListItem } from "@/types"
import type {
  ClientFeedbackMetricOption,
  ClientFeedbackMetricSelectionMode,
  ClientFeedbackPeriod,
} from "@/types/client-feedback"

const MAX_HISTORY_PAGES = 20
const HISTORY_PAGE_SIZE = 50

export function feedbackHistoryTime(record: PenetrationHistoryListItem): string {
  return record.completedAt || record.updatedAt || record.createdAt
}

function feedbackHistoryTimestamp(record: PenetrationHistoryListItem): number {
  return Date.parse(feedbackHistoryTime(record))
}

export function feedbackHistoryDate(record: PenetrationHistoryListItem): string {
  return shanghaiDateOnly(new Date(feedbackHistoryTime(record)))
}

export function usableFeedbackActionRecord(record: PenetrationHistoryListItem): boolean {
  return (
    (record.status === "succeeded" || record.status === "partial")
    && record.summary.completedSlots > 0
  )
}

export function usableFeedbackMetricRecord(record: PenetrationHistoryListItem): boolean {
  return usableFeedbackActionRecord(record) && typeof record.summary.penetrationRate === "number"
}

export async function listClientFeedbackHistory(
  ownerUserId: string,
  clientId: string,
): Promise<{ items: PenetrationHistoryListItem[]; truncated: boolean }> {
  const items: PenetrationHistoryListItem[] = []
  let truncated = false
  for (let page = 1; page <= MAX_HISTORY_PAGES; page += 1) {
    const result = await listPenetrationHistoryRecords(ownerUserId, {
      clientId,
      page,
      pageSize: HISTORY_PAGE_SIZE,
    })
    items.push(...result.items.filter(usableFeedbackActionRecord))
    if (!result.hasMore) break
    if (page === MAX_HISTORY_PAGES) truncated = true
  }
  return {
    items: items.sort((left, right) => (
      feedbackHistoryTimestamp(left) - feedbackHistoryTimestamp(right)
      || left.id.localeCompare(right.id)
    )),
    truncated,
  }
}

export function metricOption(record: PenetrationHistoryListItem): ClientFeedbackMetricOption {
  return {
    historyRecordId: record.id,
    status: record.status === "partial" ? "partial" : "succeeded",
    operation: record.operation,
    subjectName: record.summary.ourBrand,
    penetrationRate: record.summary.penetrationRate,
    balancedPenetrationRate: record.summary.balancedPenetrationRate ?? null,
    modelCount: record.summary.modelCount,
    questionCount: record.summary.questionCount,
    completedSlots: record.summary.completedSlots,
    totalSlots: record.summary.totalSlots,
    sourceCount: record.summary.sourceCount,
    uniqueSourceCount: record.summary.uniqueSourceCount || 0,
    uniqueDomainCount: record.summary.uniqueDomainCount || 0,
    sampleConfidence: record.summary.sampleConfidence,
    completedAt: feedbackHistoryTime(record),
  }
}

export function selectFeedbackMetricRecords(input: {
  history: PenetrationHistoryListItem[]
  period: ClientFeedbackPeriod
  baselineHistoryRecordId?: string
  currentHistoryRecordId?: string
}): {
  baseline?: PenetrationHistoryListItem
  current?: PenetrationHistoryListItem
  baselineSelectionMode: ClientFeedbackMetricSelectionMode
  currentSelectionMode: ClientFeedbackMetricSelectionMode
} {
  const eligible = input.history
    .filter(record => feedbackHistoryDate(record) <= input.period.end)
    .sort((left, right) => (
      feedbackHistoryTimestamp(left) - feedbackHistoryTimestamp(right)
      || left.id.localeCompare(right.id)
    ))
  const byId = new Map(eligible.map(record => [record.id, record]))
  const requestedCurrentId = String(input.currentHistoryRecordId || "").trim()
  const requestedBaselineId = String(input.baselineHistoryRecordId || "").trim()

  const current = requestedCurrentId ? byId.get(requestedCurrentId) : eligible.at(-1)
  if (requestedCurrentId && !current) throw new Error("所选当前检测记录不存在、已失效或晚于报告截止日期")

  const automaticBaseline = current
    ? eligible.filter(record => (
        record.id !== current.id
        && feedbackHistoryTimestamp(record) < feedbackHistoryTimestamp(current)
        && feedbackHistoryDate(record) < input.period.start
      )).at(-1)
      || eligible.find(record => (
        record.id !== current.id
        && feedbackHistoryTimestamp(record) < feedbackHistoryTimestamp(current)
      ))
    : undefined
  const baseline = requestedBaselineId ? byId.get(requestedBaselineId) : automaticBaseline
  if (requestedBaselineId && !baseline) throw new Error("所选起始检测记录不存在、已失效或晚于报告截止日期")
  if (baseline && current && baseline.id === current.id) throw new Error("起始检测和当前检测不能选择同一次记录")
  if (baseline && current && feedbackHistoryTimestamp(baseline) >= feedbackHistoryTimestamp(current)) {
    throw new Error("起始检测时间必须早于当前检测时间")
  }

  return {
    baseline,
    current,
    baselineSelectionMode: requestedBaselineId ? "manual" : "automatic",
    currentSelectionMode: requestedCurrentId ? "manual" : "automatic",
  }
}
