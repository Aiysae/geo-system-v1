import type {
  PenetrationHistoryRecord,
  SystemOutputRecord,
} from "@/types"
import { systemOutputRecordId } from "@/lib/system-output/store"

type BackgroundOutputKind = "research" | "competitorCompare" | "diagnosis"

type BuildBackgroundOutputInput = {
  ownerUserId: string
  actorUserId: string
  taskId: string
  clientId: string
  clientName: string
  kind: BackgroundOutputKind
  request: unknown
  result: unknown
  createdAt: string
  completedAt: string
}

type BuildDifficultyOutputInput = {
  ownerUserId: string
  actorUserId: string
  taskId: string
  clientId: string
  clientName: string
  request: unknown
  result: unknown
  createdAt: string
  completedAt: string
}

export function buildBackgroundSystemOutputRecord(
  input: BuildBackgroundOutputInput,
): SystemOutputRecord {
  const request = object(input.request)
  const result = object(input.result)
  const outputModule = input.kind === "diagnosis" ? "diagnosis" : "research"
  const kind = input.kind === "diagnosis"
    ? "website_diagnosis"
    : input.kind === "competitorCompare"
      ? "competitor_comparison"
      : "independent_research"
  const subjectName = text(
    request.ourBrand,
    text(result.competitor, input.clientName),
  )
  const industry = text(request.industry)
  const comparisons = Array.isArray(result.comparisons)
    ? result.comparisons.length
    : result.competitor
      ? 1
      : 0
  const diagnosisScore = number(result.gemScore)
  const auditScore = number(object(result.audit).score)

  return {
    id: systemOutputRecordId(input.ownerUserId, outputModule, input.taskId),
    taskId: input.taskId,
    actorUserId: input.actorUserId,
    clientId: input.clientId,
    clientName: input.clientName,
    module: outputModule,
    kind,
    status: "succeeded",
    source: "job",
    summary: {
      title: `${input.clientName} · ${
        input.kind === "diagnosis"
          ? "AI 诊断"
          : input.kind === "competitorCompare"
            ? "竞品对比"
            : "独立调研"
      }`,
      subjectName,
      industry: industry || undefined,
      description: text(
        result.executiveSummary,
        text(result.positioningSummary),
      ).slice(0, 500) || undefined,
      primaryMetricLabel: input.kind === "diagnosis"
        ? "综合诊断分"
        : input.kind === "competitorCompare"
          ? "对比主体"
          : "调研维度",
      primaryMetricValue: input.kind === "diagnosis"
        ? `${diagnosisScore ?? auditScore ?? 0}/100`
        : input.kind === "competitorCompare"
          ? `${comparisons} 个`
          : `${Array.isArray(result.dimensions) ? result.dimensions.length : 0} 项`,
      tags: compactStrings([
        text(request.mode),
        text(request.sourceMode),
        text(request.website) ? "网站数据" : "",
      ]),
    },
    request: input.request,
    result: input.result,
    schemaVersion: 1,
    createdAt: input.createdAt,
    completedAt: input.completedAt,
    updatedAt: input.completedAt,
  }
}

export function buildDifficultySystemOutputRecord(
  input: BuildDifficultyOutputInput,
): SystemOutputRecord {
  const request = object(input.request)
  const result = object(input.result)
  const score = number(result.totalScore)
  const level = text(result.level)
  const subjectName = text(request.targetBrand, input.clientName)

  return {
    id: systemOutputRecordId(input.ownerUserId, "difficulty", input.taskId),
    taskId: input.taskId,
    actorUserId: input.actorUserId,
    clientId: input.clientId,
    clientName: input.clientName,
    module: "difficulty",
    kind: "difficulty_assessment",
    status: "succeeded",
    source: "job",
    summary: {
      title: `${input.clientName} · GEO 难度测评`,
      subjectName,
      industry: text(request.industry) || undefined,
      description: text(result.summary).slice(0, 500) || undefined,
      primaryMetricLabel: "难度总分",
      primaryMetricValue: `${score ?? 0}/100`,
      secondaryMetricLabel: "难度等级",
      secondaryMetricValue: level || undefined,
      tags: compactStrings([
        text(request.mode),
        text(request.scope),
        text(request.city),
      ]),
    },
    request: input.request,
    result: input.result,
    schemaVersion: 1,
    createdAt: input.createdAt,
    completedAt: input.completedAt,
    updatedAt: input.completedAt,
  }
}

export function buildPenetrationSystemOutputRecord(
  ownerUserId: string,
  record: PenetrationHistoryRecord,
): SystemOutputRecord {
  return {
    id: systemOutputRecordId(ownerUserId, "penetration", record.id),
    taskId: record.id,
    actorUserId: record.actorUserId,
    clientId: record.clientId,
    clientName: record.clientName,
    module: "penetration",
    kind: "penetration_analysis",
    status: record.status,
    source: record.source === "workspace_backfill" ? "workspace_backfill" : "job",
    summary: {
      title: `${record.clientName} · 渗透率情报`,
      subjectName: record.summary.ourBrand,
      industry: record.summary.industry || undefined,
      description: record.error?.slice(0, 500),
      primaryMetricLabel: "全模型渗透率",
      primaryMetricValue: record.summary.penetrationRate == null
        ? "-"
        : `${(record.summary.penetrationRate * 100).toFixed(1)}%`,
      secondaryMetricLabel: "有效采样",
      secondaryMetricValue: `${record.summary.completedSlots}/${record.summary.totalSlots}`,
      tags: compactStrings([
        `${record.summary.questionCount} 个疑问句`,
        `${record.summary.modelCount} 个模型`,
      ]),
    },
    resource: {
      type: "penetration_history",
      id: record.id,
    },
    error: record.error,
    schemaVersion: 1,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
    updatedAt: record.updatedAt,
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function number(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function compactStrings(values: string[]): string[] | undefined {
  const result = [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, 12)
  return result.length ? result : undefined
}
