import type { ModelKey, PenetrationByModel } from "../src/types"

const { createInternalApiHeaders } = await import("../src/lib/internal-api")
const {
  getPenetrationSlotValidationError,
  isCompletePenetrationItem,
} = await import("../src/lib/penetration/slot-policy")

const baseUrl = (process.env.PENETRATION_STRESS_BASE_URL || "http://127.0.0.1:3101").replace(/\/$/, "")
const models = (process.env.PENETRATION_STRESS_MODELS || "doubao,deepseek,qwen,ernie,hunyuan")
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

type ModelStats = { succeeded: number; attempts: number; sources: number }
const stats = Object.fromEntries(models.map(model => [model, {
  succeeded: 0,
  attempts: 0,
  sources: 0,
}])) as Record<ModelKey, ModelStats>
const failures: Array<{ questionIndex: number; model: ModelKey; error: string }> = []

function safeError(value: unknown): string {
  return String(value || "unknown error")
    .replace(/bce-v3\/[A-Za-z0-9_\-/]+/g, "bce-v3/***")
    .replace(/Bearer\s+[A-Za-z0-9._\-/]{16,}/gi, "Bearer ***")
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, "sk-***")
    .replace(/\s+/g, " ")
    .slice(0, 240)
}

for (let questionIndex = 0; questionIndex < questions.length; questionIndex++) {
  const question = questions[questionIndex]
  let pending = [...models]
  const completed = new Set<ModelKey>()

  for (let attempt = 1; attempt <= 3 && pending.length > 0; attempt++) {
    for (const model of pending) stats[model].attempts++
    const response = await fetch(`${baseUrl}/api/penetration`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...createInternalApiHeaders("penetration-job"),
      },
      body: JSON.stringify({
        runId: "penetration_stress_20260716",
        sampleStart: questionIndex,
        ourBrand: "势途 GEO",
        brandAliases: ["势途"],
        industry: "GEO 服务",
        questions: [question],
        competitors: [],
        models: pending,
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
    if (!response.ok || !data.byModel) {
      if (attempt === 3) {
        for (const model of pending) {
          failures.push({ questionIndex: questionIndex + 1, model, error: safeError(data.error) })
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, attempt === 1 ? 2_000 : 5_000))
      }
      continue
    }

    const retry: ModelKey[] = []
    for (const model of pending) {
      const item = data.byModel[model]?.[0]
      if (isCompletePenetrationItem(item)) {
        completed.add(model)
        stats[model].succeeded++
        stats[model].sources += item.searchSources?.length || 0
      } else if (attempt === 3) {
        failures.push({
          questionIndex: questionIndex + 1,
          model,
          error: safeError(
            data.modelErrors?.[model]
            || getPenetrationSlotValidationError(item)
            || "strict evidence incomplete",
          ),
        })
      } else {
        retry.push(model)
      }
    }
    pending = retry
    console.log(
      `[stress] question=${questionIndex + 1}/${questions.length} attempt=${attempt} complete=${completed.size}/${models.length} retry=${pending.join(",") || "none"}`,
    )
    if (pending.length > 0) {
      await new Promise(resolve => setTimeout(resolve, attempt === 1 ? 2_000 : 5_000))
    }
  }
}

console.table(Object.entries(stats).map(([model, value]) => ({ model, ...value })))
console.log(`[stress] complete=${Object.values(stats).reduce((sum, value) => sum + value.succeeded, 0)}/${questions.length * models.length}`)
if (failures.length > 0) {
  console.table(failures)
  process.exitCode = 1
}
