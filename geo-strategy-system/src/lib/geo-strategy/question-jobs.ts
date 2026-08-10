import "server-only"

import { randomUUID } from "crypto"
import { kv } from "@/lib/kv"
import {
  dispatchDurableTaskOrFallback,
  type TaskWorkerOutcome,
} from "@/lib/task-queue"
import { createInternalApiHeaders } from "@/lib/internal-api"
import { settleReservedCredits, type CreditReservation } from "@/lib/with-credits"
import { estimateFeatureCredits, getFeaturePrice } from "@/lib/pricing"
import { syncQuestionJobTask } from "@/lib/task-center/adapters"
import { buildQuestionSystemOutputRecord } from "@/lib/system-output/builders"
import { saveSystemOutputRecord } from "@/lib/system-output/store"
import { mutateWorkspaceClientLatest } from "@/lib/workspace-store"
import {
  clearTaskCancellation,
  registerTaskAbortController,
  signalTaskCancellation,
} from "@/lib/task-cancellation"
import { attachQuestionAdvantages, extractQuestionAdvantages } from "./question-advantages"
import { classifyQuestionMethodology } from "./question-methodology"
import {
  QUESTION_BATCH_SIZE,
  buildQuestionBatchPlan,
  type QuestionAllocationOverride,
  type QuestionBatchPlan,
  type QuestionCategoryKey,
} from "./question-batching"
import {
  areNearDuplicateQuestions,
  normalizeGeoQuestionOptimization,
  normalizeKeywordStrategySettings,
} from "./keyword-strategy-methodology"
import { researchKeywordStrategyContext } from "./keyword-strategy-research"
import {
  applyQuestionJobToKeywordStrategy,
  type QuestionWorkspacePhase,
} from "./question-workspace-state"
import type {
  GeoStrategyPlan,
  QuestionCategoryConfig,
  QuestionItem,
  QuestionJobRecord,
  QuestionModelProvider,
  KeywordStrategyResearchAudit,
} from "@/types/geo-strategy"
import {
  DEFAULT_QUESTION_MODEL_PROVIDER,
  normalizeQuestionModel,
  normalizeQuestionModelProvider,
} from "@/types/geo-strategy"

interface QuestionJobRequest {
  clientId?: string
  clientName?: string
  strategy: GeoStrategyPlan
  totalCount: number
  categoryConfig: QuestionCategoryConfig
  questionModelProvider?: QuestionModelProvider
  questionModel?: string
  coreKeywords: string[]
  customKeywords: string[]
  painScenarioKeywords?: string[]
  customPainScenarios?: string[]
  allocationOverrides?: QuestionAllocationOverride[]
}

type StoredQuestionJobRecord = QuestionJobRecord & {
  request: QuestionJobRequest
  batchBaseUrls: string[]
  ownerUserId: string
  billingUserId?: string
  workspaceOwnerUserId?: string
  teamId?: string
  reservedCredits: number
  creditsSettledAt?: string
}

type QuestionsResponse = {
  question_strategy?: QuestionItem[]
  warnings?: string[]
  error?: string
}

const QUESTION_GENERATION_LIMIT = 600
const QUESTION_JOB_MAX_BATCH_ATTEMPTS = 3
const QUESTION_JOB_BATCH_TIMEOUT_MS = 12 * 60 * 1000
const QUESTION_JOB_TTL_SECONDS = 60 * 60 * 24
const QUESTION_JOB_CANCELLED_MESSAGE = "用户已停止生成"
const QUESTION_PENDING_SET_KEY = "geo:question-jobs:pending"
const QUESTION_JOB_BATCH_CONCURRENCY = Math.max(
  1,
  Math.min(6, Math.floor(Number(process.env.QUESTION_JOB_BATCH_CONCURRENCY) || 3)),
)

const memoryJobs = new Map<string, StoredQuestionJobRecord>()
const activeJobs = new Set<string>()
const activeAbortControllers = new Map<string, Set<AbortController>>()

const jobKey = (id: string) => `geo:question-jobs:${id}`

function toPublicJob(job: StoredQuestionJobRecord): QuestionJobRecord {
  const publicJob: Partial<StoredQuestionJobRecord> = { ...job }
  delete publicJob.request
  delete publicJob.batchBaseUrls
  delete publicJob.ownerUserId
  delete publicJob.billingUserId
  delete publicJob.workspaceOwnerUserId
  delete publicJob.teamId
  delete publicJob.reservedCredits
  delete publicJob.creditsSettledAt
  return publicJob as QuestionJobRecord
}

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeBaseUrl(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/, "")
  return trimmed || null
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = normalizeBaseUrl(value || undefined)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function buildBatchBaseUrls(publicOrigin?: string): string[] {
  return uniqueStrings([
    process.env.GEO_INTERNAL_BASE_URL,
    `http://127.0.0.1:${process.env.PORT || "3000"}`,
    process.env.NEXT_PUBLIC_APP_URL,
    publicOrigin,
  ])
}

async function saveStoredQuestionJob(job: StoredQuestionJobRecord): Promise<void> {
  memoryJobs.set(job.id, job)
  try {
    await kv.set(jobKey(job.id), job, { ex: QUESTION_JOB_TTL_SECONDS })
    if (["succeeded", "failed", "cancelled"].includes(job.status)) {
      await kv.srem(QUESTION_PENDING_SET_KEY, job.id)
    } else {
      await kv.sadd(QUESTION_PENDING_SET_KEY, job.id)
    }
  } catch (error) {
    console.warn("[question-jobs] KV save failed, using memory fallback:", error)
  }
  await syncQuestionJobTask(job)
  if (job.status === "succeeded") {
    const ownerUserId = job.workspaceOwnerUserId || job.ownerUserId
    await saveSystemOutputRecord(ownerUserId, buildQuestionSystemOutputRecord({
      ownerUserId,
      actorUserId: job.ownerUserId,
      clientId: String(job.request.clientId || ""),
      clientName: String(job.request.clientName || job.request.strategy.project_name || job.request.clientId || "当前客户"),
      job: toPublicJob(job),
    })).catch(error => {
      console.warn("[question-jobs] system output save failed", job.id, error instanceof Error ? error.message : error)
    })
  }
}

async function getStoredQuestionJob(id: string): Promise<StoredQuestionJobRecord | null> {
  const memory = memoryJobs.get(id)
  try {
    const fromKv = await kv.get<StoredQuestionJobRecord>(jobKey(id))
    if (fromKv) {
      memoryJobs.set(id, fromKv)
      return fromKv
    }
  } catch (error) {
    console.warn("[question-jobs] KV read failed, using memory fallback:", error)
  }
  return memory || null
}

async function patchQuestionJob(
  id: string,
  patch: Partial<StoredQuestionJobRecord>,
): Promise<StoredQuestionJobRecord | null> {
  const current = await getStoredQuestionJob(id)
  if (!current) return null
  if (current.status === "cancelled" && patch.status !== "cancelled") return current
  if (
    ["succeeded", "failed"].includes(current.status)
    && patch.status
    && patch.status !== current.status
  ) return current
  const next = { ...current, ...patch, updatedAt: nowIso() }
  await saveStoredQuestionJob(next)
  return next
}

async function persistQuestionJobToWorkspace(
  job: StoredQuestionJobRecord,
  phase: QuestionWorkspacePhase,
): Promise<boolean> {
  const userId = String(job.workspaceOwnerUserId || job.ownerUserId || "").trim()
  const clientId = String(job.clientId || "").trim()
  if (!userId || !clientId) return false

  try {
    const saved = await mutateWorkspaceClientLatest({
      userId,
      clientId,
      mutate: current => {
        if (!current.keywordStrategy) return null
        const next = applyQuestionJobToKeywordStrategy(
          current.keywordStrategy,
          toPublicJob(job),
          phase,
        )
        if (!next) return null
        return { patch: { keywordStrategy: next } }
      },
    })
    return Boolean(saved)
  } catch (error) {
    console.error(`[question-jobs] workspace ${phase} persistence failed for ${job.id}:`, error)
    return false
  }
}

class QuestionJobCancelledError extends Error {
  constructor() {
    super(QUESTION_JOB_CANCELLED_MESSAGE)
    this.name = "QuestionJobCancelledError"
  }
}

function isQuestionJobCancelledError(error: unknown): boolean {
  return error instanceof QuestionJobCancelledError
    || (error instanceof Error && error.name === "QuestionJobCancelledError")
}

function registerAbortController(jobId: string, controller: AbortController): () => void {
  const controllers = activeAbortControllers.get(jobId) || new Set<AbortController>()
  controllers.add(controller)
  activeAbortControllers.set(jobId, controllers)
  const unregisterTaskController = registerTaskAbortController(
    "question",
    jobId,
    controller,
  )

  return () => {
    unregisterTaskController()
    controllers.delete(controller)
    if (controllers.size === 0) activeAbortControllers.delete(jobId)
  }
}

async function assertQuestionJobNotCancelled(jobId: string): Promise<void> {
  const current = await getStoredQuestionJob(jobId)
  if (current?.status === "cancelled") {
    throw new QuestionJobCancelledError()
  }
}

function clampQuestionCount(value: unknown, min = 10): number {
  const numeric = typeof value === "number" ? value : Number(value)
  return Math.min(
    QUESTION_GENERATION_LIMIT,
    Math.max(min, Number.isFinite(numeric) ? Math.round(numeric) : 40)
  )
}

export function estimateQuestionJobCredits(input: {
  totalCount?: unknown
  allocationOverrides?: Array<{ count?: unknown }>
}): number {
  const overrideTotal = sumAllocationOverrides(input.allocationOverrides)
  return overrideTotal > 0
    ? clampQuestionCount(overrideTotal, 1)
    : clampQuestionCount(input.totalCount)
}

function questionKey(question: string): string {
  return question.replace(/\s+/g, "").toLowerCase()
}

function deriveCoreKeywords(strategy: GeoStrategyPlan): string[] {
  const keywords = new Set<string>()
  for (const term of strategy.profile?.terms || []) {
    const t = term.trim()
    if (t) keywords.add(t)
  }
  const brand = strategy.profile?.brand_or_product?.trim()
  if (brand) keywords.add(brand)
  for (const kw of strategy.keyword_strategy?.core_keywords || []) {
    const k = kw.keyword?.trim()
    if (k) keywords.add(k)
  }
  return Array.from(keywords)
}

function mergeWarnings(...lists: string[][]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const list of lists) {
    for (const item of list) {
      const warning = item.trim()
      if (!warning || seen.has(warning)) continue
      seen.add(warning)
      result.push(warning)
    }
  }
  return result
}

function calculateQuestionAllocationCounts(
  strategy: GeoStrategyPlan,
  totalCount: number,
  cfg: QuestionCategoryConfig,
): Record<QuestionCategoryKey, number> {
  const weaknesses = strategy.profile?.weaknesses || []
  const rawWeaknessTotal = weaknesses.length * cfg.weaknessesPerWeakness
  let weaknessCount = Math.min(rawWeaknessTotal, totalCount)

  if (weaknesses.length > 0 && rawWeaknessTotal > totalCount) {
    weaknessCount = Math.max(1, Math.floor(totalCount / weaknesses.length)) * weaknesses.length
  }

  const remaining = Math.max(0, totalCount - weaknessCount)
  const coreMinTotal = Math.ceil(totalCount * 0.30)
  let core = 0
  let secondary = 0
  let painScenario = 0

  if (cfg.allocationMode === "custom") {
    core = Math.min(Math.max(cfg.coreCount ?? 0, 0), remaining)
    secondary = Math.min(Math.max(cfg.secondaryCount ?? 0, 0), remaining)
    painScenario = Math.min(Math.max(cfg.painScenarioCount ?? 0, 0), remaining)
    const customTotal = core + secondary + painScenario
    if (customTotal > remaining && customTotal > 0) {
      const ratio = remaining / customTotal
      core = Math.floor(core * ratio)
      secondary = Math.floor(secondary * ratio)
      painScenario = remaining - core - secondary
    }
  } else {
    core = Math.max(Math.floor(remaining * cfg.coreRatio), Math.min(coreMinTotal, remaining))
    secondary = Math.floor(remaining * cfg.secondaryRatio)
    painScenario = remaining - core - secondary
    if (painScenario < 0) {
      secondary = Math.max(0, remaining - core)
      painScenario = Math.max(0, remaining - core - secondary)
    }
  }

  return {
    weakness_spin: Math.max(0, weaknessCount),
    core_keywords: Math.max(0, core),
    secondary_keywords: Math.max(0, secondary),
    pain_scenario: Math.max(0, painScenario),
  }
}

function baseAllocationCounts(): Record<QuestionCategoryKey, number> {
  return {
    weakness_spin: 0,
    core_keywords: 0,
    secondary_keywords: 0,
    pain_scenario: 0,
  }
}

function normalizeAllocationOverrideCounts(
  totalCount: number,
  allocationOverrides?: QuestionAllocationOverride[],
): Record<QuestionCategoryKey, number> | null {
  if (!Array.isArray(allocationOverrides) || allocationOverrides.length === 0) return null
  const counts = baseAllocationCounts()
  const categories = new Set<QuestionCategoryKey>([
    "weakness_spin",
    "core_keywords",
    "secondary_keywords",
    "pain_scenario",
  ])
  let remaining = totalCount

  for (const item of allocationOverrides) {
    if (remaining <= 0 || !categories.has(item.category)) continue
    const count = Math.min(
      Math.max(0, Math.round(Number(item.count) || 0)),
      remaining,
    )
    if (count <= 0) continue
    counts[item.category] += count
    remaining -= count
  }

  return Object.values(counts).some(count => count > 0) ? counts : null
}

function sumAllocationOverrides(allocationOverrides?: Array<{ count?: unknown }>): number {
  if (!Array.isArray(allocationOverrides)) return 0
  return allocationOverrides.reduce((sum, item) => {
    const count = Math.max(0, Math.round(Number(item?.count) || 0))
    return sum + count
  }, 0)
}

function questionBatchPlans(
  request: QuestionJobRequest,
  counts: Record<QuestionCategoryKey, number>,
): QuestionBatchPlan[] {
  return buildQuestionBatchPlan({
    counts,
    keywordCountMode: request.categoryConfig.keywordCountMode,
    customKeywords: request.customKeywords,
    coreKeywords: request.coreKeywords,
    questionsPerKeyword: request.categoryConfig.keywordQuestionsPerKeyword,
  })
}

type FallbackQuestionType = {
  category: string
  userStage: NonNullable<QuestionItem["userStage"]>
  metricPurpose: string
  top10Eligible: boolean
  brandMentionEligible: boolean
}

const FALLBACK_QUESTION_TYPES: FallbackQuestionType[] = [
  {
    category: "榜单推荐型",
    userStage: "探索期",
    metricPurpose: "TOP10推荐率",
    top10Eligible: true,
    brandMentionEligible: true,
  },
  {
    category: "痛点解决型",
    userStage: "认知期",
    metricPurpose: "品牌提及率/解决方案关联度",
    top10Eligible: false,
    brandMentionEligible: true,
  },
  {
    category: "竞品对比型",
    userStage: "比较期",
    metricPurpose: "竞品对比/TOP10推荐率",
    top10Eligible: true,
    brandMentionEligible: true,
  },
  {
    category: "采购决策型",
    userStage: "决策期",
    metricPurpose: "采购决策/TOP10推荐率",
    top10Eligible: true,
    brandMentionEligible: true,
  },
  {
    category: "场景人群型",
    userStage: "探索期",
    metricPurpose: "品牌提及率/场景适配度",
    top10Eligible: false,
    brandMentionEligible: true,
  },
  {
    category: "品牌认知型",
    userStage: "认知期",
    metricPurpose: "品牌认知/品牌提及质量",
    top10Eligible: false,
    brandMentionEligible: true,
  },
  {
    category: "风险疑虑型",
    userStage: "风险确认期",
    metricPurpose: "风险疑虑/信任度/负面倾向",
    top10Eligible: false,
    brandMentionEligible: true,
  },
]

function pickFallbackText(values: string[] | undefined, index: number, fallback: string): string {
  const cleaned = (values || []).map(item => item.trim()).filter(Boolean)
  if (cleaned.length === 0) return fallback
  return cleaned[index % cleaned.length]
}

function shortFallbackText(value: string, fallback: string, maxLength = 14): string {
  const first = value
    .split(/[、,，;；/｜|]+/)
    .map(item => item.trim())
    .find(Boolean) || fallback
  return first.length > maxLength ? first.slice(0, maxLength) : first
}

function looksLikeAdvantageSource(value: string): boolean {
  const text = value.trim()
  if (!text) return false
  return (
    /(?:sku|SKU|spu|SPU|覆盖|全渠道|全球|出口|认证|资质|基地|产线|产品线|服务.*家|门店.*家|客户.*家|案例|专利|ISO|HACCP|SC|BRC|IFS|FDA|有机|绿色食品|冷链|自有|直营|工厂|团队|售后|交付|供应链|源头|厂家|生产线|年产|日产|月产)/i.test(text) ||
    /\d+\s*(?:款|家|个|条|类|种|亩|吨|万吨|年|月|天|小时|%|％|国|省|城|店|人)/.test(text) ||
    /[≥≤]\s*\d+/.test(text)
  )
}

function filterFallbackKeywords(values: string[]): string[] {
  return values
    .map(item => item.trim())
    .filter(item => item && !looksLikeAdvantageSource(item))
}

function safeFallbackKeyword(keyword: string, strategy: GeoStrategyPlan, type: FallbackQuestionType): string {
  const brand = strategy.profile?.brand_or_product?.trim()
  if (
    type.category !== "品牌认知型" &&
    brand &&
    questionKey(keyword) === questionKey(brand)
  ) {
    return strategy.profile?.industry?.trim() || strategy.profile?.product_description?.trim() || "相关服务"
  }
  return keyword
}

function buildFallbackQuestionSeed(
  keyword: string,
  index: number,
  strategy: GeoStrategyPlan,
): Omit<QuestionItem, "id" | "matched_advantage"> {
  const type = FALLBACK_QUESTION_TYPES[index % FALLBACK_QUESTION_TYPES.length]
  const profile = strategy.profile
  const brand = profile?.brand_or_product?.trim()
  const industry = shortFallbackText(profile?.industry?.trim() || "", "这个行业")
  const audience = shortFallbackText(profile?.audience?.trim() || "", "采购负责人")
  const pain = shortFallbackText(pickFallbackText(profile?.pain_points, index, "质量不稳定"), "质量不稳定", 18)
  const scene = shortFallbackText(pickFallbackText(profile?.scenes, index, "采购前"), "采购前", 14)
  const competitor = shortFallbackText(pickFallbackText(profile?.competitors, index, "同类方案"), "同类方案", 14)
  const safeKeyword = shortFallbackText(safeFallbackKeyword(keyword, strategy, type), "相关服务", 18)

  let question = ""
  let intent = ""
  let contentAngle = ""
  switch (type.category) {
    case "榜单推荐型":
      question = `${industry}做${safeKeyword}有哪些靠谱选择？`
      intent = "寻找多个候选方案并建立初步筛选标准"
      contentAngle = "围绕候选服务商类型、筛选维度、案例和交付能力做客观对比"
      break
    case "痛点解决型":
      question = `${audience}遇到${pain}怎么解决？`
      intent = "从具体业务痛点出发寻找解决路径"
      contentAngle = "先解释问题成因，再给出服务路径、执行步骤和验证指标"
      break
    case "竞品对比型":
      question = `${safeKeyword}和${competitor}怎么选？`
      intent = "比较替代方案和服务模式差异"
      contentAngle = "从适用场景、交付方式、成本结构、长期效果和服务能力做横向分析"
      break
    case "采购决策型":
      question = `采购${safeKeyword}前要看哪些标准？`
      intent = "确认购买前的评估标准和合作风险"
      contentAngle = "拆解预算、周期、交付清单、验收指标和合同注意事项"
      break
    case "场景人群型":
      question = `${scene}适合做${safeKeyword}吗？`
      intent = "判断特定人群和场景是否适配该服务"
      contentAngle = "按预算、团队能力、业务阶段和执行条件判断适配度"
      break
    case "品牌认知型":
      question = brand
        ? `${brand}主要是做什么的？`
        : `${industry}里的服务商能力应该从哪些方面判断？`
      intent = "核验品牌实体认知和业务理解是否准确"
      contentAngle = "围绕业务范围、适用客户、核心能力和常见误解做事实说明"
      break
    default:
      question = `做${safeKeyword}容易踩哪些坑？`
      intent = "降低合作前的不确定性和风险"
      contentAngle = "围绕常见风险、避坑清单、验收证据和风险边界提供判断标准"
      break
  }

  return {
    category: type.category,
    difficulty: type.userStage === "认知期" ? "低-中" : "中",
    keyword: safeKeyword,
    question,
    intent,
    content_angle: contentAngle,
    decisionDimension: type.category === "榜单推荐型"
      ? "品牌/方案推荐"
      : type.category === "竞品对比型"
        ? "对比选型"
        : type.category === "采购决策型"
          ? "流程服务"
          : type.category === "场景人群型"
            ? "场景细分"
            : type.category === "风险疑虑型"
              ? "避坑风险"
              : "需求判断",
    geo_optimization: normalizeGeoQuestionOptimization(
      undefined,
      question,
      safeKeyword,
    ),
    generationReason: `本地补齐时按${type.category}生成，模拟${type.userStage}用户围绕${safeKeyword}的真实决策问题`,
    userStage: type.userStage,
    metricPurpose: type.metricPurpose,
    top10Eligible: type.top10Eligible,
    brandMentionEligible: type.brandMentionEligible,
    ...classifyQuestionMethodology({
      category: type.category,
      question,
      intent,
    }),
  }
}

function buildFallbackQuestions(
  count: number,
  startId: number,
  keywords: string[],
  strategy: GeoStrategyPlan,
  usedKeys: Set<string>,
): QuestionItem[] {
  const keywordPool = keywords.length > 0
    ? keywords
    : [
        ...(strategy.profile?.terms || []),
        ...(strategy.keyword_strategy?.core_keywords || []).map(item => item.keyword),
        strategy.profile?.industry || "",
      ].map(item => item.trim()).filter(Boolean)
  const pool = keywordPool.length > 0 ? keywordPool : ["行业解决方案"]
  const questions: QuestionItem[] = []
  const localSeen = new Set(usedKeys)
  let cursor = 0

  while (questions.length < count && cursor < count * Math.max(12, pool.length * 3)) {
    const keyword = pool[cursor % pool.length]
    const seed = buildFallbackQuestionSeed(keyword, cursor, strategy)
    const key = questionKey(seed.question)
    cursor++
    if (!key || localSeen.has(key)) continue
    localSeen.add(key)
    questions.push({
      ...seed,
      id: String(startId + questions.length),
    })
  }

  return attachQuestionAdvantages(questions, extractQuestionAdvantages(strategy)) as QuestionItem[]
}

function isPermanentQuestionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /API Key|HTTP 401|unauthorized|无权限|未配置|权限/i.test(message)
}

async function readBatchResponse(res: Response): Promise<QuestionsResponse> {
  const text = await res.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text) as QuestionsResponse
  } catch {
    const looksLikeHtml = /^\s*</.test(text) || /<!doctype\s+html/i.test(text)
    if (looksLikeHtml) {
      throw new Error(`疑问句批次服务返回异常页面（HTTP ${res.status}）`)
    }
    throw new Error(`疑问句批次返回格式异常（HTTP ${res.status}）`)
  }
}

async function fetchQuestionBatch(
  job: StoredQuestionJobRecord,
  plan: QuestionBatchPlan,
  avoidQuestions: string[],
): Promise<QuestionsResponse> {
  let lastError: unknown

  for (let attempt = 0; attempt < QUESTION_JOB_MAX_BATCH_ATTEMPTS; attempt++) {
    await assertQuestionJobNotCancelled(job.id)

    for (const baseUrl of job.batchBaseUrls) {
      await assertQuestionJobNotCancelled(job.id)

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), QUESTION_JOB_BATCH_TIMEOUT_MS)
      const unregisterAbortController = registerAbortController(job.id, controller)
      try {
        const res = await fetch(`${baseUrl}/api/geo-strategy/questions`, {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            ...createInternalApiHeaders("geo-questions"),
          },
          body: JSON.stringify({
            strategy: job.request.strategy,
            totalCount: plan.totalCount,
            categoryConfig: job.request.categoryConfig,
            questionModelProvider: job.request.questionModelProvider,
            questionModel: job.request.questionModel,
            coreKeywords: job.request.coreKeywords,
            customKeywords: job.request.customKeywords,
            painScenarioKeywords: job.request.painScenarioKeywords || [],
            customPainScenarios: job.request.customPainScenarios || [],
            allocationOverrides: plan.allocationOverrides,
            avoidQuestions: avoidQuestions.slice(-120),
          }),
          signal: controller.signal,
        })

        const data = await readBatchResponse(res)
        if (!res.ok) {
          throw new Error(data.error || `疑问句批次请求失败 (${res.status})`)
        }
        if (!Array.isArray(data.question_strategy) || data.question_strategy.length === 0) {
          throw new Error("疑问句批次没有返回有效问题。")
        }
        await assertQuestionJobNotCancelled(job.id)
        return data
      } catch (error) {
        if (controller.signal.aborted) {
          await assertQuestionJobNotCancelled(job.id)
        }
        lastError = error
        if (isPermanentQuestionError(error)) throw error
      } finally {
        clearTimeout(timeout)
        unregisterAbortController()
      }
    }

    if (attempt < QUESTION_JOB_MAX_BATCH_ATTEMPTS - 1) {
      await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)))
      await assertQuestionJobNotCancelled(job.id)
    }
  }

  throw lastError instanceof Error ? lastError : new Error("疑问句批次生成失败")
}

function appendQuestionItems(
  target: QuestionItem[],
  usedKeys: Set<string>,
  items: QuestionItem[],
  totalCount: number,
): void {
  for (const question of items) {
    const key = questionKey(question.question)
    if (
      !key
      || usedKeys.has(key)
      || target.some(existing =>
        areNearDuplicateQuestions(existing.question, question.question)
      )
    ) continue
    usedKeys.add(key)
    target.push(question)
    if (target.length >= totalCount) break
  }
}

function reindexQuestions(questions: QuestionItem[], totalCount: number, strategy?: GeoStrategyPlan): QuestionItem[] {
  const advantages = extractQuestionAdvantages(strategy)
  const enriched = advantages.length > 0
    ? attachQuestionAdvantages(questions, advantages)
    : questions
  return enriched.slice(0, totalCount).map((question, index) => ({
    ...question,
    id: String(index + 1),
  }))
}

function hasUsableKeywordResearch(
  value: GeoStrategyPlan["keyword_research"],
): value is KeywordStrategyResearchAudit {
  const searchedAt = value?.searched_at ? Date.parse(value.searched_at) : Number.NaN
  const fresh = Number.isFinite(searchedAt)
    && Date.now() - searchedAt <= 24 * 60 * 60 * 1000
  return Boolean(
    fresh
    && value?.search_executed
    && value.provider_request_id
    && Array.isArray(value.sources)
    && value.sources.length > 0,
  )
}

async function ensureQuestionJobResearch(
  job: StoredQuestionJobRecord,
): Promise<StoredQuestionJobRecord> {
  const fallbackRegion = job.request.strategy.profile?.person_profile?.region
    || job.request.strategy.profile?.terms?.join("、")
    || "不限地域"
  const baseSettings = job.request.strategy.generation_settings
    || normalizeKeywordStrategySettings(undefined, fallbackRegion)
  const requestedKeywords = (job.request.customKeywords || []).length > 0
    ? job.request.customKeywords
    : baseSettings.custom_keywords
  const settings = {
    ...baseSettings,
    custom_keywords: requestedKeywords,
  }
  const researchCoversRequestedKeywords = requestedKeywords.every(keyword =>
    baseSettings.custom_keywords.some(existing =>
      questionKey(existing) === questionKey(keyword)
    )
  )

  if (
    hasUsableKeywordResearch(job.request.strategy.keyword_research)
    && researchCoversRequestedKeywords
  ) {
    if (job.researchAudit) return job
    return await patchQuestionJob(job.id, {
      researchAudit: job.request.strategy.keyword_research,
    }) || job
  }

  const controller = new AbortController()
  const unregisterAbortController = registerAbortController(job.id, controller)
  try {
    const researchAudit = await researchKeywordStrategyContext({
      profile: job.request.strategy.profile as unknown as Record<string, unknown>,
      settings,
      signal: controller.signal,
    })
    const strategy = {
      ...job.request.strategy,
      generation_settings: settings,
      keyword_research: researchAudit,
    }
    return await patchQuestionJob(job.id, {
      request: {
        ...job.request,
        strategy,
      },
      researchAudit,
      warnings: mergeWarnings(job.warnings, [
        `已完成豆包官方联网研究，核验 ${researchAudit.sources.length} 个有效网页来源。`,
      ]),
    }) || {
      ...job,
      request: { ...job.request, strategy },
      researchAudit,
    }
  } finally {
    unregisterAbortController()
  }
}

async function settleQuestionJobCredits(id: string, used: number): Promise<void> {
  const job = await getStoredQuestionJob(id)
  if (!job || job.creditsSettledAt) return

  const reservation: CreditReservation = {
    userId: job.billingUserId || job.ownerUserId,
    amount: Math.max(1, Math.floor(job.reservedCredits || job.totalCount || 1)),
    balanceAfterReserve: 0,
    ledgerContext: {
      featureKey: "keywordQuestionUnit",
      source: "question-job",
      sourceId: id,
      description: getFeaturePrice("keywordQuestionUnit").label,
      metadata: {
        requestedCount: job.totalCount,
      },
    },
  }

  await settleReservedCredits(reservation, estimateFeatureCredits("keywordQuestionUnit", used))
  await patchQuestionJob(id, { creditsSettledAt: nowIso() })
}

async function settleQuestionJobCreditsQuietly(id: string, used: number): Promise<void> {
  try {
    await settleQuestionJobCredits(id, used)
  } catch (error) {
    console.error("[question-jobs] credit settlement failed", id, used, error)
  }
}

async function runQuestionJob(jobId: string): Promise<void> {
  if (activeJobs.has(jobId)) return
  activeJobs.add(jobId)

  try {
    let job = await getStoredQuestionJob(jobId)
    if (!job) return

    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") return

    job = await patchQuestionJob(job.id, {
      status: "running",
      error: undefined,
    }) || job
    await assertQuestionJobNotCancelled(job.id)
    job = await ensureQuestionJobResearch(job)
    await assertQuestionJobNotCancelled(job.id)

    const allocationCounts = normalizeAllocationOverrideCounts(
      job.totalCount,
      job.request.allocationOverrides,
    ) || calculateQuestionAllocationCounts(
      job.request.strategy,
      job.totalCount,
      job.request.categoryConfig,
    )
    const batchPlans = questionBatchPlans(job.request, allocationCounts)
    const coreKeywords = job.request.customKeywords.length > 0
      ? job.request.customKeywords
      : job.request.coreKeywords.length > 0
        ? job.request.coreKeywords
        : deriveCoreKeywords(job.request.strategy)
    const fallbackKeywords = Array.from(new Set(filterFallbackKeywords([
      ...coreKeywords,
      ...(job.request.customPainScenarios || []),
      ...(job.request.painScenarioKeywords || []),
    ])))
    const mergedQuestions = [...job.questions]
    const seen = new Set(mergedQuestions.map(item => questionKey(item.question)).filter(Boolean))
    let warnings = mergeWarnings(
      job.warnings,
      batchPlans.length > 1
        ? [
            `已转为后台长任务，自动拆分为 ${batchPlans.length} 批生成。`,
            `系统会使用最多 ${QUESTION_JOB_BATCH_CONCURRENCY} 条独立账号通道并行处理。`,
          ]
        : []
    )

    let batchIndex = Math.max(0, job.completedBatches)
    while (batchIndex < batchPlans.length && mergedQuestions.length < job.totalCount) {
      await assertQuestionJobNotCancelled(job.id)
      const wave = batchPlans
        .slice(batchIndex, batchIndex + QUESTION_JOB_BATCH_CONCURRENCY)
        .map((plan, waveIndex) => ({
          plan,
          index: batchIndex + waveIndex,
        }))
      job = await patchQuestionJob(job.id, {
        currentBatch: batchIndex + 1,
        totalBatches: batchPlans.length,
        completedCount: mergedQuestions.length,
        questions: reindexQuestions(mergedQuestions, job.totalCount, job.request.strategy),
        warnings,
      }) || job
      await assertQuestionJobNotCancelled(job.id)

      const avoidSnapshot = mergedQuestions.map(item => item.question)
      const waveJob = job
      const waveResults = await Promise.all(wave.map(async item => {
        try {
          return {
            ...item,
            data: await fetchQuestionBatch(waveJob, item.plan, avoidSnapshot),
            error: undefined,
          }
        } catch (error) {
          if (isQuestionJobCancelledError(error)) throw error
          if (isPermanentQuestionError(error)) throw error
          return { ...item, data: undefined, error }
        }
      }))
      await assertQuestionJobNotCancelled(job.id)

      for (const result of waveResults) {
        if (result.data) {
          appendQuestionItems(
            mergedQuestions,
            seen,
            (result.data.question_strategy || []).map((question, questionIndex) => ({
              ...question,
              id: String(mergedQuestions.length + questionIndex + 1),
            })),
            job.totalCount,
          )
          if (Array.isArray(result.data.warnings)) {
            warnings = mergeWarnings(warnings, result.data.warnings)
          }
          continue
        }

        const scopedKeywords = result.plan.allocationOverrides
          .flatMap(item => item.keywords || [])
        warnings = mergeWarnings(warnings, [
          `第 ${result.index + 1} 批模型生成失败，已用本次联网语境和关键词规则补齐该批次。`,
        ])
        appendQuestionItems(
          mergedQuestions,
          seen,
          buildFallbackQuestions(
            result.plan.totalCount,
            mergedQuestions.length + 1,
            scopedKeywords.length > 0 ? scopedKeywords : fallbackKeywords,
            job.request.strategy,
            seen,
          ),
          job.totalCount,
        )
      }

      batchIndex += wave.length
      job = await patchQuestionJob(job.id, {
        completedBatches: batchIndex,
        currentBatch: batchIndex,
        completedCount: Math.min(mergedQuestions.length, job.totalCount),
        questions: reindexQuestions(mergedQuestions, job.totalCount, job.request.strategy),
        warnings,
      }) || job
      await assertQuestionJobNotCancelled(job.id)
    }

    for (let topUp = 0; topUp < 3 && mergedQuestions.length < job.totalCount; topUp++) {
      await assertQuestionJobNotCancelled(job.id)
      const need = Math.min(QUESTION_BATCH_SIZE, job.totalCount - mergedQuestions.length)
      const before = mergedQuestions.length
      try {
        const data = await fetchQuestionBatch(
          job,
          {
            totalCount: need,
            allocationOverrides: [{ category: "core_keywords", count: need }],
          },
          mergedQuestions.map(item => item.question),
        )
        await assertQuestionJobNotCancelled(job.id)
        appendQuestionItems(
          mergedQuestions,
          seen,
          (data.question_strategy || []).map((question, i) => ({
            ...question,
            id: String(mergedQuestions.length + i + 1),
          })),
          job.totalCount,
        )
        if (Array.isArray(data.warnings)) warnings = mergeWarnings(warnings, data.warnings)
      } catch (error) {
        if (isQuestionJobCancelledError(error)) throw error
        if (isPermanentQuestionError(error)) throw error
        warnings = mergeWarnings(warnings, [`补齐批次 ${topUp + 1} 模型生成失败，已继续尝试本地补齐。`])
        break
      }
      if (mergedQuestions.length <= before) break
      job = await patchQuestionJob(job.id, {
        completedCount: Math.min(mergedQuestions.length, job.totalCount),
        questions: reindexQuestions(mergedQuestions, job.totalCount, job.request.strategy),
        warnings,
      }) || job
      await assertQuestionJobNotCancelled(job.id)
    }

    await assertQuestionJobNotCancelled(job.id)
    if (mergedQuestions.length < job.totalCount) {
      const missing = job.totalCount - mergedQuestions.length
      appendQuestionItems(
        mergedQuestions,
        seen,
        buildFallbackQuestions(
          missing,
          mergedQuestions.length + 1,
          fallbackKeywords,
          job.request.strategy,
          seen,
        ),
        job.totalCount,
      )
      warnings = mergeWarnings(warnings, [`模型去重后不足 ${job.totalCount} 条，已用本地规则补齐 ${missing} 条。`])
    }

    await assertQuestionJobNotCancelled(job.id)
    const reindexed = reindexQuestions(mergedQuestions, job.totalCount, job.request.strategy)
    if (reindexed.length === 0) {
      throw new Error("疑问句生成没有返回有效问题，系统未保存空结果，请重新生成。")
    }
    const categoryCoverage = new Set(
      reindexed.map(item => item.category).filter(Boolean),
    ).size
    const dimensionCoverage = new Set(
      reindexed.map(item => item.decisionDimension).filter(Boolean),
    ).size
    const missingOptimizationCount = reindexed.filter(item =>
      !item.content_angle?.trim()
      || !item.geo_optimization
      || item.geo_optimization.long_tail_terms.length === 0
    ).length
    warnings = mergeWarnings(warnings, [
      `质量检查：七类主意图覆盖 ${categoryCoverage}/7，十个决策维度覆盖 ${dimensionCoverage}/10，内容方向与 GEO 要点完整 ${reindexed.length - missingOptimizationCount}/${reindexed.length} 条。`,
    ])
    if (missingOptimizationCount > 0) {
      warnings = mergeWarnings(warnings, [
        `${missingOptimizationCount} 条问题的内容方向或 GEO 要点不完整，建议在导出前重新生成对应批次。`,
      ])
    }

    const finishedAt = nowIso()
    const succeededJob: StoredQuestionJobRecord = {
      ...job,
      status: "succeeded",
      completedBatches: batchPlans.length,
      currentBatch: batchPlans.length,
      totalBatches: batchPlans.length,
      completedCount: reindexed.length,
      questions: reindexed,
      warnings,
      finishedAt,
      updatedAt: finishedAt,
    }
    await persistQuestionJobToWorkspace(succeededJob, "succeeded")
    await settleQuestionJobCreditsQuietly(job.id, reindexed.length)
    await patchQuestionJob(job.id, {
      status: succeededJob.status,
      completedBatches: succeededJob.completedBatches,
      currentBatch: succeededJob.currentBatch,
      totalBatches: succeededJob.totalBatches,
      completedCount: succeededJob.completedCount,
      questions: succeededJob.questions,
      warnings: succeededJob.warnings,
      finishedAt,
    })
  } catch (error) {
    if (isQuestionJobCancelledError(error)) {
      await settleQuestionJobCreditsQuietly(jobId, 0)
      const cancelled = await patchQuestionJob(jobId, {
        status: "cancelled",
        error: QUESTION_JOB_CANCELLED_MESSAGE,
        finishedAt: nowIso(),
      })
      if (cancelled) await persistQuestionJobToWorkspace(cancelled, "cancelled")
      return
    }
    console.error("[question-jobs] job failed:", error)
    const message = error instanceof Error ? error.message : "疑问句后台任务失败"
    await settleQuestionJobCreditsQuietly(jobId, 0)
    const failed = await patchQuestionJob(jobId, {
      status: "failed",
      error: message,
      finishedAt: nowIso(),
    })
    if (failed) await persistQuestionJobToWorkspace(failed, "failed")
  } finally {
    activeJobs.delete(jobId)
    activeAbortControllers.delete(jobId)
  }
}

function scheduleLocalQuestionJob(id: string): void {
  void runQuestionJob(id)
}

async function dispatchQuestionJob(id: string): Promise<void> {
  await dispatchDurableTaskOrFallback(
    "question",
    id,
    () => scheduleLocalQuestionJob(id),
  )
}

export async function createQuestionJob(
  input: QuestionJobRequest,
  publicOrigin?: string,
  ownerUserId?: string,
  reservedCredits?: number,
  id?: string,
  billingUserId?: string,
  workspaceOwnerUserId?: string,
  teamId?: string,
): Promise<QuestionJobRecord> {
  if (!input.strategy) {
    throw new Error("请提供策略方案")
  }
  if (!ownerUserId) {
    throw new Error("Unauthorized")
  }

  const totalCount = estimateQuestionJobCredits(input)
  const allocationCounts = normalizeAllocationOverrideCounts(
    totalCount,
    input.allocationOverrides,
  ) || calculateQuestionAllocationCounts(
    input.strategy,
    totalCount,
    input.categoryConfig,
  )
  const batchPlans = questionBatchPlans(input, allocationCounts)
  const questionModelProvider = normalizeQuestionModelProvider(
    input.questionModelProvider || DEFAULT_QUESTION_MODEL_PROVIDER,
  )
  const now = nowIso()
  const stored: StoredQuestionJobRecord = {
    id: id || `qjob_${randomUUID().replace(/-/g, "")}`,
    clientId: String(input.clientId || "").trim() || undefined,
    status: "queued",
    totalCount,
    completedCount: 0,
    currentBatch: 0,
    totalBatches: batchPlans.length,
    completedBatches: 0,
    questions: [],
    warnings: batchPlans.length > 1
      ? [`已创建后台长任务，共 ${batchPlans.length} 批。可以继续使用其他功能，完成后会统一提醒。`]
      : [],
    createdAt: now,
    updatedAt: now,
    researchAudit: hasUsableKeywordResearch(input.strategy.keyword_research)
      ? input.strategy.keyword_research
      : undefined,
    request: {
      ...input,
      totalCount,
      questionModelProvider,
      questionModel: normalizeQuestionModel(questionModelProvider, input.questionModel),
      coreKeywords: input.coreKeywords || [],
      customKeywords: input.customKeywords || [],
      painScenarioKeywords: input.painScenarioKeywords || [],
      customPainScenarios: input.customPainScenarios || [],
      allocationOverrides: input.allocationOverrides || [],
    },
    batchBaseUrls: buildBatchBaseUrls(publicOrigin),
    ownerUserId,
    billingUserId: billingUserId || ownerUserId,
    workspaceOwnerUserId: workspaceOwnerUserId || ownerUserId,
    teamId,
    reservedCredits: Math.max(1, Math.floor(Number(reservedCredits) || totalCount)),
  }

  await saveStoredQuestionJob(stored)
  await dispatchQuestionJob(stored.id)
  return toPublicJob(stored)
}

export async function getQuestionJob(id: string, ownerUserId: string): Promise<QuestionJobRecord | null> {
  const job = await getStoredQuestionJob(id)
  if (!job) return null
  if (job.ownerUserId !== ownerUserId) return null

  if (job.status === "succeeded") await persistQuestionJobToWorkspace(job, "succeeded")
  else if (job.status === "failed") await persistQuestionJobToWorkspace(job, "failed")
  else if (job.status === "cancelled") await persistQuestionJobToWorkspace(job, "cancelled")

  if ((job.status === "queued" || job.status === "running") && !activeJobs.has(job.id)) {
    void dispatchQuestionJob(job.id)
  }

  return toPublicJob(job)
}

export async function resumePendingQuestionJobs(): Promise<void> {
  let ids: string[] = []
  try {
    ids = await kv.smembers<string[]>(QUESTION_PENDING_SET_KEY)
  } catch (error) {
    console.warn("[question-jobs] pending queue recovery failed", error)
    return
  }

  for (const id of ids) {
    const job = await getStoredQuestionJob(id)
    if (!job || ["succeeded", "failed", "cancelled"].includes(job.status)) {
      await kv.srem(QUESTION_PENDING_SET_KEY, id)
      continue
    }
    await dispatchQuestionJob(id)
  }
}

export async function runQuestionJobFromWorker(
  id: string,
): Promise<TaskWorkerOutcome> {
  const job = await getStoredQuestionJob(id)
  if (!job || ["succeeded", "failed", "cancelled"].includes(job.status)) {
    if (job) await kv.srem(QUESTION_PENDING_SET_KEY, job.id)
    return {}
  }
  if (activeJobs.has(id)) return { requeue: true, delayMs: 1_000 }

  await runQuestionJob(id)
  const latest = await getStoredQuestionJob(id)
  if (!latest || ["succeeded", "failed", "cancelled"].includes(latest.status)) {
    return {}
  }
  return { requeue: true, delayMs: 2_000 }
}

export async function cancelQuestionJob(id: string, ownerUserId: string): Promise<QuestionJobRecord | null> {
  const job = await getStoredQuestionJob(id)
  if (!job) return null
  if (job.ownerUserId !== ownerUserId) return null

  if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
    return toPublicJob(job)
  }

  const cancelled = await patchQuestionJob(id, {
    status: "cancelled",
    error: QUESTION_JOB_CANCELLED_MESSAGE,
    finishedAt: nowIso(),
  }) || job
  if (cancelled.status !== "cancelled") {
    await clearTaskCancellation("question", id)
    return toPublicJob(cancelled)
  }
  await signalTaskCancellation("question", id, ownerUserId)
  await settleQuestionJobCreditsQuietly(id, 0)
  await persistQuestionJobToWorkspace(cancelled, "cancelled")

  const controllers = activeAbortControllers.get(id)
  if (controllers) {
    for (const controller of controllers) {
      controller.abort()
    }
    activeAbortControllers.delete(id)
  }

  return toPublicJob(cancelled)
}
