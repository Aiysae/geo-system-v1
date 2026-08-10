import type {
  ArticleBatchRecord,
  BackgroundJobKind,
  PenetrationHistoryRecord,
  SystemOutputRecord,
} from "@/types"
import type { QuestionJobRecord } from "@/types/geo-strategy"
import type { ClientFeedbackReport } from "@/types/client-feedback"
import { systemOutputRecordId } from "@/lib/system-output/store"

type BackgroundOutputKind = Exclude<
  BackgroundJobKind,
  "queryGeneration"
>

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
  const outputModule = input.kind === "diagnosis"
    ? "diagnosis"
    : input.kind === "research" || input.kind === "competitorCompare"
      ? "research"
      : input.kind === "articleGeneration"
        ? "article"
        : "keyword"
  const kind = input.kind === "diagnosis"
    ? "website_diagnosis"
    : input.kind === "competitorCompare"
      ? "competitor_comparison"
      : input.kind === "research"
        ? "independent_research"
        : input.kind === "articleGeneration"
          ? "article_generation"
          : input.kind === "keywordAdvantages"
            ? "keyword_advantages"
            : input.kind === "keywordStrategy"
              ? "keyword_strategy"
              : input.kind === "keywordWebsitePrompt"
                ? "keyword_website_prompt"
                : "keyword_extraction"
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
  const articleLength = text(result.article).length
  const advantageCount = Array.isArray(result.advantages) ? result.advantages.length : 0
  const keywordCount = Array.isArray(object(result.keyword_strategy).core_keywords)
    ? (object(result.keyword_strategy).core_keywords as unknown[]).length
    : 0
  const operationTitle = input.kind === "diagnosis"
    ? "AI 诊断"
    : input.kind === "competitorCompare"
      ? "竞品对比"
      : input.kind === "research"
        ? "独立调研"
        : input.kind === "articleGeneration"
          ? "文章生成"
          : input.kind === "keywordAdvantages"
            ? "核心优势"
            : input.kind === "keywordStrategy"
              ? "关键词策略"
              : input.kind === "keywordWebsitePrompt"
                ? "第三方网站 Prompt"
                : "客户资料提取"

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
      title: `${input.clientName} · ${operationTitle}`,
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
          : input.kind === "research"
            ? "调研维度"
            : input.kind === "articleGeneration"
              ? "文章字数"
              : input.kind === "keywordAdvantages"
                ? "优势数量"
                : input.kind === "keywordStrategy"
                  ? "核心关键词"
                  : "产出状态",
      primaryMetricValue: input.kind === "diagnosis"
        ? `${diagnosisScore ?? auditScore ?? 0}/100`
        : input.kind === "competitorCompare"
          ? `${comparisons} 个`
          : input.kind === "research"
            ? `${Array.isArray(result.dimensions) ? result.dimensions.length : 0} 项`
            : input.kind === "articleGeneration"
              ? `${articleLength} 字`
              : input.kind === "keywordAdvantages"
                ? `${advantageCount} 条`
                : input.kind === "keywordStrategy"
                  ? `${keywordCount} 个`
                  : "已完成",
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

export function buildQuestionSystemOutputRecord(input: {
  ownerUserId: string
  actorUserId: string
  clientId: string
  clientName: string
  job: QuestionJobRecord
}): SystemOutputRecord {
  const completedAt = input.job.finishedAt || input.job.updatedAt
  return {
    id: systemOutputRecordId(input.ownerUserId, "keyword", input.job.id),
    taskId: input.job.id,
    actorUserId: input.actorUserId,
    clientId: input.clientId,
    clientName: input.clientName,
    module: "keyword",
    kind: "keyword_questions",
    status: "succeeded",
    source: "job",
    summary: {
      title: `${input.clientName} · 疑问句池`,
      subjectName: input.clientName,
      description: input.job.warnings?.slice(0, 2).join("；").slice(0, 500),
      primaryMetricLabel: "疑问句数量",
      primaryMetricValue: `${input.job.questions.length} 条`,
      tags: compactStrings([`${input.job.totalBatches} 批`, "优势独立匹配"]),
    },
    result: input.job,
    resource: { type: "keyword_question_job", id: input.job.id },
    schemaVersion: 1,
    createdAt: input.job.createdAt,
    completedAt,
    updatedAt: completedAt,
  }
}

export function buildArticleBatchSystemOutputRecord(input: {
  ownerUserId: string
  actorUserId: string
  clientName: string
  batch: ArticleBatchRecord
}): SystemOutputRecord {
  const completedAt = input.batch.finishedAt || input.batch.updatedAt
  const status = input.batch.status === "succeeded"
    ? "succeeded"
    : input.batch.status === "partial"
      ? "partial"
      : input.batch.status === "cancelled"
        ? "cancelled"
        : "failed"
  return {
    id: systemOutputRecordId(input.ownerUserId, "article", input.batch.id),
    taskId: input.batch.id,
    actorUserId: input.actorUserId,
    clientId: input.batch.clientId,
    clientName: input.clientName,
    module: "article",
    kind: "article_batch",
    status,
    source: "job",
    summary: {
      title: `${input.clientName} · 批量文章`,
      subjectName: input.clientName,
      description: input.batch.stage.slice(0, 500),
      primaryMetricLabel: "已生成",
      primaryMetricValue: `${input.batch.completedCount}/${input.batch.requestedCount} 篇`,
      secondaryMetricLabel: "质量通过",
      secondaryMetricValue: `${input.batch.passedCount || 0} 篇`,
      tags: compactStrings([input.batch.promptTitle, input.batch.topicMode]),
    },
    result: input.batch,
    resource: { type: "article_batch", id: input.batch.id },
    error: input.batch.error,
    schemaVersion: 1,
    createdAt: input.batch.createdAt,
    completedAt,
    updatedAt: completedAt,
  }
}

export function buildFeedbackReportSystemOutputRecord(input: {
  ownerUserId: string
  actorUserId: string
  clientName: string
  report: ClientFeedbackReport
}): SystemOutputRecord {
  const completedAt = input.report.createdAt
  return {
    id: systemOutputRecordId(input.ownerUserId, "feedback", input.report.id),
    taskId: input.report.id,
    actorUserId: input.actorUserId,
    clientId: input.report.clientId,
    clientName: input.clientName,
    module: "feedback",
    kind: "feedback_report",
    status: "succeeded",
    source: "job",
    summary: {
      title: `${input.clientName} · ${input.report.snapshot.reportTitle}`,
      subjectName: input.report.snapshot.subjectName || input.clientName,
      industry: input.report.snapshot.industry || undefined,
      description: input.report.snapshot.executiveSummary.slice(0, 2).join("；").slice(0, 500),
      primaryMetricLabel: "执行动作",
      primaryMetricValue: `${input.report.snapshot.actions.length} 项`,
      secondaryMetricLabel: "证据记录",
      secondaryMetricValue: `${input.report.snapshot.evidenceRecordCount} 条`,
      tags: compactStrings([
        input.report.type === "monthly" ? "月报" : "周报",
        `${input.report.periodStart} 至 ${input.report.periodEnd}`,
      ]),
    },
    result: input.report,
    resource: { type: "feedback_report", id: input.report.id },
    schemaVersion: 1,
    createdAt: input.report.createdAt,
    completedAt,
    updatedAt: input.report.updatedAt,
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
