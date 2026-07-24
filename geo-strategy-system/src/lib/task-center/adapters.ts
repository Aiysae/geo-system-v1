import "server-only"

import { syncTaskCenterTask } from "@/lib/task-center/store"
import type {
  TaskCenterModule,
  TaskCenterStatus,
} from "@/types/task-center"

type CommonJob = {
  id: string
  status: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  error?: string
}

const BACKGROUND_CONFIG: Record<string, {
  module: TaskCenterModule
  title: string
}> = {
  articleGeneration: { module: "article", title: "文章生成" },
  queryGeneration: { module: "penetration", title: "智能生成检测问题" },
  research: { module: "research", title: "独立调研" },
  diagnosis: { module: "diagnosis", title: "AI 网站诊断" },
  competitorCompare: { module: "research", title: "竞品对比分析" },
  keywordExtract: { module: "keyword", title: "关键词提取" },
  keywordAdvantages: { module: "keyword", title: "核心优势提炼" },
  keywordStrategy: { module: "keyword", title: "关键词策略生成" },
  keywordWebsitePrompt: { module: "keyword", title: "第三方网站 Prompt 生成" },
}

function normalizeStatus(status: string, retrying = false): TaskCenterStatus {
  if (retrying && status === "running") return "retrying"
  if (status === "preparing") return "queued"
  if (status === "partial") return "partial"
  if (status === "succeeded") return "succeeded"
  if (status === "failed") return "failed"
  if (status === "cancelled") return "cancelled"
  if (status === "blocked") return "blocked"
  if (status === "running") return "running"
  return "queued"
}

function progress(value: unknown): number {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
}

function ratioProgress(done: unknown, total: unknown): number {
  const safeTotal = Math.max(0, Number(total) || 0)
  if (safeTotal <= 0) return 0
  return progress(Number(done) / safeTotal * 100)
}

function workspaceUrl(clientId: string, module: TaskCenterModule): string {
  const query = new URLSearchParams()
  if (clientId) query.set("clientId", clientId)
  query.set("module", module === "report" ? "penetration" : module)
  return `/workspace?${query.toString()}`
}

function active(status: TaskCenterStatus): boolean {
  return status === "queued" || status === "running" || status === "retrying"
}

export async function syncBackgroundJobTask(job: CommonJob & {
  kind: string
  clientId: string
  ownerUserId: string
  progressPercent: number
  stage: string
}): Promise<void> {
  const config = BACKGROUND_CONFIG[job.kind] || {
    module: "article" as const,
    title: "后台任务",
  }
  const status = normalizeStatus(job.status)
  await syncTaskCenterTask({
    source: "background",
    sourceJobId: job.id,
    kind: job.kind,
    module: config.module,
    actorUserId: job.ownerUserId,
    workspaceOwnerUserId: job.ownerUserId,
    clientId: job.clientId,
    title: config.title,
    status,
    progressPercent: progress(job.progressPercent),
    stage: job.stage,
    error: job.error,
    resultUrl: workspaceUrl(job.clientId, config.module),
    canCancel: active(status),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  })
}

export async function syncPenetrationJobTask(job: CommonJob & {
  clientId: string
  ownerUserId: string
  workspaceOwnerUserId: string
  request: {
    clientName?: string
    ourBrand: string
  }
  totalSlots: number
  completedSlots: number
  phase?: string
  queuePosition?: number
}): Promise<void> {
  const retrying = job.phase === "retrying"
  const status = normalizeStatus(job.status, retrying)
  const queueStage = status === "queued" && job.queuePosition
    ? `等待处理，当前排队第 ${job.queuePosition} 位`
    : ""
  const phaseStage = status === "retrying"
    ? "部分请求正在自动重试"
    : status === "running"
      ? "正在获取独立联网回答"
      : ""
  await syncTaskCenterTask({
    source: "penetration",
    sourceJobId: job.id,
    kind: "penetrationDetection",
    module: "penetration",
    actorUserId: job.ownerUserId,
    workspaceOwnerUserId: job.workspaceOwnerUserId,
    clientId: job.clientId,
    clientName: job.request.clientName,
    title: `${job.request.ourBrand || "当前主体"} · 疑问句检测`,
    status,
    progressPercent: ratioProgress(job.completedSlots, job.totalSlots),
    stage: queueStage || phaseStage || (
      status === "succeeded" ? "检测结果已保存" : job.error || "检测任务已创建"
    ),
    error: job.error,
    resultUrl: workspaceUrl(job.clientId, "penetration"),
    canCancel: active(status),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    metadata: {
      totalSlots: job.totalSlots,
      completedSlots: job.completedSlots,
    },
  })
}

export async function syncDifficultyJobTask(job: CommonJob & {
  clientId: string
  ownerUserId: string
  industry: string
  targetBrand?: string
  progressPercent: number
  currentStage?: string
}): Promise<void> {
  const status = normalizeStatus(job.status)
  await syncTaskCenterTask({
    source: "difficulty",
    sourceJobId: job.id,
    kind: "difficultyAssessment",
    module: "difficulty",
    actorUserId: job.ownerUserId,
    workspaceOwnerUserId: job.ownerUserId,
    clientId: job.clientId,
    title: `${job.targetBrand || job.industry || "当前项目"} · 难度测评`,
    status,
    progressPercent: progress(job.progressPercent),
    stage: status === "succeeded"
      ? "难度测评已完成"
      : job.currentStage
        ? "正在进行多维评估"
        : job.error || "测评任务已创建",
    error: job.error,
    resultUrl: workspaceUrl(job.clientId, "difficulty"),
    canCancel: active(status),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  })
}

export async function syncQuestionJobTask(job: CommonJob & {
  ownerUserId: string
  request: {
    clientId?: string
    clientName?: string
  }
  completedCount: number
  totalCount: number
  currentBatch: number
  totalBatches: number
}): Promise<void> {
  const status = normalizeStatus(job.status)
  const clientId = String(job.request.clientId || "")
  await syncTaskCenterTask({
    source: "question",
    sourceJobId: job.id,
    kind: "keywordQuestionGeneration",
    module: "keyword",
    actorUserId: job.ownerUserId,
    workspaceOwnerUserId: job.ownerUserId,
    clientId,
    clientName: job.request.clientName,
    title: `疑问句池生成 · ${job.totalCount} 条`,
    status,
    progressPercent: ratioProgress(job.completedCount, job.totalCount),
    stage: status === "succeeded"
      ? `已生成 ${job.completedCount} 条疑问句`
      : status === "running"
        ? `正在生成第 ${Math.max(1, job.currentBatch)} / ${Math.max(1, job.totalBatches)} 批`
        : job.error || "疑问句任务已创建",
    error: job.error,
    resultUrl: workspaceUrl(clientId, "keyword"),
    canCancel: active(status),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  })
}

export async function syncArticleBatchTask(job: CommonJob & {
  ownerUserId: string
  clientId: string
  promptTitle: string
  requestedCount: number
  completedCount: number
  failedCount: number
  cancelledCount: number
  stage: string
}): Promise<void> {
  const status = normalizeStatus(job.status)
  const finished = job.completedCount + job.failedCount + job.cancelledCount
  await syncTaskCenterTask({
    source: "articleBatch",
    sourceJobId: job.id,
    kind: "articleBatchGeneration",
    module: "article",
    actorUserId: job.ownerUserId,
    workspaceOwnerUserId: job.ownerUserId,
    clientId: job.clientId,
    title: `${job.promptTitle || "文章"} · 批量生成 ${job.requestedCount} 篇`,
    status,
    progressPercent: ratioProgress(finished, job.requestedCount),
    stage: job.stage || (status === "succeeded" ? "批量文章已全部生成" : "批量任务处理中"),
    error: job.error,
    resultUrl: workspaceUrl(job.clientId, "article"),
    canCancel: active(status),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    metadata: {
      requestedCount: job.requestedCount,
      completedCount: job.completedCount,
      failedCount: job.failedCount,
      cancelledCount: job.cancelledCount,
    },
  })
}

export async function syncReportJobTask(job: CommonJob & {
  ownerUserId: string
  clientId: string
  clientName?: string
  progress: number
  stage: string
  kind: string
}): Promise<void> {
  const status = normalizeStatus(job.status)
  await syncTaskCenterTask({
    source: "report",
    sourceJobId: job.id,
    kind: `commercialReport:${job.kind}`,
    module: "report",
    actorUserId: job.ownerUserId,
    workspaceOwnerUserId: job.ownerUserId,
    clientId: job.clientId,
    clientName: job.clientName,
    title: `${job.clientName || "当前客户"} · 专业报告`,
    status,
    progressPercent: progress(job.progress),
    stage: job.stage,
    error: job.error,
    resultUrl: status === "succeeded"
      ? `/api/reports/jobs/${encodeURIComponent(job.id)}/view`
      : workspaceUrl(job.clientId, "report"),
    canCancel: false,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  })
}
