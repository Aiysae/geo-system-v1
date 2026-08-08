import "server-only"

import { syncTaskCenterTask } from "@/lib/task-center/store"
import type {
  TaskCenterModule,
  TaskCenterStatus,
} from "@/types/task-center"
import { buildWorkspaceResultUrl, type WorkspaceModule } from "@/lib/workspace-navigation"

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

function workspaceUrl(
  clientId: string,
  module: TaskCenterModule,
  teamId?: string,
  result?: { view?: string; jobId?: string },
): string {
  return buildWorkspaceResultUrl({
    clientId,
    teamId,
    module: (module === "report" ? "penetration" : module) as WorkspaceModule,
    view: result?.view,
    jobId: result?.jobId,
  })
}

function backgroundResultView(kind: string): string {
  if (kind === "keywordExtract" || kind === "keywordAdvantages") return "extraction"
  if (kind === "keywordStrategy" || kind === "keywordWebsitePrompt") return "strategy"
  if (kind === "queryGeneration") return "questions"
  if (kind === "competitorCompare") return "comparison"
  return "result"
}

function active(status: TaskCenterStatus): boolean {
  return status === "queued" || status === "running" || status === "retrying"
}

export async function syncBackgroundJobTask(job: CommonJob & {
  kind: string
  clientId: string
  ownerUserId: string
  workspaceOwnerUserId?: string
  teamId?: string
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
    workspaceOwnerUserId: job.workspaceOwnerUserId || job.ownerUserId,
    clientId: job.clientId,
    title: config.title,
    status,
    progressPercent: progress(job.progressPercent),
    stage: job.stage,
    error: job.error,
    resultUrl: workspaceUrl(job.clientId, config.module, job.teamId, {
      view: backgroundResultView(job.kind),
      jobId: job.id,
    }),
    canCancel: active(status),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    metadata: {
      teamId: job.teamId,
    },
  })
}

export async function syncPenetrationJobTask(job: CommonJob & {
  clientId: string
  ownerUserId: string
  workspaceOwnerUserId: string
  teamId?: string
  request: {
    clientName?: string
    ourBrand: string
  }
  totalSlots: number
  completedSlots: number
  phase?: string
  queuePosition?: number
  queueReason?: string
  retryingSlots?: number
  blockedSlots?: number
  activeSlots?: number
  waitingSlots?: number
  nextRetryAt?: string
}): Promise<void> {
  const retrying = job.phase === "retrying"
  const status = normalizeStatus(job.status, retrying)
  const queueStage = status === "queued" && job.queuePosition
    ? `等待处理，当前排队第 ${job.queuePosition} 位`
    : ""
  const completedLabel = `已完成 ${job.completedSlots}/${job.totalSlots}`
  const retryAtMs = job.nextRetryAt ? Date.parse(job.nextRetryAt) : 0
  const retrySeconds = Number.isFinite(retryAtMs)
    ? Math.max(0, Math.ceil((retryAtMs - Date.now()) / 1000))
    : 0
  const retryLabel = retrySeconds > 0
    ? retrySeconds >= 60
      ? `${Math.ceil(retrySeconds / 60)} 分钟内继续`
      : `${retrySeconds} 秒内继续`
    : "即将继续"
  const phaseStage = status === "retrying"
    ? `${completedLabel}，${job.retryingSlots || 0} 项等待补采，${retryLabel}`
    : status === "running"
      ? `${completedLabel}，${job.activeSlots || 0} 项正在并行联网${
          (job.waitingSlots || 0) > 0 ? `，${job.waitingSlots} 项等待空闲通道` : ""
        }`
      : status === "blocked"
        ? `${completedLabel}，${job.blockedSlots || 0} 项未达到完整性标准`
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
    resultUrl: workspaceUrl(job.clientId, "penetration", job.teamId, {
      view: "report",
      jobId: job.id,
    }),
    canCancel: active(status),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    metadata: {
      totalSlots: job.totalSlots,
      completedSlots: job.completedSlots,
      retryingSlots: job.retryingSlots || 0,
      blockedSlots: job.blockedSlots || 0,
      activeSlots: job.activeSlots || 0,
      waitingSlots: job.waitingSlots || 0,
      teamId: job.teamId,
    },
  })
}

export async function syncDifficultyJobTask(job: CommonJob & {
  clientId: string
  ownerUserId: string
  workspaceOwnerUserId: string
  teamId?: string
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
    workspaceOwnerUserId: job.workspaceOwnerUserId,
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
    resultUrl: workspaceUrl(job.clientId, "difficulty", job.teamId, {
      view: "report",
      jobId: job.id,
    }),
    canCancel: active(status),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    metadata: {
      teamId: job.teamId,
    },
  })
}

export async function syncQuestionJobTask(job: CommonJob & {
  ownerUserId: string
  workspaceOwnerUserId?: string
  teamId?: string
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
    workspaceOwnerUserId: job.workspaceOwnerUserId || job.ownerUserId,
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
    resultUrl: workspaceUrl(clientId, "keyword", job.teamId, {
      view: "questions",
      jobId: job.id,
    }),
    canCancel: active(status),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    metadata: {
      teamId: job.teamId,
    },
  })
}

export async function syncArticleBatchTask(job: CommonJob & {
  ownerUserId: string
  workspaceOwnerUserId?: string
  teamId?: string
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
    workspaceOwnerUserId: job.workspaceOwnerUserId || job.ownerUserId,
    clientId: job.clientId,
    title: `${job.promptTitle || "文章"} · 批量生成 ${job.requestedCount} 篇`,
    status,
    progressPercent: ratioProgress(finished, job.requestedCount),
    stage: job.stage || (status === "succeeded" ? "批量文章已全部生成" : "批量任务处理中"),
    error: job.error,
    resultUrl: workspaceUrl(job.clientId, "article", job.teamId, {
      view: "batch",
      jobId: job.id,
    }),
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
      teamId: job.teamId,
    },
  })
}

export async function syncArticleMediaJobTask(job: CommonJob & {
  ownerUserId: string
  workspaceOwnerUserId?: string
  teamId?: string
  clientId: string
  batchId: string
  requestedCount: number
  completedCount: number
  failedCount: number
  progressPercent: number
  stage: string
}): Promise<void> {
  const status = normalizeStatus(job.status)
  await syncTaskCenterTask({
    source: "articleMedia",
    sourceJobId: job.id,
    kind: "articleBatchMedia",
    module: "article",
    actorUserId: job.ownerUserId,
    workspaceOwnerUserId: job.workspaceOwnerUserId || job.ownerUserId,
    clientId: job.clientId,
    title: `批量文章配图 · ${job.requestedCount} 篇`,
    status,
    progressPercent: progress(job.progressPercent),
    stage: job.stage,
    error: job.error,
    resultUrl: workspaceUrl(job.clientId, "article", job.teamId, {
      view: "batch",
      jobId: job.batchId,
    }),
    canCancel: active(status),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    metadata: {
      batchId: job.batchId,
      requestedCount: job.requestedCount,
      completedCount: job.completedCount,
      failedCount: job.failedCount,
      teamId: job.teamId,
    },
  })
}

export async function syncReportJobTask(job: CommonJob & {
  ownerUserId: string
  actorUserId?: string
  teamId?: string
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
    actorUserId: job.actorUserId || job.ownerUserId,
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
      : workspaceUrl(job.clientId, "report", job.teamId, {
          view: "report",
          jobId: job.id,
        }),
    canCancel: active(status),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    metadata: {
      teamId: job.teamId,
    },
  })
}
