import "server-only"

import { createHash, randomUUID } from "node:crypto"
import {
  cancelArticleBatch,
  createArticleBatch,
  getArticleBatch,
} from "@/lib/article-batches/manager"
import type { ArticleBatchBasePayload } from "@/lib/article-batches/store"
import { DEFAULT_ARTICLE_MODEL_PROVIDER } from "@/lib/article-model-default"
import { resolveArticleModel } from "@/lib/article-models"
import { getArticlePromptOption } from "@/lib/article-prompt-meta"
import { routeArticleStrategyTasks } from "@/lib/article-strategy-service"
import { fallbackArticleStrategyRoute } from "@/lib/article-strategy-routing"
import {
  normalizeArticleVideoScriptConfig,
  BRAND_VIDEO_SCRIPT_PROMPT_KEY,
} from "@/lib/article-video-script"
import { normalizeClientKnowledgeBase } from "@/lib/client-knowledge-base"
import {
  createContentProductionRun,
  getContentProductionRun,
  getContentProductionRunById,
  listActiveContentProductionRunsForUser,
  listPendingContentProductionRuns,
  mutateContentProductionRun,
} from "@/lib/content-production/store"
import { getClientSubjectType, formatPersonSubjectContext } from "@/lib/analysis-subject"
import { normalizeArticleMethodologySelection } from "@/lib/geo-methodology/compiler"
import { GEO_METHODOLOGY_VERSION } from "@/lib/geo-methodology/registry"
import { classifyQuestionMethodology } from "@/lib/geo-strategy/question-methodology"
import {
  resolveAssetTargetPlatform,
  resolvePublishingPlatformProfile,
} from "@/lib/publishing-plan/platform-profiles"
import {
  getPublishingPlan,
  updatePublishingAssetGeneration,
} from "@/lib/publishing-plan/store"
import { syncContentProductionTask } from "@/lib/task-center/adapters"
import {
  dispatchDurableTaskOrFallback,
  type TaskWorkerOutcome,
} from "@/lib/task-queue"
import {
  isTaskCancellationRequested,
  signalTaskCancellation,
} from "@/lib/task-cancellation"
import { getWorkspaceClientSections } from "@/lib/workspace-store"
import {
  composeClientData,
  WORKSPACE_SECTIONS,
} from "@/lib/workspace-sync"
import type {
  ArticleBatchQuestionTask,
  ArticleBatchRecord,
  ArticleComparisonBrand,
  ArticleModelProviderKey,
  ArticlePromptKey,
  Client,
} from "@/types"
import type {
  ContentProductionItem,
  ContentProductionRun,
  ContentProductionRunStatus,
} from "@/types/content-production"
import type {
  PublishingPlan,
  PublishingTask,
} from "@/types/publishing-plan"

const TERMINAL_RUN_STATUSES = new Set<ContentProductionRunStatus>([
  "succeeded",
  "partial",
  "failed",
  "cancelled",
])

export interface StartContentProductionInput {
  requestId: string
  ownerUserId: string
  actorUserId: string
  billingUserId: string
  teamId?: string
  client: Client
  plan: PublishingPlan
  tasks: PublishingTask[]
  dateFrom: string
  dateTo: string
  selectedPlatformKeys?: string[]
  modelProvider?: ArticleModelProviderKey
  model?: string
}

export interface StartContentProductionResult {
  run: ContentProductionRun
  reused: boolean
}

export async function startContentProductionRun(
  input: StartContentProductionInput,
): Promise<StartContentProductionResult> {
  const requestedProvider = input.modelProvider
    || input.client.articleGeneration?.modelProvider
    || DEFAULT_ARTICLE_MODEL_PROVIDER
  const requestedModel = input.model
    || input.client.articleGeneration?.model
    || ""
  const resolvedModel = await resolveArticleModel(requestedProvider, requestedModel)
  if (!resolvedModel.apiKey || !resolvedModel.model) {
    throw new Error(`${resolvedModel.label}尚未完成配置`)
  }

  const now = new Date().toISOString()
  const items = buildContentProductionItems(input.plan, input.tasks, now)
  if (items.length === 0) throw new Error("当前日期范围没有可以生成的发布任务")
  const missingQuestions = items.filter(item => !item.question.trim())
  if (missingQuestions.length > 0) {
    throw new Error(`有 ${missingQuestions.length} 项内容没有关联疑问句，请用最新关键词策略重新生成发布规划`)
  }

  const run: ContentProductionRun = {
    id: `cprod_${randomUUID().replace(/-/g, "")}`,
    ownerUserId: input.ownerUserId,
    clientId: input.client.id,
    clientName: input.client.name,
    planId: input.plan.id,
    planVersion: input.plan.version,
    requestId: input.requestId,
    createdByUserId: input.actorUserId,
    articleOwnerUserId: input.actorUserId,
    billingUserId: input.billingUserId,
    teamId: input.teamId,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    selectedPlatformKeys: input.selectedPlatformKeys || [],
    modelProvider: resolvedModel.providerKey,
    model: resolvedModel.model,
    status: "preparing",
    stage: "正在整理疑问句、优势与平台要求",
    requestedPublicationCount: input.tasks.length,
    requestedAssetCount: items.length,
    completedCount: 0,
    passedCount: 0,
    reviewRequiredCount: 0,
    failedCount: 0,
    cancelledCount: 0,
    orchestrationBatchSize: contentProductionBatchSize(),
    childBatches: [],
    items,
    createdAt: now,
    updatedAt: now,
  }

  const created = await createContentProductionRun(run)
  if (created.reused) {
    return { run: await syncContentProductionRun(created.run), reused: true }
  }
  await syncContentProductionTask(created.run)
  scheduleContentProductionRun(created.run.id)
  return { run: created.run, reused: false }
}

const activeLocalProductionRuns = new Set<string>()

export function scheduleContentProductionRun(runId: string): void {
  void dispatchDurableTaskOrFallback(
    "contentProduction",
    runId,
    () => scheduleLocalContentProductionRun(runId),
  )
}

function scheduleLocalContentProductionRun(runId: string): void {
  if (activeLocalProductionRuns.has(runId)) return
  activeLocalProductionRuns.add(runId)
  void runContentProductionFromWorker(runId)
    .then(outcome => {
      activeLocalProductionRuns.delete(runId)
      if (!outcome.requeue) return
      const timer = setTimeout(
        () => scheduleLocalContentProductionRun(runId),
        Math.max(0, Math.floor(outcome.delayMs || 0)),
      )
      timer.unref()
    })
    .catch(error => {
      activeLocalProductionRuns.delete(runId)
      console.error("[content-production] local orchestration failed", runId, safeError(error))
    })
}

export async function resumePendingContentProductionRuns(): Promise<void> {
  const runs = await listPendingContentProductionRuns(
    Math.max(10, Math.min(2_000, Number(process.env.CONTENT_PRODUCTION_RECOVERY_LIMIT) || 500)),
  )
  for (const run of runs) {
    if (run.items.some(item => item.status === "planned")) {
      scheduleContentProductionRun(run.id)
    }
  }
}

export async function runContentProductionFromWorker(
  runId: string,
): Promise<TaskWorkerOutcome> {
  const source = await getContentProductionRunById(runId)
  if (!source || TERMINAL_RUN_STATUSES.has(source.status)) return {}
  if (await isTaskCancellationRequested("contentProduction", runId)) {
    await cancelContentProductionRun(source)
    return {}
  }

  const started = await mutateContentProductionRun(source.ownerUserId, source.id, run => {
    run.orchestrationAttempts = Math.max(0, run.orchestrationAttempts || 0) + 1
    run.orchestrationStartedAt = run.orchestrationStartedAt || new Date().toISOString()
    run.orchestrationLastError = undefined
    run.error = undefined
    run.status = "preparing"
    run.stage = "正在匹配创作类型并拆分后台任务"
  })
  if (!started) return {}
  await syncContentProductionTask(started.run)

  try {
    await launchContentProductionRun(started.run)
    return {}
  } catch (error) {
    const message = safeError(error)
    const fresh = await getContentProductionRunById(runId)
    if (!fresh || TERMINAL_RUN_STATUSES.has(fresh.status)) return {}
    if (await isTaskCancellationRequested("contentProduction", runId)) {
      await cancelContentProductionRun(fresh)
      return {}
    }
    const attempts = Math.max(1, fresh.orchestrationAttempts || 1)
    const retryLimit = Math.max(
      1,
      Math.min(6, Number(process.env.CONTENT_PRODUCTION_ORCHESTRATION_ATTEMPTS) || 3),
    )
    const retrying = attempts < retryLimit
    const mutation = await mutateContentProductionRun(fresh.ownerUserId, fresh.id, run => {
      run.orchestrationLastError = message
      if (retrying) {
        run.status = "preparing"
        run.stage = `任务准备暂时中断，正在进行第 ${attempts + 1} 次恢复`
        return
      }
      run.error = `内容生产任务准备失败：${message}`.slice(0, 1_000)
      run.orchestrationFinishedAt = new Date().toISOString()
      for (const item of run.items) {
        if (item.status !== "planned") continue
        item.status = "failed"
        item.error = run.error
        item.updatedAt = new Date().toISOString()
      }
      aggregateRun(run)
    })
    if (mutation) await syncContentProductionTask(mutation.run)
    return retrying
      ? { requeue: true, delayMs: Math.min(60_000, 5_000 * 2 ** (attempts - 1)) }
      : {}
  }
}

async function launchContentProductionRun(source: ContentProductionRun): Promise<void> {
  const [plan, snapshot] = await Promise.all([
    getPublishingPlan(source.ownerUserId, source.planId, true),
    getWorkspaceClientSections(source.ownerUserId, source.clientId, WORKSPACE_SECTIONS),
  ])
  if (!plan || plan.version !== source.planVersion) {
    throw new Error("发布规划版本不存在或已失效")
  }
  if (!snapshot) throw new Error("客户档案不存在")
  const client = composeClientData(snapshot.sections)
  const resolvedModel = await resolveArticleModel(source.modelProvider, source.model)
  if (!resolvedModel.apiKey || !resolvedModel.model) {
    throw new Error(`${resolvedModel.label}尚未完成配置`)
  }

  const latest = await getContentProductionRun(source.ownerUserId, source.id)
  if (!latest || TERMINAL_RUN_STATUSES.has(latest.status)) return
  const pendingItems = latest.items.filter(item => item.status === "planned")
  if (pendingItems.length === 0) {
    const finished = await mutateContentProductionRun(latest.ownerUserId, latest.id, run => {
      run.orchestrationFinishedAt = run.orchestrationFinishedAt || new Date().toISOString()
      aggregateRun(run)
    })
    if (finished) await syncContentProductionTask(finished.run)
    return
  }

  const comparisonBrands = comparisonBrandsForClient(client)
  const routedTasks = await routeProductionItems({
    run: latest,
    items: pendingItems,
    plan,
    model: resolvedModel,
    comparisonBrandCount: comparisonBrands.length,
    billingUserId: latest.billingUserId || latest.articleOwnerUserId,
  })
  const groups = groupRoutedTasks(
    routedTasks,
    latest.orchestrationBatchSize || contentProductionBatchSize(),
  )
  const basePayload = productionBasePayload(client, {
    modelProvider: resolvedModel.providerKey,
    model: resolvedModel.model,
    comparisonBrands,
  })
  const errors: string[] = []

  for (const group of groups) {
    const current = await getContentProductionRun(latest.ownerUserId, latest.id)
    if (!current || TERMINAL_RUN_STATUSES.has(current.status)) return
    if (await isTaskCancellationRequested("contentProduction", current.id)) {
      await cancelContentProductionRun(current)
      return
    }
    if (group.itemIds.every(itemId => current.items.find(item => item.id === itemId)?.articleBatchId)) {
      continue
    }

    const requestId = productionBatchRequestId(current, group.itemIds)
    const promptKey = group.tasks[0]?.promptKey || "thirdPartyObservation"
    const result = await createArticleBatch({
      requestId,
      clientId: current.clientId,
      promptTitle: getArticlePromptOption(promptKey)?.title || "发布计划自动成文",
      count: group.tasks.length,
      topicMode: "strategy",
      questionTasks: group.tasks,
      similarityRetry: true,
      basePayload: {
        ...basePayload,
        promptKey,
        coreQuestion: group.tasks[0]?.question || basePayload.coreQuestion,
      },
    }, {
      actorUserId: current.articleOwnerUserId,
      billingUserId: current.billingUserId || current.articleOwnerUserId,
      runtimeUserId: current.billingUserId || current.articleOwnerUserId,
      workspaceOwnerUserId: current.ownerUserId,
      teamId: current.teamId,
    })

    if (!result.ok) {
      const message = await responseError(result.response)
      errors.push(message)
      await mutateContentProductionRun(current.ownerUserId, current.id, run => {
        for (const itemId of group.itemIds) {
          const item = run.items.find(candidate => candidate.id === itemId)
          if (!item || item.articleBatchId) continue
          item.status = "failed"
          item.error = message
          item.updatedAt = new Date().toISOString()
        }
        aggregateRun(run)
      })
      continue
    }

    const batchItems = [...result.batch.items].sort((left, right) => left.position - right.position)
    const updated = await mutateContentProductionRun(current.ownerUserId, current.id, run => {
      if (!run.childBatches.some(child => child.id === result.batch.id)) {
        run.childBatches.push({
          id: result.batch.id,
          requestId,
          itemIds: group.itemIds,
          createdAt: new Date().toISOString(),
        })
      }
      group.itemIds.forEach((itemId, itemIndex) => {
        const item = run.items.find(candidate => candidate.id === itemId)
        const articleItem = batchItems[itemIndex]
        if (!item || !articleItem) return
        item.articleBatchId = result.batch.id
        item.articleItemId = articleItem.id
        item.articleBatchStatus = articleItem.status
        item.promptKey = articleItem.promptKey || promptKey
        item.promptTitle = articleItem.promptTitle || result.batch.promptTitle
        item.status = "queued"
        item.updatedAt = new Date().toISOString()
      })
      aggregateRun(run)
    })
    await Promise.all(group.itemIds.map(async itemId => {
      const item = updated?.run.items.find(candidate => candidate.id === itemId)
      if (!item) return
      await updatePublishingAssetGeneration({
        ownerUserId: current.ownerUserId,
        assetId: item.assetId,
        status: "generating",
        generationJobId: result.batch.id,
        generatedArticleId: item.articleItemId,
      })
    }))
  }

  const finished = await mutateContentProductionRun(latest.ownerUserId, latest.id, run => {
    run.orchestrationFinishedAt = new Date().toISOString()
    run.orchestrationLastError = errors.length > 0 ? errors.join("；").slice(0, 1_000) : undefined
    if (errors.length > 0 && run.childBatches.length === 0) {
      run.error = run.orchestrationLastError
    }
    aggregateRun(run)
  })
  if (finished) await syncContentProductionTask(finished.run)
}

export async function syncContentProductionRun(
  source: ContentProductionRun,
): Promise<ContentProductionRun> {
  if (TERMINAL_RUN_STATUSES.has(source.status)) {
    await syncContentProductionTask(source)
    return source
  }
  if (source.items.some(item => item.status === "planned")) {
    scheduleContentProductionRun(source.id)
  }
  const batches = await Promise.all(source.childBatches.map(child => (
    getArticleBatch(child.id, source.articleOwnerUserId)
  )))
  const batchMap = new Map<string, ArticleBatchRecord>()
  batches.forEach(batch => {
    if (batch) batchMap.set(batch.id, batch)
  })

  const changedAssets: ContentProductionItem[] = []
  const mutation = await mutateContentProductionRun(source.ownerUserId, source.id, run => {
    for (const item of run.items) {
      if (!item.articleBatchId || !item.articleItemId) continue
      const batch = batchMap.get(item.articleBatchId)
      const articleItem = batch?.items.find(candidate => candidate.id === item.articleItemId)
      if (!articleItem) {
        if (batch && TERMINAL_RUN_STATUSES.has(batch.status as ContentProductionRunStatus)) {
          item.status = "failed"
          item.error = "文章任务结果不存在"
          item.updatedAt = new Date().toISOString()
          changedAssets.push({ ...item })
        }
        continue
      }
      const previous = item.status
      const previousTitle = item.title
      item.articleBatchStatus = articleItem.status
      item.qualityStatus = articleItem.qualityStatus
      item.title = articleItem.title
      item.fileName = articleItem.fileName
      item.error = articleItem.error
      item.status = productionItemStatus(articleItem)
      item.updatedAt = articleItem.updatedAt
      if (previous !== item.status || previousTitle !== item.title) changedAssets.push({ ...item })
    }
    aggregateRun(run)
  })
  const run = mutation?.run || source
  await Promise.all(changedAssets.map(item => updatePublishingAssetGeneration({
    ownerUserId: run.ownerUserId,
    assetId: item.assetId,
    status: item.status === "ready" || item.status === "review_required"
      ? "ready"
      : item.status === "failed" || item.status === "cancelled"
        ? "failed"
        : "generating",
    generationJobId: item.articleBatchId,
    generatedArticleId: item.articleItemId,
    title: item.title,
  })))
  await syncContentProductionTask(run)
  return run
}

export async function cancelContentProductionRun(
  source: ContentProductionRun,
): Promise<ContentProductionRun> {
  await signalTaskCancellation(
    "contentProduction",
    source.id,
    source.createdByUserId,
  )
  await Promise.all(source.childBatches.map(child => (
    cancelArticleBatch(child.id, source.articleOwnerUserId).catch(() => null)
  )))
  const mutation = await mutateContentProductionRun(source.ownerUserId, source.id, run => {
    for (const item of run.items) {
      if (["ready", "review_required", "failed", "cancelled"].includes(item.status)) continue
      item.status = "cancelled"
      item.error = "用户已停止内容生产"
      item.updatedAt = new Date().toISOString()
    }
    run.orchestrationFinishedAt = run.orchestrationFinishedAt || new Date().toISOString()
    aggregateRun(run)
  })
  const run = mutation?.run || source
  await syncContentProductionTask(run)
  return run
}

const reconcileTimestamps = new Map<string, number>()

export async function reconcileContentProductionRunsForUser(userId: string): Promise<void> {
  const now = Date.now()
  const previous = reconcileTimestamps.get(userId) || 0
  if (now - previous < 2_500) return
  reconcileTimestamps.set(userId, now)
  const runs = await listActiveContentProductionRunsForUser(userId, 10)
  await Promise.all(runs.map(run => syncContentProductionRun(run)))
}

function buildContentProductionItems(
  plan: PublishingPlan,
  tasks: PublishingTask[],
  createdAt: string,
): ContentProductionItem[] {
  const assets = new Map(plan.calculation.assets.map(asset => [asset.id, asset]))
  const configs = new Map(plan.input.platformConfigs.map(config => [config.platformKey, config]))
  const grouped = new Map<string, PublishingTask[]>()
  for (const task of tasks) grouped.set(task.assetId, [...(grouped.get(task.assetId) || []), task])

  return [...grouped.entries()].flatMap(([assetId, deliveries]) => {
    const asset = assets.get(assetId)
    if (!asset) return []
    const platformConfigs = deliveries.flatMap(task => {
      const config = configs.get(task.platformKey)
      return config ? [config] : []
    })
    const profiles = platformConfigs.map(resolvePublishingPlatformProfile)
    const reuseMode = deliveries.length > 1
      ? "master_reuse" as const
      : profiles[0]?.defaultReuseMode || "master_reuse"
    return [{
      id: `cpitem_${randomUUID().replace(/-/g, "")}`,
      assetId,
      contentType: asset.contentType,
      plannedDate: deliveries.map(task => task.plannedDate).sort()[0] || asset.plannedDate,
      questionId: asset.questionId,
      question: String(asset.question || "").trim(),
      matchedAdvantage: asset.matchedAdvantage,
      reuseMode,
      targetPlatform: resolveAssetTargetPlatform(platformConfigs, asset.contentType),
      promptKey: asset.promptKey as ArticlePromptKey | undefined,
      deliveries: deliveries
        .sort((left, right) => left.plannedDate.localeCompare(right.plannedDate) || left.platformName.localeCompare(right.platformName, "zh-CN"))
        .map(task => ({
          publishingTaskId: task.id,
          plannedDate: task.plannedDate,
          platformKey: task.platformKey,
          platformName: task.platformName,
          accountSlot: task.accountSlot,
        })),
      status: "planned" as const,
      createdAt,
      updatedAt: createdAt,
    }]
  }).sort((left, right) => left.plannedDate.localeCompare(right.plannedDate) || left.assetId.localeCompare(right.assetId))
}

async function routeProductionItems(args: {
  run: ContentProductionRun
  items?: ContentProductionItem[]
  plan: PublishingPlan
  model: Awaited<ReturnType<typeof resolveArticleModel>>
  comparisonBrandCount: number
  billingUserId: string
}): Promise<Array<{ itemId: string; task: ArticleBatchQuestionTask; contentType: ContentProductionItem["contentType"] }>> {
  const platformConfigs = new Map(args.plan.input.platformConfigs.map(config => [config.platformKey, config]))
  const raw = (args.items || args.run.items).map(item => {
    const methodology = classifyQuestionMethodology({
      category: "痛点解决型",
      question: item.question,
    })
    const profiles = item.deliveries.flatMap(delivery => {
      const config = platformConfigs.get(delivery.platformKey)
      return config ? [resolvePublishingPlatformProfile(config)] : []
    })
    const platformNames = [...new Set(item.deliveries.map(delivery => delivery.platformName))]
    const platformHint = item.reuseMode === "master_reuse"
      ? `本篇作为跨平台母稿，将用于：${platformNames.join("、")}。保持结构通用，不写平台专属开场。`
      : `${platformNames[0] || "目标平台"}要求：${profiles[0]?.generationHint || "使用清晰、可核验的内容结构。"}`
    const task: ArticleBatchQuestionTask = {
      questionId: item.questionId || item.assetId,
      questionSource: "keyword_strategy",
      question: item.question,
      category: "痛点解决型",
      contentAngle: platformHint,
      matchedAdvantage: item.matchedAdvantage,
      subIntent: methodology.subIntent,
      queryStyle: methodology.queryStyle,
      methodologyCandidates: methodology.methodologyCandidates,
      platformCandidates: [item.targetPlatform],
      targetPlatform: item.targetPlatform,
      articleFormat: methodology.articleFormatCandidates[0] || "auto",
      titleStrategy: methodology.titleStrategyCandidates[0] || "auto",
      methodologyVersion: GEO_METHODOLOGY_VERSION,
      promptKey: item.promptKey,
    }
    return { itemId: item.id, task, contentType: item.contentType }
  })

  const articleRows = raw.filter(row => row.contentType !== "video")
  const routeChunkSize = Math.max(
    5,
    Math.min(30, Number(process.env.CONTENT_PRODUCTION_ROUTE_CHUNK_SIZE) || 16),
  )
  const routeConcurrency = Math.max(
    1,
    Math.min(4, Number(process.env.CONTENT_PRODUCTION_ROUTE_CONCURRENCY) || 2),
  )
  const routeChunks = chunkValues(articleRows, routeChunkSize)
  const routedArticles = (await mapWithConcurrency(
    routeChunks,
    routeConcurrency,
    chunk => routeArticleStrategyTasks({
      tasks: chunk.map(row => row.task),
      model: args.model,
      comparisonBrandCount: args.comparisonBrandCount,
      userId: args.billingUserId,
    }),
  )).flat()
  let articleIndex = 0
  return raw.map(row => {
    if (row.contentType === "video") {
      const option = getArticlePromptOption(BRAND_VIDEO_SCRIPT_PROMPT_KEY)
      return {
        ...row,
        task: {
          ...row.task,
          promptKey: BRAND_VIDEO_SCRIPT_PROMPT_KEY,
          promptTitle: option?.title || "品牌短视频 · 单问题文案",
          articleFormat: "directAnswerGuide",
          brandLayout: "singlePrimary",
          routeConfidence: 1,
          routeReason: "发布规划要求短视频内容，使用单问题视频文案模板。",
        },
      }
    }
    const routed = routedArticles[articleIndex++] || fallbackArticleStrategyRoute({
      task: row.task,
      comparisonBrandCount: args.comparisonBrandCount,
    })
    return { ...row, task: routed }
  })
}

function groupRoutedTasks(
  routed: Array<{ itemId: string; task: ArticleBatchQuestionTask; contentType: ContentProductionItem["contentType"] }>,
  size: number,
): Array<{ itemIds: string[]; tasks: ArticleBatchQuestionTask[] }> {
  const groups: Array<{ itemIds: string[]; tasks: ArticleBatchQuestionTask[] }> = []
  for (const contentType of ["article", "authority_article", "video"] as const) {
    const rows = routed.filter(row => row.contentType === contentType)
    for (let offset = 0; offset < rows.length; offset += size) {
      const chunk = rows.slice(offset, offset + size)
      groups.push({
        itemIds: chunk.map(row => row.itemId),
        tasks: chunk.map(row => row.task),
      })
    }
  }
  return groups
}

function productionBasePayload(
  client: Client,
  model: {
    modelProvider: ArticleModelProviderKey
    model: string
    comparisonBrands: ArticleComparisonBrand[]
  },
): ArticleBatchBasePayload {
  const saved = client.articleGeneration
  const subjectType = getClientSubjectType(client)
  return {
    promptKey: "thirdPartyObservation",
    modelProvider: model.modelProvider,
    model: model.model,
    clientName: client.name,
    brandName: client.ourBrand || client.name,
    subjectType,
    subjectContext: subjectType === "person" ? formatPersonSubjectContext(client.personProfile) : "",
    industry: client.industry,
    website: client.website,
    coreQuestion: client.keywordStrategy?.questions?.[0]?.question || client.questions[0] || client.industry,
    keywords: saved?.keywords || "",
    region: saved?.region || "",
    business: saved?.business || client.industry,
    advantages: "",
    comparisonBrands: model.comparisonBrands,
    methodology: normalizeArticleMethodologySelection(saved?.methodology),
    knowledgeBase: normalizeClientKnowledgeBase(client.knowledgeBase, {
      subjectType,
      subjectName: client.ourBrand || client.name,
      aliases: client.brandAliases,
    }),
    audience: saved?.audience || "",
    extraRequirements: saved?.extraRequirements || "",
    videoScriptConfig: normalizeArticleVideoScriptConfig(saved?.videoScriptConfig, {
      coreProductService: saved?.business || client.industry,
    }),
  }
}

function comparisonBrandsForClient(client: Client): ArticleComparisonBrand[] {
  const saved = client.articleGeneration?.comparisonBrands || []
  if (saved.length > 0) return saved.slice(0, 9)
  return client.competitors.slice(0, 9).map((name, index) => ({
    id: `plan_competitor_${index + 1}`,
    name,
    aliases: [],
    materials: "",
    sourceUrls: [],
    role: "peer" as const,
  }))
}

function productionItemStatus(item: ArticleBatchRecord["items"][number]): ContentProductionItem["status"] {
  if (item.status === "cancelled") return "cancelled"
  if (item.status === "failed") return item.hasDraft ? "review_required" : "failed"
  if (item.status === "succeeded") {
    return item.qualityStatus === "review_required" ? "review_required" : "ready"
  }
  if (item.status === "running" || item.status === "word_processing") return "running"
  return "queued"
}

function contentProductionBatchSize(): number {
  return Math.max(
    5,
    Math.min(30, Number(process.env.CONTENT_PRODUCTION_BATCH_SIZE) || 20),
  )
}

function productionBatchRequestId(
  run: ContentProductionRun,
  itemIds: string[],
): string {
  const digest = createHash("sha256")
    .update([...itemIds].sort().join("|"))
    .digest("hex")
    .slice(0, 20)
  return `${run.requestId.slice(0, 130)}_cp_${digest}`.slice(0, 160)
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let offset = 0; offset < values.length; offset += size) {
    chunks.push(values.slice(offset, offset + size))
  }
  return chunks
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (values.length === 0) return []
  const results = new Array<R>(values.length)
  let cursor = 0
  await Promise.all(Array.from(
    { length: Math.min(values.length, Math.max(1, concurrency)) },
    async () => {
      for (;;) {
        const index = cursor++
        if (index >= values.length) return
        results[index] = await worker(values[index], index)
      }
    },
  ))
  return results
}

function safeError(value: unknown): string {
  return (value instanceof Error ? value.message : String(value || "任务失败"))
    .replace(/sk-[A-Za-z0-9_.*-]{6,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer ***")
    .replace(/\s+/g, " ")
    .slice(0, 600)
}

function aggregateRun(run: ContentProductionRun): void {
  run.passedCount = run.items.filter(item => item.status === "ready").length
  run.reviewRequiredCount = run.items.filter(item => item.status === "review_required").length
  run.completedCount = run.passedCount + run.reviewRequiredCount
  run.failedCount = run.items.filter(item => item.status === "failed").length
  run.cancelledCount = run.items.filter(item => item.status === "cancelled").length
  const terminalCount = run.completedCount + run.failedCount + run.cancelledCount
  const running = run.items.some(item => item.status === "running")
  const queued = run.items.some(item => item.status === "queued" || item.status === "planned")

  if (terminalCount >= run.items.length) {
    run.finishedAt = run.finishedAt || new Date().toISOString()
    if (run.completedCount === run.items.length && run.reviewRequiredCount === 0) {
      run.status = "succeeded"
      run.stage = `${run.completedCount} 篇内容已全部生成并通过质检`
    } else if (run.completedCount > 0) {
      run.status = "partial"
      run.stage = `已生成 ${run.completedCount} 篇，另有 ${run.failedCount + run.cancelledCount} 篇未完成`
    } else if (run.cancelledCount === run.items.length) {
      run.status = "cancelled"
      run.stage = "内容生产已停止"
    } else {
      run.status = "failed"
      run.stage = "内容生产未完成"
    }
    return
  }
  run.status = running ? "running" : queued ? "queued" : "preparing"
  run.stage = running
    ? `正在生成 ${run.items.length - terminalCount} 篇内容`
    : queued
      ? `${run.items.length - terminalCount} 篇内容正在等待生成`
      : "正在准备内容生产任务"
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.clone().json() as { error?: string }
    return String(body.error || `文章批次创建失败（HTTP ${response.status}）`).slice(0, 600)
  } catch {
    return `文章批次创建失败（HTTP ${response.status}）`
  }
}
