import { NextRequest, NextResponse } from "next/server"
import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { openaiCompatChat } from "@/lib/llm/openai-compat"
import { parseJsonLoose } from "@/lib/score-utils"
import {
  DEFAULT_QUESTION_MODEL_PROVIDER,
  QUESTION_MODEL_PROVIDER_LABELS,
  normalizeQuestionModel,
  normalizeQuestionModelProvider,
  type QuestionItem,
} from "@/types/geo-strategy"

export const runtime = "nodejs"
export const maxDuration = 900
export const dynamic = "force-dynamic"

const BATCH_SIZE = 15
const BATCH_CONCURRENCY = 1
const CATEGORY_CONCURRENCY = 2
const MAX_STRUCTURED_ATTEMPTS = 2
const MAX_SINGLE_RUN_QUESTION_COUNT = 60
const REQUEST_BUDGET_MS = 840_000
const REQUEST_WRAP_UP_MS = 15_000
const MIN_CALL_BUDGET_MS = 20_000
const MAX_LLM_CALL_TIMEOUT_SEC = 180

// ==================== System Prompts ====================

const SYSTEM_TEMPLATE = `你是一个资深 GEO 疑问句生成专家。你需要基于策略方案和指定的关键词列表，生成高质量疑问句池。

核心规则：
1. 严格围绕指定的关键词列表和策略背景生成问题。
2. 不要从原始 OCR 噪声里生成问题。
3. 第一层问题覆盖 What/How：直接解决、推荐选择、场景需求、采购判断、对比测评、避坑指南、效率提升、榜单推荐。
4. 第二层问题覆盖 Why/If/Who：深层决策、适用人群、业务影响、购买前疑虑、选择逻辑、竞品判断、AI推荐机制、风险注意。
5. 第二层比例由用户控制，默认 35%，最高不超过 45%。
6. 禁止生成噪声问题：和业务无关、来自 OCR 错误、评分表、页码、模型名拼接出来的问题。
7. **question 字段必须模拟真实用户的自然提问**，就像用户在搜索引擎或 AI 助手中真实输入的那样。禁止出现任何品牌名、公司名、具体产品名，也禁止用"这个品牌"、"这类产品"、"该品类"等生硬泛指——这些一眼就能看出是营销内容。而是聚焦于用户的实际痛点、场景、决策困惑。

要求：
- 每条问题包含 id、layer、category、difficulty、keyword、question、intent、content_angle
- id 从起始编号连续递增

输出严格 JSON，格式：
{
  "question_strategy": [
    {
      "id": "1",
      "layer": "第一层",
      "category": "分类标签",
      "difficulty": "低-中",
      "keyword": "",
      "question": "",
      "intent": "",
      "content_angle": ""
    }
  ]
}`

// ==================== Prompt Builders ====================

function buildWeaknessSpinPrompt(
  strategy: Record<string, unknown>,
  count: number,
  startId: number,
  layer2Ratio: number,
  weaknesses: string[],
): string {
  const layer1Count = Math.round(count * (1 - layer2Ratio))
  const layer2Count = count - layer1Count

  const profile = (strategy.profile || {}) as Record<string, unknown>
  const weaknessList = weaknesses.map((w, i) => `${i + 1}. ${w}`).join("\n")

  return `你是一个品牌公关专家，擅长将品牌劣势通过内容策略转化为认知优势。

【品牌/产品背景】
- 品牌/产品: ${profile.brand_or_product || ""}
- 行业: ${profile.industry || ""}
- 产品说明: ${profile.product_description || ""}
- 目标受众: ${profile.audience || ""}

【需要积极转化的劣势】
${weaknessList}

【转化核心原则】
1. 不要否认劣势，而是从数据积累、客户案例、服务经验、专业见地等角度重新构建叙事框架
2. 硬事实类劣势（如"成立时间短"、"规模小"）虽然无法改变客观事实，但可以强调：拥有丰富的数据积累能力、大量客户服务案例、行业深度经验——时间短不代表积淀薄
3. 相对劣势（如"价格偏高"）从高品质选材、长期使用价值、专业服务附加值角度构建对比优势
4. 每个问题都模拟真实潜在客户在搜索引擎/大模型中的自然提问方式
5. 问题要具有实际的搜索价值，能直接导向可创作的内容
6. **question 字段禁止出现任何品牌名/公司名/具体产品名，也禁止用"这个品牌"、"这类产品"等泛指**，必须是真实用户会搜的痛点/场景/困惑类问题

【生成要求】
- 本批共 ${count} 条问题（第一层 ~${layer1Count} 条，第二层 ~${layer2Count} 条）
- 起始 ID: ${startId}
- 第一层问题覆盖: 直接解决、推荐选择、场景需求、采购判断
- 第二层问题覆盖: 深层决策、适用人群、业务影响、购买前疑虑
- 第二层比例约 ${Math.round(layer2Ratio * 100)}%
- category 字段统一填 "劣势积极转化"
- **question 字段禁止出现品牌名/公司名/具体产品名，也不要用"这个品牌"、"这类产品"等泛指**，必须聚焦用户的真实痛点、场景困惑、决策问题

输出严格 JSON：
{
  "question_strategy": [
    {
      "id": "${startId}",
      "layer": "第一层",
      "category": "劣势积极转化",
      "difficulty": "低-中",
      "keyword": "相关的劣势关键词",
      "question": "模拟用户真实提问",
      "intent": "用户的搜索意图",
      "content_angle": "建议的内容角度"
    }
  ]
}`
}

function buildKeywordPrompt(
  strategy: Record<string, unknown>,
  categoryLabel: string,
  categoryTag: string,
  count: number,
  startId: number,
  layer2Ratio: number,
  keywords: string[],
  extraInstructions: string,
): string {
  const layer1Count = Math.round(count * (1 - layer2Ratio))
  const layer2Count = count - layer1Count

  const profile = (strategy.profile || {}) as Record<string, unknown>
  const kwList = keywords.length > 0
    ? keywords.map((k, i) => `${i + 1}. ${k}`).join("\n")
    : "（无特定关键词列表，请基于品牌/产品背景生成）"

  return `你是一个资深 GEO 疑问句生成专家。

【品牌/产品背景】
- 品牌/产品: ${profile.brand_or_product || ""}
- 行业: ${profile.industry || ""}
- 目标受众: ${profile.audience || ""}
- 产品说明: ${profile.product_description || ""}

【类别】${categoryLabel}
【关键词列表】
${kwList}

${extraInstructions ? `【额外要求】\n${extraInstructions}\n` : ""}
【生成要求】
- 本批共 ${count} 条问题（第一层 ~${layer1Count} 条，第二层 ~${layer2Count} 条）
- 起始 ID: ${startId}
- 第一层: What/How 类问题（直接解决、推荐选择、场景需求、采购判断、对比测评等）
- 第二层: Why/If/Who 类问题（深层决策、适用人群、业务影响、选择逻辑等）
- 第二层比例约 ${Math.round(layer2Ratio * 100)}%
- 每个问题必须对应关键词列表中的关键词
- category 字段统一填 "${categoryTag}"
- 禁止生成与业务无关的通用问题
- **question 字段禁止出现品牌名/公司名/具体产品名，也不要用"这个品牌"、"这类产品"等泛指**，必须聚焦用户的真实痛点、场景困惑、决策问题

输出严格 JSON：
{
  "question_strategy": [
    {
      "id": "${startId}",
      "layer": "第一层",
      "category": "${categoryTag}",
      "difficulty": "低-中",
      "keyword": "来自列表的关键词",
      "question": "模拟用户真实提问",
      "intent": "用户的搜索意图",
      "content_angle": "建议的内容角度"
    }
  ]
}`
}

// ==================== Allocation Logic ====================

interface Allocation {
  category: "weakness_spin" | "core_keywords" | "secondary_keywords" | "pain_scenario"
  count: number
  keywords: string[]
  weaknesses?: string[]
}

function deriveCoreKeywords(strategy: Record<string, unknown>): string[] {
  const s = new Set<string>()
  const profile = (strategy.profile || {}) as Record<string, unknown>
  for (const t of (profile.terms as string[]) || []) { if (t.trim()) s.add(t.trim()) }
  const b = (profile.brand_or_product as string)?.trim()
  if (b) s.add(b)
  for (const a of (profile.advantages as string[]) || []) { if (a.trim()) s.add(a.trim()) }
  const ks = (strategy.keyword_strategy || {}) as Record<string, unknown>
  for (const kw of (ks.core_keywords as Array<{ keyword?: string }>) || []) {
    if (kw.keyword?.trim()) s.add(kw.keyword.trim())
  }
  return Array.from(s)
}

function deriveSecondaryKeywords(strategy: Record<string, unknown>, coreSet: Set<string>): string[] {
  const s = new Set<string>()
  const ks = (strategy.keyword_strategy || {}) as Record<string, unknown>
  for (const kw of [
    ...((ks.weakness_conversion_keywords || []) as Array<{ keyword?: string }>),
    ...((ks.pain_advantage_keywords || []) as Array<{ keyword?: string }>),
  ]) {
    const t = kw.keyword?.trim()
    if (t && !coreSet.has(t)) s.add(t)
  }
  return Array.from(s)
}

function derivePainScenarioKeywords(strategy: Record<string, unknown>): string[] {
  const s = new Set<string>()
  const ks = (strategy.keyword_strategy || {}) as Record<string, unknown>
  for (const kw of [
    ...((ks.scenario_keywords || []) as Array<{ keyword?: string }>),
    ...((ks.pain_advantage_keywords || []) as Array<{ keyword?: string }>),
  ]) {
    if (kw.keyword?.trim()) s.add(kw.keyword.trim())
  }
  return Array.from(s)
}

function mergeKeywordLists(...lists: string[][]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const list of lists) {
    for (const raw of list) {
      const keyword = raw.trim()
      const key = keyword.replace(/\s+/g, "").toLowerCase()
      if (!keyword || seen.has(key)) continue
      seen.add(key)
      result.push(keyword)
    }
  }
  return result
}

function normalizeKeywordInput(value: unknown): string[] {
  const rawItems = Array.isArray(value)
    ? value.map(item => String(item))
    : typeof value === "string"
      ? value.split(/[\n\r,，;；、]+/)
      : []
  return mergeKeywordLists(rawItems).slice(0, 120)
}

function enrichAllocation(
  category: Allocation["category"],
  count: number,
  strategy: Record<string, unknown>,
  coreKeywordsInput: string[],
  painScenarioKeywordsInput: string[],
  customKeywordMode: boolean,
): Allocation {
  const profile = (strategy.profile || {}) as Record<string, unknown>
  const weaknesses = (profile.weaknesses as string[]) || []
  const derivedCore = coreKeywordsInput.length > 0 ? coreKeywordsInput : deriveCoreKeywords(strategy)
  const coreSet = new Set(derivedCore)
  const secondaryKws = customKeywordMode
    ? mergeKeywordLists(coreKeywordsInput, deriveSecondaryKeywords(strategy, coreSet))
    : deriveSecondaryKeywords(strategy, coreSet)
  const painScenarioKws = painScenarioKeywordsInput.length > 0
    ? painScenarioKeywordsInput
    : derivePainScenarioKeywords(strategy)

  if (category === "weakness_spin") {
    return { category, count, keywords: [], weaknesses }
  }
  if (category === "core_keywords") {
    return { category, count, keywords: derivedCore }
  }
  if (category === "secondary_keywords") {
    return { category, count, keywords: secondaryKws }
  }
  return { category, count, keywords: painScenarioKws }
}

function normalizeAllocationOverrides(
  value: unknown,
  strategy: Record<string, unknown>,
  coreKeywordsInput: string[],
  painScenarioKeywordsInput: string[],
  customKeywordMode: boolean,
  maxCount: number,
): Allocation[] {
  if (!Array.isArray(value) || maxCount <= 0) return []
  const categories = new Set<Allocation["category"]>([
    "weakness_spin",
    "core_keywords",
    "secondary_keywords",
    "pain_scenario",
  ])
  const merged = new Map<Allocation["category"], number>()
  let remaining = maxCount

  for (const item of value) {
    if (!item || typeof item !== "object" || remaining <= 0) continue
    const raw = item as { category?: unknown; count?: unknown }
    const category = raw.category
    if (typeof category !== "string" || !categories.has(category as Allocation["category"])) continue
    const count = Math.min(
      Math.max(0, Math.round(Number(raw.count) || 0)),
      remaining
    )
    if (count <= 0) continue
    const key = category as Allocation["category"]
    merged.set(key, (merged.get(key) || 0) + count)
    remaining -= count
  }

  return Array.from(merged.entries()).map(([category, count]) =>
    enrichAllocation(category, count, strategy, coreKeywordsInput, painScenarioKeywordsInput, customKeywordMode)
  )
}

function calculateAllocations(
  strategy: Record<string, unknown>,
  coreKeywordsInput: string[],
  painScenarioKeywordsInput: string[],
  totalCount: number,
  cfg: {
    weaknessesPerWeakness: number
    allocationMode: "ratio" | "custom"
    coreRatio: number
    secondaryRatio: number
    coreCount: number
    secondaryCount: number
    painScenarioCount: number
  },
  customKeywordMode = false,
): { allocations: Allocation[]; warnings: string[] } {
  const warnings: string[] = []
  const profile = (strategy.profile || {}) as Record<string, unknown>
  const weaknesses = (profile.weaknesses as string[]) || []

  // 1. Weakness allocation
  const rawWeaknessTotal = weaknesses.length * cfg.weaknessesPerWeakness
  let weaknessCount = Math.min(rawWeaknessTotal, totalCount)

  if (weaknesses.length > 0 && rawWeaknessTotal > totalCount) {
    const perItem = Math.max(1, Math.floor(totalCount / weaknesses.length))
    weaknessCount = perItem * weaknesses.length
    warnings.push(
      `劣势问题数量 (${rawWeaknessTotal}条) 超过总数，已自动调整为每劣势 ${perItem} 个问题`
    )
  }

  // 2. Remaining for keywords
  const remaining = totalCount - weaknessCount
  const coreMinTotal = Math.ceil(totalCount * 0.30)

  // 3. Calculate allocations
  let coreAlloc = 0
  let secondaryAlloc = 0
  let painScenarioAlloc = 0

  if (cfg.allocationMode === "custom") {
    coreAlloc = Math.min(Math.max(cfg.coreCount, 0), remaining)
    secondaryAlloc = Math.min(Math.max(cfg.secondaryCount, 0), remaining)
    painScenarioAlloc = Math.min(Math.max(cfg.painScenarioCount, 0), remaining)

    const customTotal = coreAlloc + secondaryAlloc + painScenarioAlloc
    if (customTotal !== remaining) {
      if (customTotal > remaining) {
        warnings.push(`关键词自定义数量 (${customTotal}条) 超过剩余关键词空间 (${remaining}条)，已按比例压缩`)
        const ratio = remaining > 0 ? remaining / customTotal : 0
        coreAlloc = Math.floor(coreAlloc * ratio)
        secondaryAlloc = Math.floor(secondaryAlloc * ratio)
        painScenarioAlloc = remaining - coreAlloc - secondaryAlloc
      } else {
        warnings.push(`关键词自定义数量 (${customTotal}条) 少于剩余关键词空间 (${remaining}条)，将只生成 ${customTotal} 条关键词问题`)
      }
    }
  } else {
    coreAlloc = Math.max(Math.floor(remaining * cfg.coreRatio), Math.min(coreMinTotal, remaining))
    secondaryAlloc = Math.floor(remaining * cfg.secondaryRatio)
    painScenarioAlloc = remaining - coreAlloc - secondaryAlloc
  }

  if (painScenarioAlloc < 0) {
    secondaryAlloc = Math.max(0, remaining - coreAlloc)
    painScenarioAlloc = remaining - coreAlloc - secondaryAlloc
    if (secondaryAlloc === 0 && painScenarioAlloc === 0) {
      warnings.push("关键词分类空间不足，请增加问题总数或减少劣势问题数")
    }
    if (painScenarioAlloc < 0) {
      painScenarioAlloc = 0
      warnings.push("核心关键词和次关键词已占满所有关键词空间，痛点/场景无分配")
    }
  }

  if (weaknessCount > totalCount * 0.6) {
    warnings.push("劣势问题超过总数的60%，其他类别空间有限")
  }

  if (cfg.allocationMode !== "custom" && coreAlloc < coreMinTotal && remaining > 0) {
    warnings.push(`核心关键词问题 (${coreAlloc}条) 低于总量的30%最低要求 (${coreMinTotal}条)`)
  }

  // Derive keywords
  const derivedCore = coreKeywordsInput.length > 0 ? coreKeywordsInput : deriveCoreKeywords(strategy)
  const coreSet = new Set(derivedCore)
  const secondaryKws = customKeywordMode
    ? mergeKeywordLists(coreKeywordsInput, deriveSecondaryKeywords(strategy, coreSet))
    : deriveSecondaryKeywords(strategy, coreSet)
  const painScenarioKws = painScenarioKeywordsInput.length > 0
    ? painScenarioKeywordsInput
    : derivePainScenarioKeywords(strategy)

  const allocations: Allocation[] = [
    {
      category: "weakness_spin",
      count: weaknessCount,
      keywords: [],
      weaknesses,
    },
    {
      category: "core_keywords",
      count: coreAlloc,
      keywords: derivedCore,
    },
    {
      category: "secondary_keywords",
      count: secondaryAlloc,
      keywords: secondaryKws,
    },
    {
      category: "pain_scenario",
      count: painScenarioAlloc,
      keywords: painScenarioKws,
    },
  ]

  return { allocations, warnings }
}

// ==================== LLM Helpers ====================

async function callLlm(
  url: string, apiKey: string, model: string,
  system: string, user: string,
  maxTokens: number, label: string,
  timeoutSec: number,
): Promise<string> {
  return openaiCompatChat({
    url,
    apiKey,
    model,
    system,
    user,
    temperature: 0.3,
    maxTokens,
    jsonMode: true,
    label,
    timeoutSec,
  })
}

function remainingBudgetMs(deadlineMs: number): number {
  return Math.max(0, deadlineMs - Date.now())
}

function nextCallTimeoutSec(modelTimeoutSec: number, deadlineMs: number): number {
  const budgetSec = Math.floor((remainingBudgetMs(deadlineMs) - REQUEST_WRAP_UP_MS) / 1000)
  return Math.max(10, Math.min(modelTimeoutSec, MAX_LLM_CALL_TIMEOUT_SEC, budgetSec))
}

function isFatalLlmError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /API Key|HTTP 401|unauthorized|无权限/i.test(message)
}

function friendlyLlmError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/timeout|timed out|超时|abort/i.test(message)) return "模型响应超时"
  if (/fetch|连接失败|network/i.test(message)) return "模型连接失败"
  return message.slice(0, 120) || "模型调用失败"
}

function cleanAndParse(raw: string): unknown {
  return parseJsonLoose(raw)
}

function estimateTokensPerQuestion(): number {
  return 220
}

function text(value: unknown, fallback = ""): string {
  const result =
    typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : ""
  return result || fallback
}

function questionKey(question: string): string {
  return question.replace(/\s+/g, "").toLowerCase()
}

function buildAvoidQuestionsInstruction(questions: string[]): string {
  const list = questions
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 80)

  if (list.length === 0) return ""

  return [
    "【避免重复】",
    "下面这些问题已经生成过，本批不要重复或近似改写：",
    ...list.map((question, index) => `${index + 1}. ${question}`),
  ].join("\n")
}

function normalizeQuestion(value: unknown, category: string): Omit<QuestionItem, "id"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  const question = text(data.question)
  if (!question) return null

  return {
    layer: data.layer === "第二层" ? "第二层" : "第一层",
    category: text(data.category, category),
    difficulty: text(data.difficulty, "中"),
    keyword: text(data.keyword),
    question,
    intent: text(data.intent, "了解并解决相关决策问题"),
    content_angle: text(data.content_angle, "围绕用户问题提供事实、对比与行动建议"),
  }
}

function extractArray(raw: string, key: string): unknown[] | null {
  const parsed = cleanAndParse(raw)
  if (Array.isArray(parsed)) return parsed
  if (!parsed || typeof parsed !== "object") return null
  const value = (parsed as Record<string, unknown>)[key]
  return Array.isArray(value) ? value : null
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  )
  return results
}

const CATEGORY_LABELS: Record<string, string> = {
  weakness_spin: "劣势积极转化",
  core_keywords: "核心关键词问题",
  secondary_keywords: "次要关键词问题",
  pain_scenario: "痛点/场景关键词问题",
}

const EXTRA_INSTRUCTIONS: Record<string, string> = {
  core_keywords:
    "这些是最核心的行业关键词。问题不能出现品牌名/公司名/具体产品名，而是从用户对这类需求的真实困惑出发，" +
    "围绕用户的选择标准、使用场景、决策顾虑来生成问题。",
  secondary_keywords:
    "这些是差异化关键词。问题不能出现品牌名/公司名/具体产品名，而是模拟用户在做选择时的对比思虑、" +
    "对不同方案的纠结、对性价比的考量等真实提问。",
  pain_scenario:
    "这些是痛点驱动和场景驱动的关键词，问题应模拟客户在实际使用场景中的真实困惑和需求，" +
    "从解决问题和满足场景需求的角度切入。",
}

// ==================== Per-Category Generator ====================

async function generateCategoryQuestions(
  url: string, apiKey: string, model: string,
  allocation: Allocation,
  strategy: Record<string, unknown>,
  layer2Ratio: number,
  startIdOffset: number,
  modelTimeoutSec: number,
  deadlineMs: number,
  avoidQuestions: string[],
): Promise<{ questions: Array<Omit<QuestionItem, "id">>; warnings: string[] }> {
  const allQuestions: Array<Omit<QuestionItem, "id">> = []
  const warnings: string[] = []
  const avoidInstruction = buildAvoidQuestionsInstruction(avoidQuestions)

  if (allocation.count === 0) {
    return { questions: [], warnings: [] }
  }

  const batchCount = Math.ceil(allocation.count / BATCH_SIZE)

  const batchIndexes = Array.from({ length: batchCount }, (_, index) => index)
  const batchResults = await mapWithConcurrency(
    batchIndexes,
    BATCH_CONCURRENCY,
    async batch => {
      const startId = startIdOffset + batch * BATCH_SIZE + 1
      const thisBatchSize = Math.min(BATCH_SIZE, allocation.count - batch * BATCH_SIZE)
      const categoryLabel = CATEGORY_LABELS[allocation.category] || allocation.category

      if (remainingBudgetMs(deadlineMs) < MIN_CALL_BUDGET_MS) {
        warnings.push(`${categoryLabel}批次 ${batch + 1} 因请求时间接近网关限制，已跳过并保留已生成结果`)
        return []
      }

      const basePrompt = allocation.category === "weakness_spin"
        ? buildWeaknessSpinPrompt(
            strategy, thisBatchSize, startId, layer2Ratio,
            allocation.weaknesses || [],
          )
        : buildKeywordPrompt(
            strategy,
            categoryLabel,
            categoryLabel,
            thisBatchSize,
            startId,
            layer2Ratio,
            allocation.keywords,
            EXTRA_INSTRUCTIONS[allocation.category] || "",
          )
      const prompt = avoidInstruction ? `${basePrompt}\n\n${avoidInstruction}` : basePrompt
      const baseSystem = batch === 0
        ? SYSTEM_TEMPLATE
        : `${SYSTEM_TEMPLATE}\n\n这是第 ${batch + 1}/${batchCount} 批，请生成新的疑问句，id 从 ${startId} 开始。`
      const tokensPerBatch = Math.min(8192, thisBatchSize * estimateTokensPerQuestion() + 1536)
      const minimumAcceptable = Math.max(1, Math.ceil(thisBatchSize * 0.6))
      let bestResult: Array<Omit<QuestionItem, "id">> = []

      for (let attempt = 0; attempt < MAX_STRUCTURED_ATTEMPTS; attempt++) {
        if (remainingBudgetMs(deadlineMs) < MIN_CALL_BUDGET_MS) {
          warnings.push(`${categoryLabel}批次 ${batch + 1} 因请求时间接近网关限制，已停止重试`)
          break
        }

        const retryInstruction = attempt === 0
          ? ""
          : `\n\n上一次输出无法解析或字段不完整。这次必须只输出完整 JSON，question_strategy 必须是数组，并生成 ${thisBatchSize} 条有效问题。不要使用 Markdown 代码块。`
        let raw = ""
        try {
          const callTimeoutSec = nextCallTimeoutSec(modelTimeoutSec, deadlineMs)
          raw = await callLlm(
            url,
            apiKey,
            model,
            `${baseSystem}${retryInstruction}`,
            prompt,
            tokensPerBatch,
            `GEO问题-${allocation.category}-批次${batch + 1}-尝试${attempt + 1}`,
            callTimeoutSec,
          )
        } catch (error) {
          if (isFatalLlmError(error)) throw error
          if (attempt === MAX_STRUCTURED_ATTEMPTS - 1) {
            if (bestResult.length > 0) {
              warnings.push(`${categoryLabel}批次 ${batch + 1} 最后一次失败，已保留 ${bestResult.length}/${thisBatchSize} 条。原因：${friendlyLlmError(error)}`)
              return bestResult.slice(0, thisBatchSize)
            }
            warnings.push(`${categoryLabel}批次 ${batch + 1} 生成失败，已跳过。原因：${friendlyLlmError(error)}`)
            return []
          }
          console.warn(
            `[geo-questions] ${categoryLabel}批次 ${batch + 1} 第 ${attempt + 1} 次请求失败，准备重试：`,
            error
          )
          continue
        }
        const items = extractArray(raw, "question_strategy")
        const normalized = (items || [])
          .map(item => normalizeQuestion(item, categoryLabel))
          .filter((item): item is Omit<QuestionItem, "id"> => item !== null)

        if (normalized.length > bestResult.length) bestResult = normalized
        if (normalized.length >= minimumAcceptable) {
          if (normalized.length < thisBatchSize) warnings.push(
            `${categoryLabel}批次 ${batch + 1} 计划 ${thisBatchSize} 条，实际返回 ${normalized.length} 条`
          )
          return normalized.slice(0, thisBatchSize)
        }

        console.warn(
          `[geo-questions] ${categoryLabel}批次 ${batch + 1} 第 ${attempt + 1} 次仅得到 ${normalized.length}/${thisBatchSize} 条有效问题`
        )
      }

      if (bestResult.length > 0) {
        warnings.push(
          `${categoryLabel}批次 ${batch + 1} 自动重试后仍只生成 ${bestResult.length}/${thisBatchSize} 条`
        )
        return bestResult.slice(0, thisBatchSize)
      }

      warnings.push(`${categoryLabel}批次 ${batch + 1} 返回格式异常，自动重试后已跳过`)
      return []
    }
  )

  const seen = new Set(avoidQuestions.map(questionKey))
  for (const batchQuestions of batchResults) {
    for (const question of batchQuestions) {
      const key = questionKey(question.question)
      if (!key || seen.has(key)) continue
      seen.add(key)
      allQuestions.push(question)
    }
  }

  if (allQuestions.length < allocation.count) {
    warnings.push(
      `${CATEGORY_LABELS[allocation.category]}: 仅生成 ${allQuestions.length}/${allocation.count} 条问题`
    )
  }

  return { questions: allQuestions, warnings }
}

// ==================== Handler ====================

async function handler(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      strategy, totalCount = 40, layer2Ratio = 0.35,
      categoryConfig, coreKeywords = [], customKeywords = [],
      painScenarioKeywords = [], customPainScenarios = [],
      questionModelProvider = DEFAULT_QUESTION_MODEL_PROVIDER,
      questionModel,
      allocationOverrides = [], avoidQuestions = [],
    } = body

    if (!strategy) {
      return NextResponse.json({ error: "请提供策略方案" }, { status: 400 })
    }

    const selectedProvider = normalizeQuestionModelProvider(questionModelProvider)
    const selectedModel = normalizeQuestionModel(selectedProvider, questionModel)
    const providerLabel = QUESTION_MODEL_PROVIDER_LABELS[selectedProvider]
    const aiConfig = await getAiProviderRuntimeSetting(selectedProvider)
    const url = buildAiChatUrl(aiConfig)
    const ratioInput = Number(layer2Ratio)
    const countInput = Number(totalCount)
    const ratio = Math.min(Math.max(Number.isFinite(ratioInput) ? ratioInput : 0.35, 0.15), 0.45)
    const requestedCount = Math.min(Math.max(Number.isFinite(countInput) ? Math.round(countInput) : 40, 10), 600)
    const count = Math.min(requestedCount, MAX_SINGLE_RUN_QUESTION_COUNT)
    const modelTimeoutSec = Math.min(aiConfig.timeout || 300, MAX_LLM_CALL_TIMEOUT_SEC)
    const deadlineMs = Date.now() + REQUEST_BUDGET_MS
    const avoidQuestionTexts = Array.isArray(avoidQuestions)
      ? avoidQuestions.map(item => String(item).trim()).filter(Boolean).slice(0, 300)
      : []
    const normalizedCustomKeywords = normalizeKeywordInput(customKeywords)
    const normalizedCoreKeywords = normalizedCustomKeywords.length > 0
      ? normalizedCustomKeywords
      : normalizeKeywordInput(coreKeywords)
    const normalizedCustomPainScenarios = normalizeKeywordInput(customPainScenarios)
    const normalizedPainScenarioKeywords = normalizedCustomPainScenarios.length > 0
      ? normalizedCustomPainScenarios
      : normalizeKeywordInput(painScenarioKeywords)
    const customKeywordMode = normalizedCustomKeywords.length > 0
    const overrideAllocations = normalizeAllocationOverrides(
      allocationOverrides,
      strategy,
      normalizedCoreKeywords,
      normalizedPainScenarioKeywords,
      customKeywordMode,
      count,
    )

    if (!aiConfig.apiKey) {
      return NextResponse.json({ error: `后台未配置${providerLabel} API Key，请联系管理员在后台管理页配置` }, { status: 400 })
    }

    const countWarnings = requestedCount > count
      ? [`单次疑问句生成已按稳定上限调整为 ${count} 条；如需更多，建议分批生成。`]
      : []
    const keywordWarnings = normalizedCustomKeywords.length > 0
      ? [`已使用 ${normalizedCustomKeywords.length} 个自定义关键词作为疑问句生成关键词池。`]
      : []
    const painScenarioWarnings = normalizedCustomPainScenarios.length > 0
      ? [`已使用 ${normalizedCustomPainScenarios.length} 个自定义痛点/场景作为疑问句生成素材。`]
      : []
    const modelWarnings = [`本次疑问句生成使用 ${providerLabel} · ${selectedModel}。`]

    const cfg = {
      weaknessesPerWeakness: Math.min(Math.max(
        categoryConfig?.weaknessesPerWeakness ?? 10, 5), 30),
      allocationMode: categoryConfig?.allocationMode === "custom" ? "custom" as const : "ratio" as const,
      coreRatio: Math.min(Math.max(
        categoryConfig?.coreRatio ?? 0.30, 0.30), 0.70),
      secondaryRatio: Math.min(Math.max(
        categoryConfig?.secondaryRatio ?? 0.35, 0.05), 0.50),
      coreCount: Math.min(Math.max(Number(categoryConfig?.coreCount ?? 0) || 0, 0), MAX_SINGLE_RUN_QUESTION_COUNT),
      secondaryCount: Math.min(Math.max(Number(categoryConfig?.secondaryCount ?? 0) || 0, 0), MAX_SINGLE_RUN_QUESTION_COUNT),
      painScenarioCount: Math.min(Math.max(Number(categoryConfig?.painScenarioCount ?? 0) || 0, 0), MAX_SINGLE_RUN_QUESTION_COUNT),
    }

    // 1. Calculate allocations
    const { allocations, warnings: allocWarnings } = overrideAllocations.length > 0
      ? { allocations: overrideAllocations, warnings: [] }
      : calculateAllocations(
          strategy, normalizedCoreKeywords, normalizedPainScenarioKeywords, count, cfg, customKeywordMode,
        )

    // 2. Generate categories concurrently with bounded LLM pressure.
    const allQuestions: Array<Omit<QuestionItem, "id">> = []
    const allWarnings = [...modelWarnings, ...countWarnings, ...keywordWarnings, ...painScenarioWarnings, ...allocWarnings]
    let offset = 0
    const activeAllocations = allocations
      .map((alloc) => {
        const startIdOffset = offset
        offset += alloc.count
        return { alloc, startIdOffset }
      })
      .filter(item => item.alloc.count > 0)

    const categoryResults = await mapWithConcurrency(
      activeAllocations,
      CATEGORY_CONCURRENCY,
      item => generateCategoryQuestions(
        url,
        aiConfig.apiKey,
        selectedModel,
        item.alloc,
        strategy,
        ratio,
        item.startIdOffset,
        modelTimeoutSec,
        deadlineMs,
        avoidQuestionTexts,
      )
    )
    for (const result of categoryResults) {
      allQuestions.push(...result.questions)
      allWarnings.push(...result.warnings)
    }

    const seenQuestions = new Set<string>()
    const uniqueQuestions = allQuestions.filter(question => {
      const key = questionKey(question.question)
      if (!key || seenQuestions.has(key)) return false
      seenQuestions.add(key)
      return true
    })
    if (uniqueQuestions.length < allQuestions.length) {
      allWarnings.push(`已自动移除 ${allQuestions.length - uniqueQuestions.length} 条重复疑问句`)
    }

    // 3. Re-index IDs to ensure sequential order
    const reindexed: QuestionItem[] = uniqueQuestions.map((q, i) => ({
      ...q,
      id: String(i + 1),
    }))

    if (reindexed.length === 0) {
      return NextResponse.json(
        { error: "模型没有生成可用的疑问句，系统自动重试后仍未恢复，请重新生成。" },
        { status: 422 }
      )
    }

    return NextResponse.json({
      question_strategy: reindexed,
      warnings: allWarnings.length > 0 ? Array.from(new Set(allWarnings)) : undefined,
    })
  } catch (error) {
    console.error("[geo-questions]", error)
    const message = error instanceof Error ? error.message : "未知错误"
    if (/API Key|HTTP 401|unauthorized/i.test(message)) {
      return NextResponse.json({ error: "疑问句生成模型 API Key 无效或无权限" }, { status: 401 })
    }
    if (/InvalidEndpointOrModel|does not exist|model.*not.*found|模型不存在|无此模型/i.test(message)) {
      return NextResponse.json({ error: "疑问句生成模型不存在或当前账号无权限，请切换到已开通的模型后重试。" }, { status: 400 })
    }
    if (/timeout|timed out|超时|abort/i.test(message)) {
      return NextResponse.json({ error: "疑问句生成时间过长，请减少生成数量后重试，或增加后台模型超时时间" }, { status: 504 })
    }
    if (/格式异常|无法解析|JSON/i.test(message)) {
      return NextResponse.json({ error: "模型返回的数据格式不完整，系统自动重试后仍未恢复，请重新生成。" }, { status: 422 })
    }
    if (/fetch|连接失败|network/i.test(message)) {
      return NextResponse.json({ error: "疑问句生成模型连接失败，请检查网络或后台接口配置" }, { status: 502 })
    }
    return NextResponse.json({ error: `疑问句生成失败：${message}` }, { status: 500 })
  }
}

export const POST = handler
