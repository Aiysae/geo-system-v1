import "server-only"

import { randomUUID } from "crypto"
import { kv } from "@vercel/kv"
import type {
  GeoStrategyPlan,
  QuestionCategoryConfig,
  QuestionItem,
  QuestionJobRecord,
} from "@/types/geo-strategy"

type QuestionCategoryKey = "weakness_spin" | "core_keywords" | "secondary_keywords" | "pain_scenario"

interface QuestionAllocationOverride {
  category: QuestionCategoryKey
  count: number
}

interface QuestionBatchPlan {
  totalCount: number
  allocationOverrides: QuestionAllocationOverride[]
}

interface QuestionJobRequest {
  strategy: GeoStrategyPlan
  totalCount: number
  layer2Ratio: number
  categoryConfig: QuestionCategoryConfig
  coreKeywords: string[]
  customKeywords: string[]
}

type StoredQuestionJobRecord = QuestionJobRecord & {
  request: QuestionJobRequest
  batchBaseUrls: string[]
}

type QuestionsResponse = {
  question_strategy?: QuestionItem[]
  warnings?: string[]
  error?: string
}

const QUESTION_GENERATION_LIMIT = 600
const QUESTION_JOB_SINGLE_REQUEST_LIMIT = 30
const QUESTION_JOB_MAX_BATCH_ATTEMPTS = 3
const QUESTION_JOB_BATCH_TIMEOUT_MS = 10 * 60 * 1000
const QUESTION_JOB_TTL_SECONDS = 60 * 60 * 24

const memoryJobs = new Map<string, StoredQuestionJobRecord>()
const activeJobs = new Set<string>()

const jobKey = (id: string) => `geo:question-jobs:${id}`

function toPublicJob(job: StoredQuestionJobRecord): QuestionJobRecord {
  const publicJob: Partial<StoredQuestionJobRecord> = { ...job }
  delete publicJob.request
  delete publicJob.batchBaseUrls
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
  } catch (error) {
    console.warn("[question-jobs] KV save failed, using memory fallback:", error)
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
  const next = { ...current, ...patch, updatedAt: nowIso() }
  await saveStoredQuestionJob(next)
  return next
}

function clampQuestionCount(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value)
  return Math.min(
    QUESTION_GENERATION_LIMIT,
    Math.max(10, Number.isFinite(numeric) ? Math.round(numeric) : 40)
  )
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
  for (const adv of strategy.profile?.advantages || []) {
    const a = adv.trim()
    if (a) keywords.add(a)
  }
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

function buildQuestionBatchPlans(
  counts: Record<QuestionCategoryKey, number>,
): QuestionBatchPlan[] {
  const plans: QuestionBatchPlan[] = []
  const remaining = { ...counts }
  const order: QuestionCategoryKey[] = [
    "weakness_spin",
    "core_keywords",
    "secondary_keywords",
    "pain_scenario",
  ]

  let current: QuestionAllocationOverride[] = []
  let currentTotal = 0

  function flush() {
    if (currentTotal <= 0) return
    plans.push({ totalCount: currentTotal, allocationOverrides: current })
    current = []
    currentTotal = 0
  }

  for (const category of order) {
    while (remaining[category] > 0) {
      const capacity = QUESTION_JOB_SINGLE_REQUEST_LIMIT - currentTotal
      if (capacity <= 0) {
        flush()
        continue
      }
      const take = Math.min(capacity, remaining[category])
      current.push({ category, count: take })
      currentTotal += take
      remaining[category] -= take
      if (currentTotal >= QUESTION_JOB_SINGLE_REQUEST_LIMIT) flush()
    }
  }
  flush()

  return plans
}

function buildQuestionTextSeed(keyword: string, index: number): string {
  const scenarios = [
    "初次了解时",
    "准备采购前",
    "预算有限时",
    "团队规模较小时",
    "业务增长较快时",
    "替换旧方案时",
    "对比多个方案时",
    "需要长期使用时",
    "担心踩坑时",
    "老板要求评估时",
    "跨部门协同时",
    "本地服务落地时",
    "需要快速见效时",
    "重视售后服务时",
    "关注数据安全时",
  ]
  const dimensions = [
    "成本",
    "效果",
    "稳定性",
    "服务能力",
    "交付周期",
    "案例真实性",
    "使用门槛",
    "长期价值",
    "扩展能力",
    "风险点",
  ]
  const scenario = scenarios[Math.floor(index / 8) % scenarios.length]
  const dimension = dimensions[Math.floor(index / (8 * scenarios.length)) % dimensions.length]
  const templates = [
    `${scenario}，${keyword}适合哪些使用场景？`,
    `${scenario}，${keyword}怎么判断是否值得选择？`,
    `${scenario}，选择${keyword}前要重点看哪些${dimension}指标？`,
    `${scenario}，${keyword}和其他方案相比主要差别是什么？`,
    `${scenario}，${keyword}常见${dimension}避坑点有哪些？`,
    `${scenario}，${keyword}适合什么类型的团队或人群？`,
    `${scenario}，${keyword}落地时最容易遇到哪些${dimension}问题？`,
    `${scenario}，如何评估${keyword}的长期${dimension}价值？`,
  ]
  return templates[index % templates.length]
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
    const question = buildQuestionTextSeed(keyword, cursor)
    const key = questionKey(question)
    cursor++
    if (!key || localSeen.has(key)) continue
    localSeen.add(key)
    questions.push({
      id: String(startId + questions.length),
      layer: cursor % 3 === 0 ? "第二层" : "第一层",
      category: "本地补齐问题",
      difficulty: "中",
      keyword,
      question,
      intent: "补充覆盖目标关键词下的用户真实决策问题",
      content_angle: "围绕用户选择标准、场景适配和避坑判断提供事实型内容",
    })
  }

  return questions
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
    for (const baseUrl of job.batchBaseUrls) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), QUESTION_JOB_BATCH_TIMEOUT_MS)
      try {
        const res = await fetch(`${baseUrl}/api/geo-strategy/questions`, {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategy: job.request.strategy,
            totalCount: plan.totalCount,
            layer2Ratio: job.request.layer2Ratio,
            categoryConfig: job.request.categoryConfig,
            coreKeywords: job.request.coreKeywords,
            customKeywords: job.request.customKeywords,
            allocationOverrides: plan.allocationOverrides,
            avoidQuestions: avoidQuestions.slice(-120),
          }),
          signal: controller.signal,
        })
        clearTimeout(timeout)

        const data = await readBatchResponse(res)
        if (!res.ok) {
          throw new Error(data.error || `疑问句批次请求失败 (${res.status})`)
        }
        if (!Array.isArray(data.question_strategy) || data.question_strategy.length === 0) {
          throw new Error("疑问句批次没有返回有效问题。")
        }
        return data
      } catch (error) {
        clearTimeout(timeout)
        lastError = error
        if (isPermanentQuestionError(error)) throw error
      }
    }

    if (attempt < QUESTION_JOB_MAX_BATCH_ATTEMPTS - 1) {
      await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)))
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
    if (!key || usedKeys.has(key)) continue
    usedKeys.add(key)
    target.push(question)
    if (target.length >= totalCount) break
  }
}

function reindexQuestions(questions: QuestionItem[], totalCount: number): QuestionItem[] {
  return questions.slice(0, totalCount).map((question, index) => ({
    ...question,
    id: String(index + 1),
  }))
}

async function runQuestionJob(jobId: string): Promise<void> {
  if (activeJobs.has(jobId)) return
  activeJobs.add(jobId)

  try {
    let job = await getStoredQuestionJob(jobId)
    if (!job) return

    if (job.status === "succeeded" || job.status === "failed") return

    job = await patchQuestionJob(job.id, {
      status: "running",
      error: undefined,
    }) || job

    const allocationCounts = calculateQuestionAllocationCounts(
      job.request.strategy,
      job.totalCount,
      job.request.categoryConfig,
    )
    const batchPlans = buildQuestionBatchPlans(allocationCounts)
    const coreKeywords = job.request.customKeywords.length > 0
      ? job.request.customKeywords
      : job.request.coreKeywords.length > 0
        ? job.request.coreKeywords
        : deriveCoreKeywords(job.request.strategy)
    const mergedQuestions = [...job.questions]
    const seen = new Set(mergedQuestions.map(item => questionKey(item.question)).filter(Boolean))
    let warnings = mergeWarnings(
      job.warnings,
      batchPlans.length > 1
        ? [`已转为后台长任务，自动拆分为 ${batchPlans.length} 批生成。`]
        : []
    )

    for (
      let index = Math.max(0, job.completedBatches);
      index < batchPlans.length && mergedQuestions.length < job.totalCount;
      index++
    ) {
      const plan = batchPlans[index]
      job = await patchQuestionJob(job.id, {
        currentBatch: index + 1,
        totalBatches: batchPlans.length,
        completedCount: mergedQuestions.length,
        questions: reindexQuestions(mergedQuestions, job.totalCount),
        warnings,
      }) || job

      try {
        const data = await fetchQuestionBatch(
          job,
          plan,
          mergedQuestions.map(item => item.question),
        )
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
        if (isPermanentQuestionError(error)) throw error
        warnings = mergeWarnings(warnings, [`第 ${index + 1} 批模型生成失败，已用本地模板补齐该批次。`])
        appendQuestionItems(
          mergedQuestions,
          seen,
          buildFallbackQuestions(
            plan.totalCount,
            mergedQuestions.length + 1,
            coreKeywords,
            job.request.strategy,
            seen,
          ),
          job.totalCount,
        )
      }

      job = await patchQuestionJob(job.id, {
        completedBatches: index + 1,
        completedCount: Math.min(mergedQuestions.length, job.totalCount),
        questions: reindexQuestions(mergedQuestions, job.totalCount),
        warnings,
      }) || job
    }

    for (let topUp = 0; topUp < 3 && mergedQuestions.length < job.totalCount; topUp++) {
      const need = Math.min(QUESTION_JOB_SINGLE_REQUEST_LIMIT, job.totalCount - mergedQuestions.length)
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
        if (isPermanentQuestionError(error)) throw error
        warnings = mergeWarnings(warnings, [`补齐批次 ${topUp + 1} 模型生成失败，已继续尝试本地补齐。`])
        break
      }
      if (mergedQuestions.length <= before) break
      job = await patchQuestionJob(job.id, {
        completedCount: Math.min(mergedQuestions.length, job.totalCount),
        questions: reindexQuestions(mergedQuestions, job.totalCount),
        warnings,
      }) || job
    }

    if (mergedQuestions.length < job.totalCount) {
      const missing = job.totalCount - mergedQuestions.length
      appendQuestionItems(
        mergedQuestions,
        seen,
        buildFallbackQuestions(
          missing,
          mergedQuestions.length + 1,
          coreKeywords,
          job.request.strategy,
          seen,
        ),
        job.totalCount,
      )
      warnings = mergeWarnings(warnings, [`模型去重后不足 ${job.totalCount} 条，已用本地模板补齐 ${missing} 条。`])
    }

    const reindexed = reindexQuestions(mergedQuestions, job.totalCount)
    if (reindexed.length === 0) {
      throw new Error("疑问句生成没有返回有效问题，系统未保存空结果，请重新生成。")
    }

    await patchQuestionJob(job.id, {
      status: "succeeded",
      completedBatches: batchPlans.length,
      currentBatch: batchPlans.length,
      totalBatches: batchPlans.length,
      completedCount: reindexed.length,
      questions: reindexed,
      warnings,
      finishedAt: nowIso(),
    })
  } catch (error) {
    console.error("[question-jobs] job failed:", error)
    const message = error instanceof Error ? error.message : "疑问句后台任务失败"
    await patchQuestionJob(jobId, {
      status: "failed",
      error: message,
      finishedAt: nowIso(),
    })
  } finally {
    activeJobs.delete(jobId)
  }
}

export async function createQuestionJob(
  input: QuestionJobRequest,
  publicOrigin?: string,
): Promise<QuestionJobRecord> {
  if (!input.strategy) {
    throw new Error("请提供策略方案")
  }

  const totalCount = clampQuestionCount(input.totalCount)
  const allocationCounts = calculateQuestionAllocationCounts(
    input.strategy,
    totalCount,
    input.categoryConfig,
  )
  const batchPlans = buildQuestionBatchPlans(allocationCounts)
  const now = nowIso()
  const stored: StoredQuestionJobRecord = {
    id: `qjob_${randomUUID().replace(/-/g, "")}`,
    status: "queued",
    totalCount,
    completedCount: 0,
    currentBatch: 0,
    totalBatches: batchPlans.length,
    completedBatches: 0,
    questions: [],
    warnings: batchPlans.length > 1
      ? [`已创建后台长任务，共 ${batchPlans.length} 批。生成过程中可以保持页面打开查看进度。`]
      : [],
    createdAt: now,
    updatedAt: now,
    request: {
      ...input,
      totalCount,
      coreKeywords: input.coreKeywords || [],
      customKeywords: input.customKeywords || [],
    },
    batchBaseUrls: buildBatchBaseUrls(publicOrigin),
  }

  await saveStoredQuestionJob(stored)
  void runQuestionJob(stored.id)
  return toPublicJob(stored)
}

export async function getQuestionJob(id: string): Promise<QuestionJobRecord | null> {
  const job = await getStoredQuestionJob(id)
  if (!job) return null

  if ((job.status === "queued" || job.status === "running") && !activeJobs.has(job.id)) {
    void runQuestionJob(job.id)
  }

  return toPublicJob(job)
}
