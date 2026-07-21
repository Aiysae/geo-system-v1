import type {
  AnalysisSubjectType,
  IndustryShareItem,
  ModelKey,
  PenetrationAggregated,
  PenetrationByModel,
  PenetrationQuestionCategory,
  PenetrationQuestionIntentHint,
  PerModelRate,
} from "@/types"
import {
  collectObservedSubjects,
  createSubjectResolver,
  isSameSubject,
} from "@/lib/subject-canonicalization"
import {
  buildPenetrationQuestionSamples,
  buildPenetrationSampleQuality,
  computePenetrationSourceDiversity,
} from "@/lib/penetration/sample-design"

// 宽松匹配：把空格/大小写差异都抹掉后，任一方包含另一方即视为同一品牌
// 例：用户填 "势途"、模型返回 "势途GEO" / "势途 GEO" → 都识别为我方
export function isSameBrand(a: string, b: string): boolean {
  return isSameSubject(a, b, "brand")
}

type RateAccumulator = {
  mentions: number
  total: number
}

type PenetrationAggregateOptions = {
  plannedQuestions?: string[]
  questionIntents?: PenetrationQuestionIntentHint[]
  plannedSlots?: number
  modelCount?: number
}

function questionKey(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ")
}

function meanRate(values: Iterable<RateAccumulator>): number {
  const rates = Array.from(values)
    .filter(value => value.total > 0)
    .map(value => value.mentions / value.total)
  return rates.length > 0
    ? rates.reduce((sum, value) => sum + value, 0) / rates.length
    : 0
}

function representativeQuestions(byModel: PenetrationByModel): string[] {
  const candidates = Object.values(byModel)
    .map(items => (items || []).filter(item => item.answer?.trim()).map(item => item.question))
    .sort((left, right) => right.length - left.length)
  return candidates[0] || []
}

export function aggregatePenetration(
  byModel: PenetrationByModel,
  ourBrand: string,
  brandAliases: string[] = [],
  competitors: string[] = [],
  subjectType: AnalysisSubjectType = "brand",
  options: PenetrationAggregateOptions = {},
): PenetrationAggregated {
  const resolver = createSubjectResolver({
    subjectType,
    ourBrand,
    brandAliases,
    competitors,
    observedBrands: collectObservedSubjects(byModel, subjectType),
  })
  const brandCount = new Map<string, { displayName: string; count: number }>()
  const perModelRate: PerModelRate[] = []
  let ourMentions = 0
  let totalSlots = 0
  const exactQuestionRates = new Map<string, RateAccumulator>()
  const intentRates = new Map<string, RateAccumulator>()
  const intentCategories = new Map<string, PenetrationQuestionCategory>()

  const mentionedByAnyModel = new Set<string>()
  const allQuestions = new Set<string>()
  const observedQuestions = Array.from(new Set(
    Object.values(byModel)
      .flatMap(items => (items || []).filter(item => item.answer?.trim()).map(item => item.question)),
  ))
  const questionSamples = buildPenetrationQuestionSamples(
    observedQuestions,
    options.questionIntents,
  )
  const sampleByQuestion = new Map(
    questionSamples.map(sample => [questionKey(sample.question), sample]),
  )

  function recordRate(
    rates: Map<string, RateAccumulator>,
    key: string,
    hit: boolean,
  ) {
    const current = rates.get(key) || { mentions: 0, total: 0 }
    current.total += 1
    if (hit) current.mentions += 1
    rates.set(key, current)
  }

  for (const [model, items] of Object.entries(byModel)) {
    if (!items) continue
    let modelMentions = 0
    let validModelSlots = 0
    for (const it of items) {
      // API 失败、熔断和空回复不属于有效模型回答，不能稀释渗透率。
      if (!it.answer?.trim()) continue
      allQuestions.add(it.question)
      totalSlots++
      validModelSlots++
      const canonicalBrands = resolver.canonicalizeList(it.mentionedBrands)

      // hitOur=true 是直接命中；裁判从原文抽取并校验过的简称/别名也可命中全称。
      // 这样能修复“排行榜识别到我方品牌，但提及率仍为 0%”的不一致。
      const hitOurInThisSlot = it.hitOur === true || canonicalBrands.some(b => b.isTarget)
      const sample = sampleByQuestion.get(questionKey(it.question))
        || buildPenetrationQuestionSamples([it.question])[0]
      const exactKey = questionKey(it.question)
      recordRate(exactQuestionRates, exactKey, hitOurInThisSlot)
      if (sample) {
        recordRate(intentRates, sample.intentId, hitOurInThisSlot)
        intentCategories.set(sample.intentId, sample.category)
      }
      if (hitOurInThisSlot) {
        ourMentions++
        modelMentions++
        mentionedByAnyModel.add(it.question)
      }

      // 累计 brandCount：同一主体的简称、英文名、组合名合并到同一个 canonical key；
      // 同一 slot 内若同时出现 "势途" + "势途GEO" 只算 1 次。
      for (const brand of canonicalBrands) {
        const prev = brandCount.get(brand.key)
        if (prev) {
          prev.count += 1
        } else {
          brandCount.set(brand.key, {
            displayName: brand.display,
            count: 1,
          })
        }
      }
    }
    perModelRate.push({
      model: model as ModelKey,
      total: validModelSlots,
      mentions: modelMentions,
      rate: validModelSlots ? modelMentions / validModelSlots : 0,
    })
  }

  const totalMentionsAll = Array.from(brandCount.values()).reduce((s, v) => s + v.count, 0)
  const industryShare: IndustryShareItem[] = Array.from(brandCount.entries())
    .map(([, v]) => ({
      brand: v.displayName,
      count: v.count,
      ratio: totalMentionsAll ? v.count / totalMentionsAll : 0,
      penetrationRate: totalSlots ? v.count / totalSlots : 0,
    }))
    .sort((a, b) => b.count - a.count)

  const rankingIdx = industryShare.findIndex(s => resolver.canonicalize(s.brand)?.isTarget)
  const ourRanking = rankingIdx >= 0 ? rankingIdx + 1 : null

  const missedQuestions = Array.from(allQuestions).filter(q => !mentionedByAnyModel.has(q))

  const topCompetitors = industryShare
    .filter(s => !resolver.canonicalize(s.brand)?.isTarget)
    .slice(0, 3)
    .map(s => s.brand)

  const categoryIntentRates = new Map<PenetrationQuestionCategory, RateAccumulator[]>()
  for (const [intentId, rate] of intentRates) {
    const category = intentCategories.get(intentId)
    if (!category) continue
    const values = categoryIntentRates.get(category) || []
    values.push(rate)
    categoryIntentRates.set(category, values)
  }
  const categoryRates = Array.from(categoryIntentRates.values()).map(rates => ({
    mentions: meanRate(rates),
    total: 1,
  }))
  const plannedQuestions = options.plannedQuestions?.filter(question => question.trim())
    || representativeQuestions(byModel)
  const modelCount = Math.max(
    0,
    Math.floor(options.modelCount ?? Object.keys(byModel).length),
  )
  const plannedSlots = Math.max(0, Math.floor(options.plannedSlots ?? totalSlots))
  const sourceDiversity = computePenetrationSourceDiversity(byModel)
  const sampleQuality = buildPenetrationSampleQuality(plannedQuestions, {
    modelCount,
    plannedSlots,
    completedSlots: totalSlots,
    sourceDiversity,
    questionIntents: options.questionIntents,
  })

  const institutionCount = new Map<string, { displayName: string; count: number }>()
  if (subjectType === "person") {
    for (const items of Object.values(byModel)) {
      for (const item of items || []) {
        if (!item.answer?.trim()) continue
        const seen = new Set<string>()
        for (const entity of item.mentionedEntities || []) {
          if (entity.kind !== "organization") continue
          const displayName = entity.name.trim()
          const key = displayName.toLowerCase().replace(/[\s　]+/gu, "")
          if (!key || seen.has(key)) continue
          seen.add(key)
          const current = institutionCount.get(key)
          if (current) current.count += 1
          else institutionCount.set(key, { displayName, count: 1 })
        }
      }
    }
  }
  const institutionMentions = Array.from(institutionCount.values())
    .reduce((sum, value) => sum + value.count, 0)
  const institutionShare = Array.from(institutionCount.values())
    .map(value => ({
      brand: value.displayName,
      count: value.count,
      ratio: institutionMentions ? value.count / institutionMentions : 0,
      penetrationRate: totalSlots ? value.count / totalSlots : 0,
    }))
    .sort((left, right) => right.count - left.count)

  return {
    penetrationRate: totalSlots ? ourMentions / totalSlots : 0,
    ourMentions,
    totalSlots,
    plannedSlots,
    completionRate: sampleQuality.completionRate,
    questionLevelRate: meanRate(exactQuestionRates.values()),
    intentBalancedRate: meanRate(intentRates.values()),
    categoryBalancedRate: meanRate(categoryRates),
    sampleQuality,
    industryShare,
    institutionShare: subjectType === "person" ? institutionShare : undefined,
    ourRanking,
    perModelRate,
    missedQuestions,
    topCompetitors,
  }
}

// 强健的 LLM JSON 清洗器：剥离 markdown 代码块、首尾空格、前后说明性文字，
// 再尝试 JSON.parse。专门为"大模型即使被要求输出 JSON 仍偶尔包 ```json ... ``` "这类
// 失真返回值设计。失败时返回 null（由上层决定如何报错并展示原始文本）。
export function sanitizeLlmJson(raw: string): string {
  let s = (raw ?? "").trim()
  // 1) 剥离所有 markdown 代码块标记（兼容 ```json / ```JSON / ``` 出现在任意位置）
  s = s.replace(/```json\s*/gi, "").replace(/```/g, "")
  // 2) 去掉 /* */ 块注释（大模型偶尔会自作主张加注释；故意不剥离 // 行注释，
  //    以免误伤字符串里的 URL，如 "logo": "//cdn.x.com/a.png"）
  s = s.replace(/\/\*[\s\S]*?\*\//g, "")
  return s.trim()
}

export function parseJsonLoose(raw: string): unknown {
  const s = sanitizeLlmJson(raw)

  // 优先尝试直接 parse（清洗后已可能是完整 JSON）
  try {
    return JSON.parse(s)
  } catch {
    /* 继续 */
  }

  // 退而求其次：兼容对象 {…} 与数组 […] 两种形态，取最外层的 first..last
  const candidates: Array<{ open: string; close: string }> = [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
  ]
  for (const { open, close } of candidates) {
    const first = s.indexOf(open)
    const last = s.lastIndexOf(close)
    if (first < 0 || last <= first) continue
    const sliced = s.slice(first, last + 1)
    try {
      return JSON.parse(sliced)
    } catch {
      /* 继续 */
    }
    // 兜底 1：去掉对象/数组中的尾逗号（"foo",} 或 "foo",]）
    try {
      return JSON.parse(sliced.replace(/,(\s*[}\]])/g, "$1"))
    } catch {
      /* 继续 */
    }
    // 兜底 2：单引号 → 双引号
    try {
      return JSON.parse(sliced.replace(/'/g, '"').replace(/,(\s*[}\]])/g, "$1"))
    } catch {
      /* fallthrough */
    }
  }

  return null
}

// 严格版：解析失败时只返回结构化错误，不把模型原文透传到前端或日志。
export function parseJsonStrict<T = unknown>(raw: string, contextLabel = "LLM"): T {
  const parsed = parseJsonLoose(raw) as T | null
  if (parsed === null || parsed === undefined) {
    throw new Error(
      `${contextLabel} 返回内容无法解析为 JSON（已剥离 markdown 代码块后仍失败）。`
    )
  }
  return parsed
}
