import "server-only"

import { randomUUID } from "crypto"
import { kv } from "@/lib/kv"
import {
  dispatchDurableTaskOrFallback,
  type TaskWorkerOutcome,
} from "@/lib/task-queue"
import {
  clearTaskCancellation,
  signalTaskCancellation,
} from "@/lib/task-cancellation"
import {
  cancelBackgroundJob,
  createBackgroundJob,
  createBackgroundJobsBatch,
  createUnchargedBackgroundJob,
  getBackgroundJob,
  getBackgroundJobByRequest,
} from "@/lib/background-jobs"
import {
  cleanupArticleArtifacts,
  deleteArticleBatchArtifacts,
  extractArticleTitle,
  readArticleDocxArtifact,
  writeArticleDocxArtifact,
} from "@/lib/article-batches/docx"
import {
  ARTICLE_SIMILARITY_RETRY_THRESHOLD,
  mostSimilarArticle,
  planArticleBatch,
} from "@/lib/article-batches/planning"
import {
  ARTICLE_BATCH_PENDING_SET_KEY,
  createStoredArticleBatchInput,
  deleteOwnedStoredArticleBatch,
  findStoredArticleBatchByRequest,
  getOwnedStoredArticleBatch,
  getStoredArticleBatch,
  listOwnedStoredArticleBatches,
  mutateStoredArticleBatch,
  saveStoredArticleBatch,
  toPublicArticleBatch,
  type ArticleBatchBasePayload,
  type StoredArticleBatch,
  type StoredArticleBatchItem,
} from "@/lib/article-batches/store"
import { recordArticleGenerationAttribution } from "@/lib/geo-methodology/attribution"
import type {
  ArticleGenerationConnectivity,
  ArticleGenerationLineage,
  ArticleBatchQuestionTask,
  ArticleBatchRecord,
  ArticleBatchTopicMode,
  ArticleMethodologyTrace,
  BackgroundJobRecord,
} from "@/types"

export interface CreateArticleBatchInput {
  requestId: string
  clientId: string
  promptTitle: string
  count: number
  topicMode: ArticleBatchTopicMode
  customTopics?: string
  questionTasks?: ArticleBatchQuestionTask[]
  similarityRetry: boolean
  basePayload: ArticleBatchBasePayload
}

export type ArticleBatchExecutionContext = {
  actorUserId: string
  billingUserId?: string
  runtimeUserId?: string
  workspaceOwnerUserId?: string
  teamId?: string
}

export type CreateArticleBatchResult =
  | { ok: true; batch: ArticleBatchRecord; reused: boolean }
  | { ok: false; response: Response }

const activeMonitors = new Set<string>()
const TERMINAL_BATCH_STATUSES = new Set(["succeeded", "partial", "failed", "cancelled"])
const TERMINAL_ITEM_STATUSES = new Set(["succeeded", "failed", "cancelled"])

function nowIso(): string {
  return new Date().toISOString()
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function articleConnectivity(value: unknown): ArticleGenerationConnectivity | undefined {
  const input = record(value)
  const mode = input.mode === "web" || input.mode === "standard_fallback"
    ? input.mode
    : null
  if (input.requested !== true || !mode) return undefined
  return {
    requested: true,
    mode,
    webAttempts: Math.max(0, Math.floor(Number(input.webAttempts) || 0)),
    sourceCount: Math.max(0, Math.floor(Number(input.sourceCount) || 0)),
    fallbackReason: String(input.fallbackReason || "").trim().slice(0, 300) || undefined,
  }
}

function safeError(value: unknown): string {
  return (value instanceof Error ? value.message : String(value || "任务失败"))
    .replace(/sk-[A-Za-z0-9_.*-]{6,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer ***")
    .replace(/\s+/g, " ")
    .slice(0, 600)
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const data = await response.clone().json() as { error?: string }
    return data.error || `批次任务创建失败（HTTP ${response.status}）`
  } catch {
    return `批次任务创建失败（HTTP ${response.status}）`
  }
}

function itemJobPayload(batch: StoredArticleBatch, item: StoredArticleBatchItem, retry = false) {
  return {
    ...batch.basePayload,
    clientId: batch.clientId,
    articleBatchId: batch.id,
    questionId: item.questionId,
    promptKey: item.promptKey || batch.basePayload.promptKey,
    coreQuestion: item.topic,
    advantages: batch.topicMode === "questions" || batch.topicMode === "strategy"
      ? item.matchedAdvantage || ""
      : item.matchedAdvantage ?? batch.basePayload.advantages,
    questionIntent: item.intent || "",
    questionSubIntent: item.subIntent || "",
    questionCategory: item.category || "",
    questionKeyword: item.keyword || "",
    questionContentAngle: item.contentAngle || "",
    methodology: {
      ...record(batch.basePayload.methodology),
      mode: item.methodologyCandidates?.length
        ? "manual"
        : record(batch.basePayload.methodology).mode || "auto",
      methodKey: item.methodologyCandidates?.[0]
        || record(batch.basePayload.methodology).methodKey,
      targetPlatform: item.targetPlatform
        || record(batch.basePayload.methodology).targetPlatform
        || "auto",
      articleFormat: item.articleFormat
        || record(batch.basePayload.methodology).articleFormat
        || "auto",
      brandLayout: item.brandLayout
        || record(batch.basePayload.methodology).brandLayout
        || "auto",
      titleStrategy: item.titleStrategy
        || record(batch.basePayload.methodology).titleStrategy
        || "auto",
    },
    batchVariation: [
      item.brief,
      retry
        ? "首次结果与批次内其他文章相似度偏高。本次必须采用新的标题句式、开场表达和论证语言；仍须保留所选模板规定的章节、表格和输出格式，不得引用或描述其他文章。"
        : "",
    ].filter(Boolean).join("\n"),
  }
}

function itemRequestId(batchId: string, position: number, attempt: number): string {
  const safeId = batchId.replace(/[^A-Za-z0-9]/g, "").slice(-24)
  return `articlebatch_${safeId}_${String(position).padStart(2, "0")}_${attempt}`
}

function aggregateBatch(batch: StoredArticleBatch): void {
  batch.completedCount = batch.items.filter(item => item.status === "succeeded").length
  batch.failedCount = batch.items.filter(item => item.status === "failed").length
  batch.cancelledCount = batch.items.filter(item => item.status === "cancelled").length
  const terminalCount = batch.completedCount + batch.failedCount + batch.cancelledCount
  const runningCount = batch.items.filter(item => item.status === "running" || item.status === "word_processing").length

  if (terminalCount >= batch.requestedCount) {
    batch.finishedAt = batch.finishedAt || nowIso()
    if (batch.completedCount === batch.requestedCount) {
      batch.status = "succeeded"
      batch.stage = `${batch.completedCount} 篇文章及 Word 文档已全部生成`
    } else if (batch.completedCount > 0) {
      batch.status = "partial"
      batch.stage = `已完成 ${batch.completedCount} 篇，${batch.failedCount + batch.cancelledCount} 篇未完成`
    } else if (batch.cancelledCount === batch.requestedCount) {
      batch.status = "cancelled"
      batch.stage = "批量生成已停止"
    } else {
      batch.status = "failed"
      batch.stage = "本批次未生成有效文章"
    }
    return
  }

  batch.status = runningCount > 0 ? "running" : "queued"
  batch.stage = batch.cancelRequested
    ? "正在停止未完成的文章任务"
    : `后台生成中：已完成 ${batch.completedCount}/${batch.requestedCount}`
}

async function finalizeArticle(
  batch: StoredArticleBatch,
  item: StoredArticleBatchItem,
  markdown: string,
  stage = "文章和 Word 文档已生成",
): Promise<void> {
  const title = extractArticleTitle(markdown, `${batch.promptTitle}-${item.position}`)
  item.status = "word_processing"
  item.progressPercent = 92
  item.stage = "正在生成 Word 文档"
  item.title = title
  item.markdown = markdown
  item.generatedAt = nowIso()

  try {
    const artifact = await writeArticleDocxArtifact({
      batchId: batch.id,
      itemId: item.id,
      position: item.position,
      markdown,
      title,
    })
    item.artifactPath = artifact.artifactPath
    item.fileName = artifact.fileName
  } catch (error) {
    console.error("[article-batches] Word artifact generation failed", batch.id, item.id, safeError(error))
    item.fileName = `${String(item.position).padStart(2, "0")}_${title}.docx`
  }

  item.status = "succeeded"
  item.progressPercent = 100
  item.stage = stage
  item.error = undefined
  item.updatedAt = nowIso()
  item.fallbackMarkdown = undefined

  if (item.lineage) {
    try {
      await recordArticleGenerationAttribution({
        ownerUserId: batch.workspaceOwnerUserId || batch.ownerUserId,
        clientId: batch.clientId,
        actorUserId: batch.ownerUserId,
        lineage: item.lineage,
        markdown,
        batchId: batch.id,
      })
    } catch (error) {
      console.warn("[article-batches] attribution record failed", batch.id, item.id, safeError(error))
    }
  }
}

async function syncBatchOnce(batchId: string): Promise<StoredArticleBatch | null> {
  const mutation = await mutateStoredArticleBatch(batchId, async batch => {
    if (TERMINAL_BATCH_STATUSES.has(batch.status)) return
    const finalized = batch.items
      .filter(item => item.status === "succeeded" && item.markdown)
      .map(item => ({ id: item.id, markdown: item.markdown || "" }))

    for (const item of batch.items.slice().sort((a, b) => a.position - b.position)) {
      if (TERMINAL_ITEM_STATUSES.has(item.status)) continue
      if (!item.jobId) {
        const recovered = await getBackgroundJobByRequest(
          batch.ownerUserId,
          "articleGeneration",
          item.requestId,
        )
        if (recovered) {
          item.jobId = recovered.id
        } else {
          item.status = "failed"
          item.progressPercent = 100
          item.stage = "任务创建失败"
          item.error = "文章子任务编号缺失，请重试失败项。"
          item.updatedAt = nowIso()
          continue
        }
      }

      const job = await getBackgroundJob(item.jobId, batch.ownerUserId)
      if (!job) {
        item.status = "failed"
        item.progressPercent = 100
        item.stage = "任务记录已失效"
        item.error = "文章后台任务不存在或已过期，请重试失败项。"
        item.updatedAt = nowIso()
        continue
      }

      if (job.status === "queued" || job.status === "running") {
        item.status = job.status
        item.progressPercent = Math.max(item.progressPercent, job.progressPercent)
        item.stage = job.stage
        item.updatedAt = job.updatedAt
        continue
      }

      if (job.status === "succeeded") {
        const jobResult = record(job.result)
        const markdown = String(jobResult.article || "").trim()
        const trace = record(jobResult.methodologyTrace)
        const lineage = record(jobResult.lineage)
        item.connectivity = articleConnectivity(jobResult.connectivity)
        if (Object.keys(trace).length > 0) {
          item.methodologyTrace = trace as unknown as ArticleMethodologyTrace
        }
        if (
          String(lineage.generationId || "").trim()
          && String(lineage.coreQuestion || "").trim()
          && lineage.methodologyTrace
        ) {
          item.lineage = lineage as unknown as ArticleGenerationLineage
          item.generationId = item.lineage.generationId
        }
        if (!markdown) {
          item.status = "failed"
          item.progressPercent = 100
          item.stage = "文章内容无效"
          item.error = "模型没有返回有效文章内容，请重试该篇。"
          item.updatedAt = nowIso()
          continue
        }

        const similar = mostSimilarArticle(markdown, finalized)
        if (
          batch.similarityRetry
          && item.attempt === 1
          && similar.score >= ARTICLE_SIMILARITY_RETRY_THRESHOLD
        ) {
          item.fallbackMarkdown = markdown
          item.markdown = markdown
          item.similarityScore = Number(similar.score.toFixed(3))
          item.attempt = 2
          item.requestId = itemRequestId(batch.id, item.position, item.attempt)
          const retryJob = await createUnchargedBackgroundJob({
            kind: "articleGeneration",
            clientId: batch.clientId,
            requestId: item.requestId,
            payload: itemJobPayload(batch, item, true),
            ownerUserId: batch.ownerUserId,
            billingUserId: batch.billingUserId,
            runtimeUserId: batch.runtimeUserId,
            workspaceOwnerUserId: batch.workspaceOwnerUserId,
            teamId: batch.teamId,
            reason: "相似度偏高，正在免费重新生成",
          })
          item.jobId = retryJob.id
          item.status = "queued"
          item.progressPercent = 0
          item.stage = "相似度偏高，已自动进入免费重试"
          item.updatedAt = nowIso()
          continue
        }

        await finalizeArticle(batch, item, markdown)
        finalized.push({ id: item.id, markdown })
        continue
      }

      if (job.status === "failed") {
        if (item.attempt > 1 && item.fallbackMarkdown) {
          await finalizeArticle(
            batch,
            item,
            item.fallbackMarkdown,
            "免费差异化重试未完成，已保留首次生成结果",
          )
          finalized.push({ id: item.id, markdown: item.markdown || "" })
        } else {
          item.status = "failed"
          item.progressPercent = 100
          item.stage = "生成失败"
          item.error = job.error || "文章生成失败，请重试该篇。"
          item.updatedAt = nowIso()
        }
        continue
      }

      item.status = "cancelled"
      item.progressPercent = 100
      item.stage = "任务已停止"
      item.error = "该篇文章已停止，预扣积分会自动退回。"
      item.updatedAt = nowIso()
    }

    aggregateBatch(batch)
  })
  return mutation?.batch || null
}

function scheduleLocalArticleBatchMonitor(batchId: string): void {
  if (activeMonitors.has(batchId)) return
  activeMonitors.add(batchId)
  void (async () => {
    try {
      for (;;) {
        const batch = await syncBatchOnce(batchId)
        if (!batch || TERMINAL_BATCH_STATUSES.has(batch.status)) return
        await sleep(2_500)
      }
    } catch (error) {
      console.error("[article-batches] monitor failed", batchId, safeError(error))
    } finally {
      activeMonitors.delete(batchId)
    }
  })()
}

export function scheduleArticleBatchMonitor(batchId: string): void {
  void dispatchDurableTaskOrFallback(
    "articleBatch",
    batchId,
    () => scheduleLocalArticleBatchMonitor(batchId),
  )
}

export async function resumePendingArticleBatchMonitors(): Promise<void> {
  let ids: string[] = []
  try {
    ids = await kv.smembers<string[]>(ARTICLE_BATCH_PENDING_SET_KEY)
  } catch (error) {
    console.warn("[article-batches] pending queue recovery failed", safeError(error))
    return
  }

  for (const id of ids) {
    const batch = await getStoredArticleBatch(id)
    if (!batch || TERMINAL_BATCH_STATUSES.has(batch.status)) {
      await kv.srem(ARTICLE_BATCH_PENDING_SET_KEY, id)
      continue
    }
    await dispatchDurableTaskOrFallback(
      "articleBatch",
      id,
      () => scheduleLocalArticleBatchMonitor(id),
    )
  }
}

export async function runArticleBatchFromWorker(
  id: string,
): Promise<TaskWorkerOutcome> {
  const batch = await getStoredArticleBatch(id)
  if (!batch || TERMINAL_BATCH_STATUSES.has(batch.status)) {
    if (batch) await kv.srem(ARTICLE_BATCH_PENDING_SET_KEY, batch.id)
    return {}
  }

  const updated = await syncBatchOnce(id)
  if (!updated || TERMINAL_BATCH_STATUSES.has(updated.status)) return {}
  return { requeue: true, delayMs: 2_500 }
}

export async function createArticleBatch(
  input: CreateArticleBatchInput,
  context: ArticleBatchExecutionContext,
): Promise<CreateArticleBatchResult> {
  const ownerUserId = context.actorUserId
  const existing = await findStoredArticleBatchByRequest(ownerUserId, input.requestId)
  if (existing) {
    scheduleArticleBatchMonitor(existing.id)
    return { ok: true, batch: toPublicArticleBatch(existing), reused: true }
  }

  const planned = planArticleBatch({
    count: input.count,
    topicMode: input.topicMode,
    coreQuestion: input.basePayload.coreQuestion,
    keywords: input.basePayload.keywords,
    customTopics: input.customTopics,
    questionTasks: input.questionTasks,
  })
  const batchId = `abatch_${randomUUID().replace(/-/g, "")}`
  const items: StoredArticleBatchItem[] = planned.map(plan => ({
    id: `aitem_${randomUUID().replace(/-/g, "")}`,
    position: plan.position,
    topic: plan.topic,
    brief: plan.brief,
    questionId: plan.questionId,
    intent: plan.intent,
    category: plan.category,
    keyword: plan.keyword,
    contentAngle: plan.contentAngle,
    matchedAdvantage: plan.matchedAdvantage,
    subIntent: plan.subIntent,
    queryStyle: plan.queryStyle,
    methodologyCandidates: plan.methodologyCandidates,
    platformCandidates: plan.platformCandidates,
    targetPlatform: plan.targetPlatform,
    articleFormat: plan.articleFormat,
    brandLayout: plan.brandLayout,
    titleStrategy: plan.titleStrategy,
    knowledgeAssetIds: plan.knowledgeAssetIds,
    methodologyVersion: plan.methodologyVersion,
    promptKey: plan.promptKey,
    promptTitle: plan.promptTitle,
    routeConfidence: plan.routeConfidence,
    routeReason: plan.routeReason,
    missingEvidence: plan.missingEvidence,
    requestId: itemRequestId(batchId, plan.position, 1),
    status: "queued",
    progressPercent: 0,
    stage: "等待创建独立文章任务",
    attempt: 1,
    updatedAt: nowIso(),
  }))
  const stored = createStoredArticleBatchInput({
    id: batchId,
    ownerUserId,
    billingUserId: context.billingUserId,
    runtimeUserId: context.runtimeUserId,
    workspaceOwnerUserId: context.workspaceOwnerUserId,
    teamId: context.teamId,
    clientId: input.clientId,
    requestId: input.requestId,
    promptKey: input.basePayload.promptKey,
    promptTitle: input.topicMode === "strategy" ? "关键词策略自动成文" : input.promptTitle,
    modelProvider: input.basePayload.modelProvider,
    model: input.basePayload.model,
    topicMode: input.topicMode,
    similarityRetry: input.similarityRetry,
    mode: input.topicMode === "strategy" ? "strategy" : "standard",
    mixedPrompts: items.some(item => Boolean(item.promptKey && item.promptKey !== input.basePayload.promptKey)),
    basePayload: input.basePayload,
    items,
  })

  try {
    await saveStoredArticleBatch(stored)
  } catch (error) {
    const raced = await findStoredArticleBatchByRequest(ownerUserId, input.requestId)
    if (raced) return { ok: true, batch: toPublicArticleBatch(raced), reused: true }
    throw error
  }

  const created = await createBackgroundJobsBatch({
    kind: "articleGeneration",
    clientId: input.clientId,
    ownerUserId,
    billingUserId: context.billingUserId,
    runtimeUserId: context.runtimeUserId,
    workspaceOwnerUserId: context.workspaceOwnerUserId,
    teamId: context.teamId,
    batchId,
    items: items.map(item => ({
      requestId: item.requestId,
      payload: itemJobPayload(stored, item),
    })),
  })
  if (!created.ok) {
    const message = await responseMessage(created.response)
    await mutateStoredArticleBatch(batchId, batch => {
      batch.status = "failed"
      batch.stage = "批次任务创建失败"
      batch.error = message
      batch.finishedAt = nowIso()
      for (const item of batch.items) {
        item.status = "failed"
        item.progressPercent = 100
        item.stage = "任务未创建"
        item.error = message
        item.updatedAt = nowIso()
      }
      aggregateBatch(batch)
    })
    return created
  }

  const updated = await mutateStoredArticleBatch(batchId, batch => {
    batch.status = "queued"
    batch.stage = "独立文章任务已进入后台队列"
    batch.items.forEach((item, index) => {
      const job = created.jobs[index]
      item.jobId = job.id
      item.status = "queued"
      item.progressPercent = 0
      item.stage = job.stage
      item.updatedAt = job.updatedAt
    })
  })
  void cleanupArticleArtifacts()
  scheduleArticleBatchMonitor(batchId)
  return { ok: true, batch: toPublicArticleBatch(updated?.batch || stored), reused: false }
}

export async function listArticleBatches(
  ownerUserId: string,
  clientId: string,
): Promise<ArticleBatchRecord[]> {
  const batches = await listOwnedStoredArticleBatches(ownerUserId, clientId)
  for (const batch of batches) {
    if (!TERMINAL_BATCH_STATUSES.has(batch.status)) scheduleArticleBatchMonitor(batch.id)
  }
  return batches.map(toPublicArticleBatch)
}

export async function getArticleBatch(
  id: string,
  ownerUserId: string,
): Promise<ArticleBatchRecord | null> {
  const batch = await getOwnedStoredArticleBatch(id, ownerUserId)
  if (!batch) return null
  if (!TERMINAL_BATCH_STATUSES.has(batch.status)) scheduleArticleBatchMonitor(id)
  return toPublicArticleBatch(batch)
}

export async function deleteArticleBatch(
  id: string,
  ownerUserId: string,
): Promise<"deleted" | "not_found" | "active"> {
  const batch = await getOwnedStoredArticleBatch(id, ownerUserId)
  if (!batch) return "not_found"
  if (!TERMINAL_BATCH_STATUSES.has(batch.status)) return "active"

  const deleted = await deleteOwnedStoredArticleBatch(id, ownerUserId)
  if (!deleted) return "not_found"
  activeMonitors.delete(id)
  await deleteArticleBatchArtifacts(id)
  return "deleted"
}

export async function cancelArticleBatch(
  id: string,
  ownerUserId: string,
): Promise<ArticleBatchRecord | null> {
  const owned = await getOwnedStoredArticleBatch(id, ownerUserId)
  if (!owned) return null
  if (TERMINAL_BATCH_STATUSES.has(owned.status)) return toPublicArticleBatch(owned)
  const mutation = await mutateStoredArticleBatch(id, batch => {
    if (TERMINAL_BATCH_STATUSES.has(batch.status)) return false
    batch.cancelRequested = true
    batch.stage = "正在停止未完成任务"
    return true
  })
  if (!mutation) return null
  if (!mutation.result) {
    await clearTaskCancellation("articleBatch", id)
    return toPublicArticleBatch(mutation.batch)
  }
  await signalTaskCancellation("articleBatch", id, ownerUserId)
  await Promise.all(owned.items
    .filter(item => !TERMINAL_ITEM_STATUSES.has(item.status) && item.jobId)
    .map(item => cancelBackgroundJob(item.jobId || "", ownerUserId).catch(() => null)))
  await syncBatchOnce(id)
  const current = await getOwnedStoredArticleBatch(id, ownerUserId)
  return current ? toPublicArticleBatch(current) : null
}

export async function restartArticleBatch(
  id: string,
  ownerUserId: string,
  requestId: string,
): Promise<CreateArticleBatchResult> {
  const batch = await getOwnedStoredArticleBatch(id, ownerUserId)
  if (!batch) {
    return { ok: false, response: Response.json({ error: "批量任务不存在" }, { status: 404 }) }
  }
  if (!TERMINAL_BATCH_STATUSES.has(batch.status)) {
    return {
      ok: false,
      response: Response.json({ error: "当前批次仍在运行，请先停止后再按原设置重新生成" }, { status: 409 }),
    }
  }

  const customTopics = batch.topicMode === "auto"
    ? ""
    : batch.items
      .slice()
      .sort((left, right) => left.position - right.position)
      .map(item => item.topic)
      .join("\n")

  return createArticleBatch({
    requestId,
    clientId: batch.clientId,
    promptTitle: batch.promptTitle,
    count: batch.requestedCount,
    topicMode: batch.topicMode,
    customTopics,
    questionTasks: batch.topicMode === "questions" || batch.topicMode === "strategy"
      ? batch.items
        .slice()
        .sort((left, right) => left.position - right.position)
        .map(item => ({
          questionId: item.questionId,
          question: item.topic,
          intent: item.intent,
          category: item.category,
          keyword: item.keyword,
          contentAngle: item.contentAngle,
          matchedAdvantage: item.matchedAdvantage,
          subIntent: item.subIntent,
          queryStyle: item.queryStyle,
          methodologyCandidates: item.methodologyCandidates,
          platformCandidates: item.platformCandidates,
          targetPlatform: item.targetPlatform,
          articleFormat: item.articleFormat,
          brandLayout: item.brandLayout,
          titleStrategy: item.titleStrategy,
          knowledgeAssetIds: item.knowledgeAssetIds,
          methodologyVersion: item.methodologyVersion,
          promptKey: item.promptKey,
          promptTitle: item.promptTitle,
          routeConfidence: item.routeConfidence,
          routeReason: item.routeReason,
          missingEvidence: item.missingEvidence,
        }))
      : undefined,
    similarityRetry: batch.similarityRetry,
    basePayload: batch.basePayload,
  }, {
    actorUserId: ownerUserId,
    billingUserId: batch.billingUserId,
    runtimeUserId: batch.runtimeUserId,
    workspaceOwnerUserId: batch.workspaceOwnerUserId,
    teamId: batch.teamId,
  })
}

export async function retryFailedArticleBatchItems(
  id: string,
  ownerUserId: string,
): Promise<CreateArticleBatchResult> {
  const batch = await getOwnedStoredArticleBatch(id, ownerUserId)
  if (!batch) {
    return { ok: false, response: Response.json({ error: "批量任务不存在" }, { status: 404 }) }
  }
  const failed = batch.items.filter(item => item.status === "failed")
  if (failed.length === 0) {
    return { ok: true, batch: toPublicArticleBatch(batch), reused: true }
  }

  const attempts = failed.map(item => item.attempt + 1)
  const requests = failed.map((item, index) => ({
    requestId: itemRequestId(batch.id, item.position, attempts[index]),
    payload: itemJobPayload(batch, { ...item, attempt: attempts[index] }, attempts[index] > 1),
  }))
  let jobs: BackgroundJobRecord[]
  if (requests.length === 1) {
    const created = await createBackgroundJob({
      kind: "articleGeneration",
      clientId: batch.clientId,
      ownerUserId,
      billingUserId: batch.billingUserId,
      runtimeUserId: batch.runtimeUserId,
      workspaceOwnerUserId: batch.workspaceOwnerUserId,
      teamId: batch.teamId,
      requestId: requests[0].requestId,
      payload: requests[0].payload,
    })
    if (!created.ok) return created
    jobs = [created.job]
  } else {
    const created = await createBackgroundJobsBatch({
      kind: "articleGeneration",
      clientId: batch.clientId,
      ownerUserId,
      billingUserId: batch.billingUserId,
      runtimeUserId: batch.runtimeUserId,
      workspaceOwnerUserId: batch.workspaceOwnerUserId,
      teamId: batch.teamId,
      batchId: batch.id,
      items: requests,
    })
    if (!created.ok) return created
    jobs = created.jobs
  }

  const updated = await mutateStoredArticleBatch(id, current => {
    current.cancelRequested = false
    current.finishedAt = undefined
    current.error = undefined
    current.status = "queued"
    current.stage = `已重新提交 ${failed.length} 篇失败文章`
    failed.forEach((failedItem, index) => {
      const item = current.items.find(candidate => candidate.id === failedItem.id)
      if (!item) return
      item.jobId = jobs[index].id
      item.requestId = requests[index].requestId
      item.attempt = attempts[index]
      item.status = "queued"
      item.progressPercent = 0
      item.stage = "失败文章已重新进入队列"
      item.error = undefined
      item.fallbackMarkdown = undefined
      item.updatedAt = nowIso()
    })
    aggregateBatch(current)
  })
  scheduleArticleBatchMonitor(id)
  return { ok: true, batch: toPublicArticleBatch(updated?.batch || batch), reused: false }
}

export async function getArticleBatchDocx(args: {
  batchId: string
  itemId: string
  ownerUserId: string
}): Promise<{ buffer: Buffer; fileName: string } | null> {
  const batch = await getOwnedStoredArticleBatch(args.batchId, args.ownerUserId)
  const item = batch?.items.find(candidate => candidate.id === args.itemId)
  if (!batch || !item || item.status !== "succeeded" || !item.markdown) return null
  const artifact = await readArticleDocxArtifact({
    batchId: batch.id,
    itemId: item.id,
    position: item.position,
    markdown: item.markdown,
    title: item.title || `${batch.promptTitle}-${item.position}`,
    fileName: item.fileName,
    artifactPath: item.artifactPath,
  })
  if (item.artifactPath !== artifact.artifactPath || item.fileName !== artifact.fileName) {
    await mutateStoredArticleBatch(batch.id, current => {
      const currentItem = current.items.find(candidate => candidate.id === item.id)
      if (!currentItem) return
      currentItem.artifactPath = artifact.artifactPath
      currentItem.fileName = artifact.fileName
      currentItem.updatedAt = nowIso()
    })
  }
  return { buffer: artifact.buffer, fileName: artifact.fileName }
}

export async function getArticleBatchDownloadItems(
  batchId: string,
  ownerUserId: string,
): Promise<Array<{ itemId: string; position: number; title: string; buffer: Buffer; fileName: string }> | null> {
  const batch = await getOwnedStoredArticleBatch(batchId, ownerUserId)
  if (!batch) return null
  const completed = batch.items.filter(item => item.status === "succeeded" && item.markdown)
  const files = []
  for (const item of completed) {
    const file = await getArticleBatchDocx({ batchId, itemId: item.id, ownerUserId })
    if (!file) continue
    files.push({
      itemId: item.id,
      position: item.position,
      title: item.title || item.topic,
      buffer: file.buffer,
      fileName: file.fileName,
    })
  }
  return files
}
