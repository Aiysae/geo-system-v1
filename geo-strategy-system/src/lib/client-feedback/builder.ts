import "server-only"

import { randomUUID } from "crypto"
import {
  getPenetrationHistoryRecord,
  listPenetrationHistoryRecords,
} from "@/lib/penetration/history-store"
import {
  executionCounters,
  listClientExecutionActions,
  listClientFeedbackReports,
  saveClientFeedbackReport,
  shanghaiDateOnly,
} from "@/lib/client-feedback/store"
import {
  applyActionPublication,
  getClientExecutionPublicationPolicy,
  penetrationHistoryActionId,
} from "@/lib/client-feedback/publication"
import type { Client, PenetrationHistoryRecord } from "@/types"
import type {
  ClientExecutionAction,
  ClientExecutionProfile,
  ClientFeedbackContentAttribution,
  ClientFeedbackMetricSnapshot,
  ClientFeedbackPeriod,
  ClientFeedbackReport,
} from "@/types/client-feedback"

function recordDate(record: PenetrationHistoryRecord): string {
  return shanghaiDateOnly(new Date(record.completedAt || record.updatedAt || record.createdAt))
}

async function listAllHistory(ownerUserId: string, clientId: string): Promise<PenetrationHistoryRecord[]> {
  const items = [] as Awaited<ReturnType<typeof listPenetrationHistoryRecords>>["items"]
  for (let page = 1; page <= 20; page += 1) {
    const result = await listPenetrationHistoryRecords(ownerUserId, {
      clientId,
      page,
      pageSize: 50,
    })
    items.push(...result.items)
    if (!result.hasMore) break
  }
  const records = await Promise.all(items.map(item => getPenetrationHistoryRecord(ownerUserId, item.id)))
  return records
    .filter((record): record is PenetrationHistoryRecord => Boolean(record))
    .filter(record => (record.status === "succeeded" || record.status === "partial") && record.summary.completedSlots > 0)
    .sort((left, right) => (
      (left.completedAt || left.updatedAt).localeCompare(right.completedAt || right.updatedAt)
    ))
}

function metricSnapshot(record: PenetrationHistoryRecord | undefined): ClientFeedbackMetricSnapshot | null {
  if (!record) return null
  return {
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
    completedAt: record.completedAt || record.updatedAt,
    historyRecordId: record.id,
  }
}

function normalizedSet(values: readonly string[]): Set<string> {
  return new Set(values.map(value => value.trim().toLowerCase()).filter(Boolean))
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false
  for (const item of left) if (!right.has(item)) return false
  return true
}

function overlapRate(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 1
  const union = new Set([...left, ...right])
  let overlap = 0
  for (const item of left) if (right.has(item)) overlap += 1
  return union.size > 0 ? overlap / union.size : 0
}

function comparability(
  baseline: PenetrationHistoryRecord | undefined,
  current: PenetrationHistoryRecord | undefined,
): { comparable: boolean; note: string } {
  if (!baseline || !current) return { comparable: false, note: "当前周期还缺少可用于前后对比的有效检测记录" }
  if (baseline.id === current.id) return { comparable: false, note: "当前只有一份有效检测记录，暂不计算变化幅度" }
  const baselineModels = normalizedSet(baseline.request.activeModels || baseline.request.models)
  const currentModels = normalizedSet(current.request.activeModels || current.request.models)
  const baselineQuestions = normalizedSet(baseline.request.questions)
  const currentQuestions = normalizedSet(current.request.questions)
  const modelsMatch = sameSet(baselineModels, currentModels)
  const questionOverlap = overlapRate(baselineQuestions, currentQuestions)
  const comparable = modelsMatch && questionOverlap >= 0.8
  if (comparable) return { comparable: true, note: "前后检测模型一致，疑问句样本重合度达到可比标准" }
  const reasons = []
  if (!modelsMatch) reasons.push("检测模型不同")
  if (questionOverlap < 0.8) reasons.push(`疑问句样本重合度仅 ${Math.round(questionOverlap * 100)}%`)
  return { comparable: false, note: `${reasons.join("、")}，变化值仅作观察，不作为严格结论` }
}

function delta(current: number | null | undefined, baseline: number | null | undefined): number | null {
  if (typeof current !== "number" || typeof baseline !== "number") return null
  return Math.round((current - baseline) * 10_000) / 10_000
}

function systemAction(
  record: PenetrationHistoryRecord,
  policy: Awaited<ReturnType<typeof getClientExecutionPublicationPolicy>>,
): ClientExecutionAction {
  const when = record.completedAt || record.updatedAt
  const action: ClientExecutionAction = {
    id: penetrationHistoryActionId(record.id),
    ownerUserId: "",
    clientId: record.clientId,
    category: "penetration_check",
    source: "system",
    status: "completed",
    visibility: "client",
    title: `完成 ${record.summary.questionCount} 个疑问句的多模型检测`,
    description: `${record.summary.modelCount} 个模型，完成 ${record.summary.completedSlots}/${record.summary.totalSlots} 次独立采样。`,
    occurredAt: when,
    quantity: record.summary.completedSlots,
    unit: "次采样",
    platform: "势途 GEO",
    evidence: [],
    sourceRecordId: record.id,
    resultRef: {
      module: "penetration",
      resourceType: "history",
      resourceId: record.id,
    },
    publication: policy.defaultPenetration,
    createdByUserId: record.actorUserId || "system",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
  return applyActionPublication(action, policy)
}

export async function listSystemClientExecutionActions(
  ownerUserId: string,
  clientId: string,
): Promise<ClientExecutionAction[]> {
  const [history, policy] = await Promise.all([
    listAllHistory(ownerUserId, clientId),
    getClientExecutionPublicationPolicy(ownerUserId, clientId),
  ])
  return history.map(record => systemAction(record, policy))
}

function percentage(value: number | null | undefined): string {
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "暂无"
}

function contentAttribution(
  actions: ClientExecutionAction[],
): ClientFeedbackContentAttribution {
  const generated = new Map<string, ClientExecutionAction>()
  for (const action of actions) {
    const generationId = action.contentTrace?.generationId
    if (generationId && !generated.has(generationId)) generated.set(generationId, action)
  }
  const contentActions = [...generated.values()]
  const questions = new Set<string>()
  const knowledgeAssets = new Set<string>()
  const platformCounts = new Map<string, number>()
  let evidenceLinkedArticleCount = 0

  for (const action of contentActions) {
    const trace = action.contentTrace
    if (!trace) continue
    const questionKey = trace.questionId || trace.coreQuestion.trim().toLowerCase()
    if (questionKey) questions.add(questionKey)
    if (trace.knowledgeAssetIds.length > 0) evidenceLinkedArticleCount += 1
    trace.knowledgeAssetIds.forEach(id => knowledgeAssets.add(id))
    const platform = action.platform || "通用内容"
    platformCounts.set(platform, (platformCounts.get(platform) || 0) + 1)
  }

  return {
    generatedArticleCount: contentActions.length,
    coveredQuestionCount: questions.size,
    evidenceLinkedArticleCount,
    knowledgeAssetUseCount: knowledgeAssets.size,
    platformCounts: [...platformCounts.entries()]
      .map(([platform, count]) => ({ platform, count }))
      .sort((left, right) => right.count - left.count || left.platform.localeCompare(right.platform, "zh-CN")),
  }
}

export async function buildClientFeedbackReport(input: {
  ownerUserId: string
  actorUserId: string
  client: Client
  profile: ClientExecutionProfile
  period: ClientFeedbackPeriod
}): Promise<ClientFeedbackReport> {
  const [history, manualActions, previousReports, publicationPolicy] = await Promise.all([
    listAllHistory(input.ownerUserId, input.client.id),
    listClientExecutionActions(input.ownerUserId, input.client.id),
    listClientFeedbackReports(input.ownerUserId, input.client.id),
    getClientExecutionPublicationPolicy(input.ownerUserId, input.client.id),
  ])
  const eligible = history.filter(record => {
    const date = recordDate(record)
    return date >= input.profile.startDate && date <= input.period.end
  })
  const projectBaseline = eligible[0]
  const beforePeriod = eligible.filter(record => recordDate(record) < input.period.start)
  const periodBaseline = beforePeriod.at(-1) || projectBaseline
  const current = eligible.at(-1)
  const baselineMetric = metricSnapshot(periodBaseline)
  const currentMetric = metricSnapshot(current)
  const quality = comparability(periodBaseline, current)
  const manualInPeriod = manualActions.map(action => (
    applyActionPublication(action, publicationPolicy)
  )).filter(action => {
    const date = shanghaiDateOnly(new Date(action.occurredAt))
    return action.visibility === "client" && date >= input.period.start && date <= input.period.end
  })
  const historyInPeriod = eligible.filter(record => {
    const date = recordDate(record)
    return date >= input.period.start && date <= input.period.end
  })
  const actions = [
    ...manualInPeriod,
    ...historyInPeriod.map(record => systemAction(record, publicationPolicy)),
  ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
  const comparison = {
    baseline: baselineMetric,
    current: currentMetric,
    comparable: quality.comparable,
    comparabilityNote: quality.note,
    penetrationDelta: delta(currentMetric?.penetrationRate, baselineMetric?.penetrationRate),
    balancedPenetrationDelta: delta(currentMetric?.balancedPenetrationRate, baselineMetric?.balancedPenetrationRate),
    sourceDelta: delta(currentMetric?.uniqueSourceCount, baselineMetric?.uniqueSourceCount),
    domainDelta: delta(currentMetric?.uniqueDomainCount, baselineMetric?.uniqueDomainCount),
  }
  const counters = executionCounters(input.profile, input.period.end)
  const completedActions = actions.filter(action => action.status === "completed").length
  const contentSummary = contentAttribution(actions)
  const executiveSummary = [
    `本期共记录 ${actions.length} 项执行动作，其中 ${completedActions} 项已完成。`,
    ...(contentSummary.generatedArticleCount > 0
      ? [`本期完成 ${contentSummary.generatedArticleCount} 篇内容，覆盖 ${contentSummary.coveredQuestionCount} 个用户问题。`]
      : []),
    currentMetric
      ? `最新有效检测渗透率为 ${percentage(currentMetric.penetrationRate)}，覆盖 ${currentMetric.modelCount} 个模型。`
      : "当前周期尚未形成有效渗透率检测，建议补充一次标准化基线检测。",
    currentMetric
      ? `联网信源共 ${currentMetric.sourceCount} 次引用，覆盖 ${currentMetric.uniqueDomainCount} 个独立域名。`
      : "当前暂无可核验的联网信源指标。",
    quality.note,
  ]
  const versions = previousReports
    .filter(report => report.type === input.period.type && report.periodIndex === input.period.index)
    .map(report => report.version)
  const version = Math.max(0, ...versions) + 1
  const generatedAt = new Date()
  const now = generatedAt.toISOString()
  const periodCutoff = new Date(`${input.period.end}T23:59:59.999+08:00`)
  const dataCutoffAt = periodCutoff.getTime() < generatedAt.getTime()
    ? periodCutoff.toISOString()
    : now
  const subjectName = input.client.subjectType === "person"
    ? input.client.personProfile?.organization
      ? `${input.client.ourBrand} · ${input.client.personProfile.organization}`
      : input.client.ourBrand
    : input.client.ourBrand
  const report: ClientFeedbackReport = {
    id: `cfr_${randomUUID().replace(/-/g, "")}`,
    ownerUserId: input.ownerUserId,
    clientId: input.client.id,
    type: input.period.type,
    status: "draft",
    periodIndex: input.period.index,
    periodStart: input.period.start,
    periodEnd: input.period.end,
    version,
    snapshot: {
      clientName: input.client.name,
      subjectName,
      industry: input.client.industry,
      reportTitle: `${input.period.label} GEO 执行反馈`,
      generatedAt: now,
      dataCutoffAt,
      ...counters,
      currentStage: input.profile.currentStage,
      stageProgress: input.profile.stageProgress,
      projectOwner: input.profile.projectOwner,
      executiveSummary,
      actions,
      comparison,
      contentAttribution: contentSummary,
      nextPlan: input.profile.nextPlan,
      evidenceRecordCount: actions.reduce((sum, action) => (
        sum + action.evidence.length + (action.sourceRecordId ? 1 : 0)
      ), 0),
    },
    shareEnabled: false,
    createdAt: now,
    createdByUserId: input.actorUserId,
    updatedAt: now,
  }
  return saveClientFeedbackReport(report)
}
