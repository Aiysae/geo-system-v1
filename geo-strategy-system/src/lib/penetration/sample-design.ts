import type {
  PenetrationByModel,
  PenetrationQuestionCategory,
  PenetrationQuestionCategoryCounts,
  PenetrationQuestionGenerationSettings,
  PenetrationQuestionIntentHint,
  PenetrationQuestionSample,
  PenetrationSampleConfidence,
  PenetrationSampleQuality,
  PenetrationSourceDiversity,
} from "@/types"
import { isAuditableSourceUrl } from "@/lib/llm/source-extract"

export const PENETRATION_QUESTION_CATEGORIES: PenetrationQuestionCategory[] = [
  "recommendation",
  "pain_solution",
  "comparison",
  "purchase_decision",
  "scenario_audience",
  "brand_cognition",
  "risk_concern",
]

export const PENETRATION_QUESTION_CATEGORY_LABELS: Record<
  PenetrationQuestionCategory,
  string
> = {
  recommendation: "榜单推荐型",
  pain_solution: "痛点解决型",
  comparison: "竞品对比型",
  purchase_decision: "采购决策型",
  scenario_audience: "场景人群型",
  brand_cognition: "品牌认知型",
  risk_concern: "风险疑虑型",
}

export const PENETRATION_QUESTION_CATEGORY_DESCRIPTIONS: Record<
  PenetrationQuestionCategory,
  string
> = {
  recommendation: "寻找榜单、推荐对象和常见选择",
  pain_solution: "围绕问题、失败原因和解决办法",
  comparison: "比较方案、路线和服务类型的差异",
  purchase_decision: "关注预算、参数、合同和交付判断",
  scenario_audience: "限定地区、人群、身份或使用场景",
  brand_cognition: "了解行业认知、口碑、实力和地位",
  risk_concern: "核验风险、资质、收费和售后保障",
}

export const DEFAULT_PENETRATION_QUESTION_GENERATION_SETTINGS: PenetrationQuestionGenerationSettings = {
  count: 28,
  keywords: "",
  allocationMode: "balanced",
  categories: [...PENETRATION_QUESTION_CATEGORIES],
  categoryCounts: {},
}

export const PENETRATION_SAMPLE_PRESETS = {
  quick: {
    count: 14,
    label: "快速检测",
    description: "每类 2 条，用于方向判断",
  },
  standard: {
    count: 28,
    label: "标准检测",
    description: "每类 4 条，用于正式分析",
  },
  deep: {
    count: 42,
    label: "深度检测",
    description: "每类 6 条，用于高稳定度报告",
  },
} as const

const CATEGORY_ALIASES = new Map<string, PenetrationQuestionCategory>([
  ["recommendation", "recommendation"],
  ["榜单推荐型", "recommendation"],
  ["榜单推荐", "recommendation"],
  ["推荐型", "recommendation"],
  ["pain_solution", "pain_solution"],
  ["痛点解决型", "pain_solution"],
  ["痛点解决", "pain_solution"],
  ["comparison", "comparison"],
  ["竞品对比型", "comparison"],
  ["竞品对比", "comparison"],
  ["对比型", "comparison"],
  ["purchase_decision", "purchase_decision"],
  ["采购决策型", "purchase_decision"],
  ["采购决策", "purchase_decision"],
  ["选型决策", "purchase_decision"],
  ["scenario_audience", "scenario_audience"],
  ["场景人群型", "scenario_audience"],
  ["场景人群", "scenario_audience"],
  ["brand_cognition", "brand_cognition"],
  ["品牌认知型", "brand_cognition"],
  ["品牌认知", "brand_cognition"],
  ["人物认知型", "brand_cognition"],
  ["人物认知", "brand_cognition"],
  ["risk_concern", "risk_concern"],
  ["风险疑虑型", "risk_concern"],
  ["风险疑虑", "risk_concern"],
  ["避坑风险", "risk_concern"],
])

const CATEGORY_PATTERNS: Array<{
  category: PenetrationQuestionCategory
  patterns: RegExp[]
}> = [
  {
    category: "risk_concern",
    patterns: [
      /避坑|踩坑|骗局|真假|风险|隐形(?:收费|消费)|乱收费|安全|合规|副作用|缺点|弊端|不建议|资质|承诺|售后纠纷/u,
      /会不会(?:被骗|踩坑|有风险|不安全)|如何避免/u,
    ],
  },
  {
    category: "comparison",
    patterns: [
      /(?:和|与).{1,24}(?:区别|差异|对比|比较)|\bvs\b|优劣|哪个更|哪种更|还是.{1,20}好/u,
      /横向对比|竞品|替代(?:品|方案)/u,
    ],
  },
  {
    category: "purchase_decision",
    patterns: [
      /价格|多少钱|费用|收费|预算|报价|成本|性价比|采购|购买|怎么买|选型|参数|配置|合同|交付|售后/u,
      /选择标准|怎么选|如何选|选购/u,
    ],
  },
  {
    category: "scenario_audience",
    patterns: [
      /适合|不适合|使用场景|应用场景|什么人|哪类人|人群|新手|专业人士|企业|个人|医生|律师|学生|儿童|老人|孕妇/u,
      /本地|附近|全国|海外|出海|一线城市|二线城市|三线城市|县城|农村/u,
    ],
  },
  {
    category: "pain_solution",
    patterns: [
      /怎么办|怎么解决|如何解决|为什么|为何|失败|无法|不准|不稳定|效果不好|没效果|没有效果|难题|痛点|问题/u,
      /提升|改善|修复|补救|处理方法|解决方案/u,
    ],
  },
  {
    category: "brand_cognition",
    patterns: [
      /品牌认知|知名度|市场地位|行业地位|品牌印象|品牌形象/u,
      /(?:品牌|公司|机构|服务商|供应商).{0,12}(?:怎么样|靠谱吗|口碑|评价|实力|背景)/u,
    ],
  },
  {
    category: "recommendation",
    patterns: [
      /推荐|榜单|排行|排名|哪家好|哪个好|哪些好|好用|值得|口碑好|靠谱的.{0,12}(?:有|哪)/u,
      /有哪些|求推荐|常用/u,
    ],
  },
]

const INTENT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bapps?\b|应用程序|小程序|软件/giu, "工具"],
  [/厂商|厂家|服务商|供应商/gu, "公司"],
  [/价位|报价|费用|收费标准/gu, "价格"],
  [/选购|选型|挑选/gu, "选择"],
  [/对比|比较|横评/gu, "区别"],
]

const INTENT_FILLER_PATTERNS: RegExp[] = [
  /大众评价高的|用户评价高的|口碑比较好的|口碑好的|比较靠谱的|靠谱的|专业的|实用的|值得信赖的/gu,
  /哪个好用|哪家好|哪个好|哪些好|求推荐|推荐一下|值得推荐|有推荐吗|推荐有哪些|有哪些推荐/gu,
  /有哪些|有什么|都有什么|可以推荐|常用的|比较好|更好/gu,
  /请问|想问一下|麻烦问下|帮我看看|现在|目前|一般来说/gu,
  /吗|呢|啊|呀|么|？|\?/gu,
]

function normalizeQuestionText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
}

export function questionIdentityKey(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, " ")
}

export function normalizeQuestionIntent(value: string): string {
  let normalized = value.normalize("NFKC").toLowerCase()
  for (const [pattern, replacement] of INTENT_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement)
  }
  for (const pattern of INTENT_FILLER_PATTERNS) {
    normalized = normalized.replace(pattern, "")
  }
  return normalized.replace(/[^\p{L}\p{N}]+/gu, "")
}

export function normalizePenetrationQuestionCategory(
  value: unknown,
): PenetrationQuestionCategory | null {
  const normalized = String(value || "").trim()
  if (!normalized) return null
  return CATEGORY_ALIASES.get(normalized) || CATEGORY_ALIASES.get(normalized.toLowerCase()) || null
}

export function normalizePenetrationQuestionCategories(
  value: unknown,
): PenetrationQuestionCategory[] {
  if (!Array.isArray(value)) return []
  const requested = new Set(
    value
      .map(normalizePenetrationQuestionCategory)
      .filter((item): item is PenetrationQuestionCategory => Boolean(item)),
  )
  return PENETRATION_QUESTION_CATEGORIES.filter(category => requested.has(category))
}

export function normalizePenetrationQuestionGenerationSettings(
  value: unknown,
): PenetrationQuestionGenerationSettings {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const selected = normalizePenetrationQuestionCategories(record.categories)
  const categories = selected.length > 0
    ? selected
    : [...PENETRATION_QUESTION_CATEGORIES]
  const requestedCount = Number(record.count)
  const count = Math.max(
    categories.length,
    Math.min(84, Number.isFinite(requestedCount) ? Math.floor(requestedCount) : 28),
  )
  const allocationMode = record.allocationMode === "custom" ? "custom" : "balanced"
  const rawCounts = record.categoryCounts && typeof record.categoryCounts === "object"
    ? record.categoryCounts as Record<string, unknown>
    : {}
  const categoryCounts: PenetrationQuestionCategoryCounts = {}
  for (const category of categories) {
    const raw = Number(rawCounts[category])
    if (Number.isFinite(raw) && raw > 0) categoryCounts[category] = Math.floor(raw)
  }

  if (allocationMode === "custom") {
    const fallback = buildPenetrationCategoryQuotas(count, categories)
    for (const item of fallback) {
      if (!categoryCounts[item.category]) categoryCounts[item.category] = item.count
    }
    const customTotal = categories.reduce(
      (sum, category) => sum + (categoryCounts[category] || 0),
      0,
    )
    if (customTotal <= 84) {
      return {
        count: customTotal,
        keywords: String(record.keywords || "").trim().slice(0, 500),
        allocationMode,
        categories,
        categoryCounts,
      }
    }
  }

  return {
    count,
    keywords: String(record.keywords || "").trim().slice(0, 500),
    allocationMode: "balanced",
    categories,
    categoryCounts: {},
  }
}

export function normalizePenetrationQuestionIntentHints(
  value: unknown,
  questions?: string[],
): PenetrationQuestionIntentHint[] {
  if (!Array.isArray(value)) return []
  const allowed = questions
    ? new Set(questions.map(questionIdentityKey).filter(Boolean))
    : null
  const byQuestion = new Map<string, PenetrationQuestionIntentHint>()
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const question = String(record.question || "").trim()
    const category = normalizePenetrationQuestionCategory(record.category)
    const key = questionIdentityKey(question)
    if (!question || !category || !key || (allowed && !allowed.has(key))) continue
    byQuestion.set(key, { question, category })
  }
  return Array.from(byQuestion.values())
}

export function inferPenetrationQuestionCategory(
  question: string,
): PenetrationQuestionCategory {
  const normalized = question.normalize("NFKC").toLowerCase()
  for (const group of CATEGORY_PATTERNS) {
    if (group.patterns.some(pattern => pattern.test(normalized))) return group.category
  }
  return "recommendation"
}

function characterBigrams(value: string): Set<string> {
  const chars = Array.from(value)
  if (chars.length < 2) return new Set(chars)
  const grams = new Set<string>()
  for (let index = 0; index < chars.length - 1; index++) {
    grams.add(`${chars[index]}${chars[index + 1]}`)
  }
  return grams
}

function diceSimilarity(left: string, right: string): number {
  const leftGrams = characterBigrams(left)
  const rightGrams = characterBigrams(right)
  if (leftGrams.size === 0 && rightGrams.size === 0) return 1
  let overlap = 0
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) overlap++
  }
  return (2 * overlap) / Math.max(1, leftGrams.size + rightGrams.size)
}

export function arePenetrationQuestionsSemanticallySimilar(
  left: string,
  right: string,
): boolean {
  const leftIntent = normalizeQuestionIntent(left)
  const rightIntent = normalizeQuestionIntent(right)
  if (!leftIntent || !rightIntent) {
    return normalizeQuestionText(left) === normalizeQuestionText(right)
  }
  if (leftIntent === rightIntent) return true

  const shorter = leftIntent.length <= rightIntent.length ? leftIntent : rightIntent
  const longer = shorter === leftIntent ? rightIntent : leftIntent
  if (
    shorter.length >= 4
    && longer.includes(shorter)
    && shorter.length / Math.max(1, longer.length) >= 0.58
  ) {
    return true
  }
  return diceSimilarity(leftIntent, rightIntent) >= 0.78
}

function stableIntentId(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `intent_${(hash >>> 0).toString(36)}`
}

export function buildPenetrationQuestionSamples(
  questions: string[],
  questionIntents: PenetrationQuestionIntentHint[] = [],
): PenetrationQuestionSample[] {
  const hintByQuestion = new Map(
    normalizePenetrationQuestionIntentHints(questionIntents, questions)
      .map(item => [questionIdentityKey(item.question), item.category]),
  )
  const prepared = questions
    .map(question => question.trim())
    .filter(Boolean)
    .map(question => ({
      question,
      category: hintByQuestion.get(questionIdentityKey(question))
        || inferPenetrationQuestionCategory(question),
      normalizedIntent: normalizeQuestionIntent(question) || normalizeQuestionText(question),
    }))
  const parent = prepared.map((_, index) => index)

  const find = (index: number): number => {
    let current = index
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]]
      current = parent[current]
    }
    return current
  }
  const union = (left: number, right: number) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot
  }

  for (let left = 0; left < prepared.length; left++) {
    for (let right = left + 1; right < prepared.length; right++) {
      if (prepared[left].category !== prepared[right].category) continue
      if (arePenetrationQuestionsSemanticallySimilar(
        prepared[left].question,
        prepared[right].question,
      )) {
        union(left, right)
      }
    }
  }

  const representatives = new Map<number, string>()
  for (let index = 0; index < prepared.length; index++) {
    const root = find(index)
    const current = representatives.get(root)
    const candidate = prepared[index].normalizedIntent
    if (!current || candidate.localeCompare(current, "zh-CN") < 0) {
      representatives.set(root, candidate)
    }
  }

  return prepared.map((item, index) => {
    const representative = representatives.get(find(index)) || item.normalizedIntent
    return {
      ...item,
      intentId: stableIntentId(`${item.category}:${representative}`),
    }
  })
}

export function buildPenetrationCategoryQuotas(
  count: number,
  categories: PenetrationQuestionCategory[] = PENETRATION_QUESTION_CATEGORIES,
  customCounts?: PenetrationQuestionCategoryCounts,
): Array<{ category: PenetrationQuestionCategory; count: number }> {
  const selected = normalizePenetrationQuestionCategories(categories)
  const activeCategories = selected.length > 0
    ? selected
    : [...PENETRATION_QUESTION_CATEGORIES]

  if (customCounts) {
    const custom = activeCategories
      .map(category => ({
        category,
        count: Math.max(0, Math.floor(Number(customCounts[category]) || 0)),
      }))
      .filter(item => item.count > 0)
    if (custom.length > 0) return custom
  }

  const normalizedCount = Math.max(activeCategories.length, Math.floor(count))
  const base = Math.floor(normalizedCount / activeCategories.length)
  let remaining = normalizedCount % activeCategories.length
  return activeCategories.map(category => {
    const quota = base + (remaining > 0 ? 1 : 0)
    remaining = Math.max(0, remaining - 1)
    return { category, count: quota }
  })
}

function normalizedSourceUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    parsed.hash = ""
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_.+|spm|from|from_source|share_token|track)$/i.test(key)) {
        parsed.searchParams.delete(key)
      }
    }
    return parsed.toString()
  } catch {
    return null
  }
}

export function computePenetrationSourceDiversity(
  byModel: PenetrationByModel,
): PenetrationSourceDiversity {
  const uniqueUrls = new Set<string>()
  const uniqueDomains = new Set<string>()
  const urlReuse = new Map<string, number>()
  const domainEvents = new Map<string, number>()
  let citationEvents = 0

  for (const items of Object.values(byModel)) {
    for (const item of items || []) {
      if (!item.answer?.trim()) continue
      const seenInAnswer = new Set<string>()
      for (const source of item.searchSources || []) {
        const url = normalizedSourceUrl(String(source.url || ""))
        if (
          !url
          || !isAuditableSourceUrl(url, String(source.title || ""), String(source.snippet || ""))
        ) continue
        if (seenInAnswer.has(url)) continue
        seenInAnswer.add(url)
        citationEvents++
        uniqueUrls.add(url)
        urlReuse.set(url, (urlReuse.get(url) || 0) + 1)
        let domain = String(source.domain || "").trim().toLowerCase().replace(/^www\./, "")
        if (!domain) {
          try {
            domain = new URL(url).hostname.toLowerCase().replace(/^www\./, "")
          } catch {
            domain = ""
          }
        }
        if (!domain) continue
        uniqueDomains.add(domain)
        domainEvents.set(domain, (domainEvents.get(domain) || 0) + 1)
      }
    }
  }

  const topDomainEntry = Array.from(domainEvents.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]
  return {
    citationEvents,
    uniqueUrlCount: uniqueUrls.size,
    uniqueDomainCount: uniqueDomains.size,
    duplicateCitationRate: citationEvents > 0
      ? Math.max(0, 1 - uniqueUrls.size / citationEvents)
      : 0,
    maxUrlReuse: Math.max(0, ...urlReuse.values()),
    topDomain: topDomainEntry?.[0] || null,
    topDomainShare: citationEvents > 0 ? (topDomainEntry?.[1] || 0) / citationEvents : 0,
  }
}

function categoryBalance(categoryCounts: number[], questionCount: number): number {
  if (questionCount <= 0) return 0
  let entropy = 0
  for (const count of categoryCounts) {
    if (count <= 0) continue
    const share = count / questionCount
    entropy -= share * Math.log(share)
  }
  return Math.min(1, entropy / Math.log(PENETRATION_QUESTION_CATEGORIES.length))
}

function confidenceLabel(confidence: PenetrationSampleConfidence): string {
  if (confidence === "high") return "标准可信"
  if (confidence === "medium") return "方向性"
  return "探索性"
}

export function buildPenetrationSampleQuality(
  questions: string[],
  options: {
    modelCount?: number
    plannedSlots?: number
    completedSlots?: number
    sourceDiversity?: PenetrationSourceDiversity
    questionIntents?: PenetrationQuestionIntentHint[]
    intendedCategories?: PenetrationQuestionCategory[]
  } = {},
): PenetrationSampleQuality {
  const samples = buildPenetrationQuestionSamples(questions, options.questionIntents)
  const questionCount = samples.length
  const distinctQuestionCount = new Set(samples.map(sample => normalizeQuestionText(sample.question))).size
  const semanticIntentCount = new Set(samples.map(sample => sample.intentId)).size
  const semanticDuplicateRate = questionCount > 0
    ? Math.max(0, 1 - semanticIntentCount / questionCount)
    : 0
  const categoryCounts = PENETRATION_QUESTION_CATEGORIES.map(category => {
    const categorySamples = samples.filter(sample => sample.category === category)
    return {
      category,
      questionCount: categorySamples.length,
      intentCount: new Set(categorySamples.map(sample => sample.intentId)).size,
    }
  })
  const coveredCategories = categoryCounts.filter(item => item.questionCount > 0)
  const categoryCoverageCount = coveredCategories.length
  const intendedCategories = normalizePenetrationQuestionCategories(options.intendedCategories)
  const scopeCategories = intendedCategories.length > 0
    ? intendedCategories
    : coveredCategories.map(item => item.category)
  const scopeMode: "comprehensive" | "focused" =
    scopeCategories.length === PENETRATION_QUESTION_CATEGORIES.length
      ? "comprehensive"
      : "focused"
  const minCategoryCount = categoryCoverageCount === PENETRATION_QUESTION_CATEGORIES.length
    ? Math.min(...categoryCounts.map(item => item.questionCount))
    : 0
  const maxCategoryShare = questionCount > 0
    ? Math.max(0, ...categoryCounts.map(item => item.questionCount / questionCount))
    : 0
  const modelCount = Math.max(0, Math.floor(options.modelCount || 0))
  const inferredPlannedSlots = questionCount * modelCount
  const plannedSlots = Math.max(0, Math.floor(options.plannedSlots ?? inferredPlannedSlots))
  const completedSlots = Math.max(
    0,
    Math.min(plannedSlots || Number.MAX_SAFE_INTEGER, Math.floor(options.completedSlots ?? plannedSlots)),
  )
  const completionRate = plannedSlots > 0 ? completedSlots / plannedSlots : 0
  const balance = categoryBalance(
    categoryCounts.map(item => item.questionCount),
    questionCount,
  )
  const score = Math.round(
    30 * Math.min(1, semanticIntentCount / 28)
    + 25 * (categoryCoverageCount / PENETRATION_QUESTION_CATEGORIES.length)
    + 15 * balance
    + 15 * (1 - semanticDuplicateRate)
    + 10 * Math.min(1, modelCount / 4)
    + 5 * completionRate,
  )
  const sourceLimited = Boolean(
    options.sourceDiversity
    && (
      options.sourceDiversity.topDomainShare > 0.5
      || (
        options.sourceDiversity.duplicateCitationRate > 0.75
        && options.sourceDiversity.uniqueDomainCount < 5
      )
    ),
  )

  let confidence: PenetrationSampleConfidence = "low"
  if (
    questionCount >= 28
    && semanticIntentCount >= 21
    && categoryCoverageCount === 7
    && minCategoryCount >= 3
    && semanticDuplicateRate <= 0.25
    && modelCount >= 4
    && completionRate >= 0.95
    && !sourceLimited
  ) {
    confidence = "high"
  } else if (
    questionCount >= 14
    && semanticIntentCount >= 10
    && categoryCoverageCount >= 6
    && semanticDuplicateRate <= 0.4
    && modelCount >= 3
    && completionRate >= 0.9
  ) {
    confidence = "medium"
  }

  const warnings: string[] = []
  if (questionCount < 14) warnings.push(`当前只有 ${questionCount} 条问题，低于快速检测建议的 14 条。`)
  else if (questionCount < 28) warnings.push(`当前为方向性样本；正式分析建议使用 28 条问题。`)
  if (categoryCoverageCount < 7) {
    if (scopeMode === "focused" && scopeCategories.length > 0) {
      warnings.push(
        `当前为专项意图样本，覆盖：${scopeCategories.map(category => PENETRATION_QUESTION_CATEGORY_LABELS[category]).join("、")}；不代表七类综合渗透率。`,
      )
    } else {
      const missing = categoryCounts
        .filter(item => item.questionCount === 0)
        .map(item => PENETRATION_QUESTION_CATEGORY_LABELS[item.category])
      warnings.push(`七类问题未覆盖完整，缺少：${missing.join("、")}。`)
    }
  }
  if (semanticDuplicateRate > 0.2) {
    warnings.push(`约 ${Math.round(semanticDuplicateRate * 100)}% 的问题语义近似，不能视为新的独立意图。`)
  }
  const recommendationCount = categoryCounts.find(item => item.category === "recommendation")?.questionCount || 0
  if (questionCount > 0 && recommendationCount / questionCount > 0.5) {
    warnings.push("榜单推荐型问题超过一半，可能把单一推荐场景误当成整体渗透率。")
  }
  if (modelCount < 3) warnings.push(`当前只有 ${modelCount} 个有效模型，建议至少覆盖 3 个模型。`)
  if (plannedSlots > 0 && completionRate < 0.9) {
    warnings.push(`有效槽位完成率只有 ${Math.round(completionRate * 100)}%，当前结果属于部分样本。`)
  }
  if (options.sourceDiversity?.duplicateCitationRate && options.sourceDiversity.duplicateCitationRate > 0.5) {
    warnings.push(
      `信源引用重复率为 ${Math.round(options.sourceDiversity.duplicateCitationRate * 100)}%，应同时查看唯一网址和域名覆盖。`,
    )
  }
  if (options.sourceDiversity?.topDomainShare && options.sourceDiversity.topDomainShare > 0.35) {
    warnings.push(
      `单一域名占全部引用的 ${Math.round(options.sourceDiversity.topDomainShare * 100)}%，信源集中度偏高。`,
    )
  }

  return {
    version: 1,
    score: Math.max(0, Math.min(100, score)),
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    questionCount,
    distinctQuestionCount,
    semanticIntentCount,
    semanticDuplicateRate,
    categoryCoverageCount,
    categoryCounts,
    minCategoryCount,
    maxCategoryShare,
    modelCount,
    plannedSlots,
    completedSlots,
    completionRate,
    sourceDiversity: options.sourceDiversity,
    scopeMode,
    scopeCategories,
    warnings,
  }
}
