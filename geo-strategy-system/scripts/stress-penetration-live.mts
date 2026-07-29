import type { ModelKey, PenetrationByModel, PenetrationItem } from "../src/types"

const { createInternalApiHeaders } = await import("../src/lib/internal-api")
const { getPenetrationSlotValidationError } = await import(
  "../src/lib/penetration/slot-policy"
)

function boundedInteger(name: string, fallback: number, max: number): number {
  const value = Math.floor(Number(process.env[name]) || fallback)
  return Math.max(1, Math.min(max, value))
}

function boundedRatio(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
}

function safeError(value: unknown): string {
  return String(value || "unknown error")
    .replace(/bce-v3\/[A-Za-z0-9_\-/]+/g, "bce-v3/***")
    .replace(/Bearer\s+[A-Za-z0-9._\-/]{16,}/gi, "Bearer ***")
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, "sk-***")
    .replace(/\s+/g, " ")
    .slice(0, 240)
}

const baseUrl = (process.env.PENETRATION_STRESS_BASE_URL || "http://127.0.0.1:3101")
  .replace(/\/$/, "")
const models = (process.env.PENETRATION_STRESS_MODELS || "doubao")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean) as ModelKey[]
const allQuestions = [
  "今天是几月几日？请依据当前公开网页信息直接回答。",
  "目前国内主流新能源汽车品牌有哪些？",
  "杭州近期有哪些值得关注的人工智能产业动态？",
  "中国高端白酒市场常被消费者提到的品牌有哪些？",
  "企业做 GEO 优化时通常会选择哪些服务商或工具？",
  "目前常见的全屋定制品牌有哪些，各自有什么特点？",
  "采购工业防松紧固件时常见的品牌和选择要点是什么？",
  "国内面向企业的云计算平台主要有哪些？",
  "现在常见的 AI 写作工具有哪些？",
  "餐饮供应链采购竹笋产品时可以关注哪些品牌或厂家？",
  "国内主流大模型产品有哪些，近期各有什么特点？",
]
const requestedQuestionIndex = Number(process.env.PENETRATION_STRESS_QUESTION_INDEX || 0)
const questions = requestedQuestionIndex > 0
  ? allQuestions.slice(requestedQuestionIndex - 1, requestedQuestionIndex)
  : allQuestions
const concurrency = boundedInteger("PENETRATION_STRESS_CONCURRENCY", 3, 12)
const requestCount = boundedInteger(
  "PENETRATION_STRESS_REQUESTS",
  Math.max(concurrency * 2, questions.length),
  240,
)
const maxAttempts = boundedInteger("PENETRATION_STRESS_ATTEMPTS", 1, 3)
const minSuccessRate = boundedRatio("PENETRATION_STRESS_MIN_SUCCESS_RATE", 0.95)
const maxP95Ms = Math.max(0, Number(process.env.PENETRATION_STRESS_MAX_P95_MS) || 120_000)

if (models.length === 0) throw new Error("PENETRATION_STRESS_MODELS 至少需要一个模型")
if (questions.length === 0) throw new Error("PENETRATION_STRESS_QUESTION_INDEX 超出题库范围")

interface StressResult {
  index: number
  model: ModelKey
  success: boolean
  attempts: number
  durationMs: number
  sources: number
  error?: string
}

async function runCase(index: number): Promise<StressResult> {
  const model = models[index % models.length]
  const question = questions[index % questions.length]
  const startedAt = Date.now()
  let lastError = ""

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/penetration`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...createInternalApiHeaders("penetration-job"),
        },
        body: JSON.stringify({
          runId: `penetration_stress_${Date.now()}_${index}_${attempt}`,
          sampleStart: index,
          pipelineStage: "sample",
          ourBrand: "势途 GEO",
          brandAliases: ["势途"],
          industry: "GEO 服务",
          questions: [question],
          competitors: [],
          models: [model],
        }),
      })
      const text = await response.text()
      let data: {
        error?: string
        byModel?: PenetrationByModel
        modelErrors?: Partial<Record<ModelKey, string>>
      } = {}
      try {
        data = JSON.parse(text) as typeof data
      } catch {
        data = { error: `non-JSON response HTTP ${response.status}` }
      }
      const item = data.byModel?.[model]?.[0] as PenetrationItem | undefined
      const validationError = getPenetrationSlotValidationError(item)
      if (response.ok && item && !validationError) {
        return {
          index,
          model,
          success: true,
          attempts: attempt,
          durationMs: Date.now() - startedAt,
          sources: item.searchSources?.length || 0,
        }
      }
      lastError = safeError(
        data.modelErrors?.[model]
        || validationError
        || data.error
        || `HTTP ${response.status}`,
      )
    } catch (error) {
      lastError = safeError(error instanceof Error ? error.message : error)
    }
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, attempt * 1_000))
    }
  }

  return {
    index,
    model,
    success: false,
    attempts: maxAttempts,
    durationMs: Date.now() - startedAt,
    sources: 0,
    error: lastError || "strict evidence incomplete",
  }
}

console.log(
  `[stress] start requests=${requestCount} concurrency=${concurrency} models=${models.join(",")} attempts=${maxAttempts}`,
)
const startedAt = Date.now()
const results: StressResult[] = []
let cursor = 0

async function worker(): Promise<void> {
  while (true) {
    const index = cursor++
    if (index >= requestCount) return
    const result = await runCase(index)
    results.push(result)
    console.log(
      `[stress] ${result.success ? "ok" : "fail"} request=${index + 1}/${requestCount} model=${result.model} duration=${result.durationMs}ms sources=${result.sources}${result.error ? ` error=${result.error}` : ""}`,
    )
  }
}

await Promise.all(Array.from(
  { length: Math.min(concurrency, requestCount) },
  () => worker(),
))

const elapsedMs = Date.now() - startedAt
const succeeded = results.filter(result => result.success)
const failures = results.filter(result => !result.success)
const durations = results.map(result => result.durationMs)
const successRate = succeeded.length / requestCount
const summary = {
  requestCount,
  concurrency,
  succeeded: succeeded.length,
  failed: failures.length,
  successRate: Number(successRate.toFixed(4)),
  elapsedMs,
  throughputPerMinute: Number((succeeded.length / Math.max(1, elapsedMs) * 60_000).toFixed(2)),
  latencyMs: {
    p50: percentile(durations, 0.5),
    p95: percentile(durations, 0.95),
    p99: percentile(durations, 0.99),
    max: Math.max(...durations),
  },
  averageSources: Number((
    succeeded.reduce((sum, result) => sum + result.sources, 0)
    / Math.max(1, succeeded.length)
  ).toFixed(2)),
}
console.log(JSON.stringify(summary, null, 2))
if (failures.length > 0) {
  console.table(failures.slice(0, 20).map(result => ({
    request: result.index + 1,
    model: result.model,
    durationMs: result.durationMs,
    error: result.error,
  })))
}
if (successRate < minSuccessRate) {
  console.error(`[stress] success rate ${successRate.toFixed(2)} below ${minSuccessRate.toFixed(2)}`)
  process.exitCode = 1
}
if (maxP95Ms > 0 && summary.latencyMs.p95 > maxP95Ms) {
  console.error(`[stress] p95 ${summary.latencyMs.p95}ms exceeds ${maxP95Ms}ms`)
  process.exitCode = 1
}
