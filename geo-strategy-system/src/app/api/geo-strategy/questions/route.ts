import { NextRequest, NextResponse } from "next/server"
import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { attachQuestionAdvantages, extractQuestionAdvantages } from "@/lib/geo-strategy/question-advantages"
import { isInternalApiRequest } from "@/lib/internal-api"
import { openaiCompatChat } from "@/lib/llm/openai-compat"
import { parseJsonLoose } from "@/lib/score-utils"
import {
  DEFAULT_QUESTION_MODEL_PROVIDER,
  QUESTION_MODEL_PROVIDER_LABELS,
  normalizeQuestionModel,
  normalizeQuestionModelProvider,
  type GeoStrategyPlan,
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

const QUESTION_TYPES = [
  {
    name: "榜单推荐型",
    defaultStage: "探索期",
    metricPurpose: "TOP10推荐率",
    top10Eligible: true,
    brandMentionEligible: true,
    rule: "模拟还没有明确供应商、希望 AI 给出多个品牌/公司/工具/服务商/解决方案候选名单的用户。问题应天然触发列表、推荐、TOP、靠谱选择，不要诱导只推荐目标品牌。",
  },
  {
    name: "痛点解决型",
    defaultStage: "认知期",
    metricPurpose: "品牌提及率/解决方案关联度",
    top10Eligible: false,
    brandMentionEligible: true,
    rule: "从客户真实业务困难、增长瓶颈、效率、成本、获客、信任或转化问题出发提问，先问问题怎么解决，而不是先问哪家公司好。",
  },
  {
    name: "竞品对比型",
    defaultStage: "比较期",
    metricPurpose: "竞品对比/TOP10推荐率",
    top10Eligible: true,
    brandMentionEligible: true,
    rule: "模拟用户已经知道部分竞品或常见方案，正在比较差异、优劣、适合谁、替代方案、服务模式、价格带或交付方式。竞品名可自然出现，但不要硬塞。",
  },
  {
    name: "采购决策型",
    defaultStage: "决策期",
    metricPurpose: "采购决策/TOP10推荐率",
    top10Eligible: true,
    brandMentionEligible: true,
    rule: "站在即将购买或合作的老板、采购、市场负责人、运营负责人角度，围绕预算、周期、效果、服务范围、交付标准、合同风险、验收指标、ROI 生成问题。",
  },
  {
    name: "场景人群型",
    defaultStage: "探索期",
    metricPurpose: "品牌提及率/场景适配度",
    top10Eligible: false,
    brandMentionEligible: true,
    rule: "根据用户身份、行业、地区、规模、预算、发展阶段和具体使用场景生成问题，体现谁在什么情况下需要什么解决方案。",
  },
  {
    name: "品牌认知型",
    defaultStage: "认知期",
    metricPurpose: "品牌认知/品牌提及质量",
    top10Eligible: false,
    brandMentionEligible: true,
    rule: "围绕目标品牌本身生成认知类问题，可直接包含品牌名，用于检测 AI 是否知道品牌、是否能正确解释业务和优势。数量必须控制，不能让问题池都围绕品牌名。",
  },
  {
    name: "风险疑虑型",
    defaultStage: "风险确认期",
    metricPurpose: "风险疑虑/信任度/负面倾向",
    top10Eligible: false,
    brandMentionEligible: true,
    rule: "模拟用户的不信任、犹豫和风险规避心理，围绕靠谱吗、有没有坑、怎么判断、会不会无效、怎么验收、合同怎么写、哪些情况不适合等问题展开；避免攻击性、诽谤性引导。",
  },
] as const

type QuestionTypeName = typeof QUESTION_TYPES[number]["name"]
type UserStage = NonNullable<QuestionItem["userStage"]>

const QUESTION_TYPE_NAMES = QUESTION_TYPES.map(item => item.name) as QuestionTypeName[]
const QUESTION_TYPE_SET = new Set<string>(QUESTION_TYPE_NAMES)
const USER_STAGES: UserStage[] = ["认知期", "探索期", "比较期", "决策期", "风险确认期"]
const USER_STAGE_SET = new Set<string>(USER_STAGES)

const SYSTEM_TEMPLATE = `你是一个资深 GEO 疑问句生成专家。你的任务不是套固定模板，而是先理解品牌、业务主题、客户画像、行业场景、竞品和用户决策路径，再推理真实用户可能会向 ChatGPT、DeepSeek、豆包、Kimi、元宝、文心一言等 AI 搜索工具提出的问题。

核心规则：
1. 问题必须像真实用户自然提问，不要机械替换变量，不要批量同义改写。
2. 严格围绕业务背景、用户痛点、关键词、劣势、场景和竞品生成，禁止从 OCR 噪声、评分表、页码、模型名中生成问题。
3. category 只能从七类中选择：榜单推荐型、痛点解决型、竞品对比型、采购决策型、场景人群型、品牌认知型、风险疑虑型。
4. 品牌名出现比例要控制：品牌认知型可以直接出现目标品牌；其他类型只有在比较、认知核验或用户自然会这样问时才出现。不要写“这个品牌”“该品牌”“这类产品”等生硬泛指。
5. 每条问题都必须有明确意图、用户阶段、检测目的和统计标记。
6. 如果【可选优势证据】非空，matched_advantage 必须逐字选择其中最能支撑该问题回答方向的一条，不能编造、改写或留空；如果优势列表为空，matched_advantage 才能填空字符串。
7. top10Eligible 只在问题会自然触发“多个候选/推荐名单/TOP/有哪些选择”时为 true；brandMentionEligible 在答案中自然可能提及目标品牌或目标服务时为 true。
8. 输出必须是严格 JSON，不要 Markdown 代码块，不要解释文本。

每条问题必须同时兼容旧字段和新字段，包含：
id、layer、category、difficulty、keyword、question、intent、content_angle、matched_advantage、generationReason、userStage、metricPurpose、top10Eligible、brandMentionEligible。`

// ==================== Prompt Builders ====================

function listBlock(values: unknown, emptyText: string): string {
  const items = Array.isArray(values)
    ? values.map(item => String(item).trim()).filter(Boolean)
    : []
  if (items.length === 0) return emptyText
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n")
}

function formatQuestionTypeGuide(): string {
  return QUESTION_TYPES
    .map(item => [
      `【${item.name}】`,
      `默认阶段：${item.defaultStage}`,
      `默认检测目的：${item.metricPurpose}`,
      `默认 top10Eligible：${item.top10Eligible ? "true" : "false"}`,
      `默认 brandMentionEligible：${item.brandMentionEligible ? "true" : "false"}`,
      `推理规则：${item.rule}`,
    ].join("\n"))
    .join("\n\n")
}

function allocateTypeMix(
  count: number,
  sourceCategory: Allocation["category"],
  layer2Ratio: number,
): Array<{ name: QuestionTypeName; count: number }> {
  const weights = new Map<QuestionTypeName, number>([
    ["榜单推荐型", 16],
    ["痛点解决型", 22],
    ["竞品对比型", 14],
    ["采购决策型", 18],
    ["场景人群型", 16],
    ["品牌认知型", 6],
    ["风险疑虑型", 8],
  ])

  if (sourceCategory === "weakness_spin") {
    weights.set("痛点解决型", 24)
    weights.set("风险疑虑型", 20)
    weights.set("采购决策型", 18)
    weights.set("品牌认知型", 4)
  } else if (sourceCategory === "pain_scenario") {
    weights.set("痛点解决型", 26)
    weights.set("场景人群型", 24)
    weights.set("采购决策型", 16)
    weights.set("品牌认知型", 4)
  } else if (sourceCategory === "secondary_keywords") {
    weights.set("竞品对比型", 22)
    weights.set("采购决策型", 20)
    weights.set("风险疑虑型", 10)
    weights.set("品牌认知型", 5)
  }

  const layer2Weight = Math.min(Math.max(layer2Ratio, 0.15), 0.45)
  weights.set("竞品对比型", Math.round((weights.get("竞品对比型") || 0) * (0.8 + layer2Weight)))
  weights.set("采购决策型", Math.round((weights.get("采购决策型") || 0) * (0.8 + layer2Weight)))
  weights.set("风险疑虑型", Math.round((weights.get("风险疑虑型") || 0) * (0.8 + layer2Weight)))

  const brandCap = Math.max(count >= 12 ? 1 : 0, Math.min(3, Math.floor(count * 0.10)))
  const totalWeight = Array.from(weights.values()).reduce((sum, value) => sum + value, 0)
  const raw = QUESTION_TYPE_NAMES.map(name => {
    const expected = count * ((weights.get(name) || 0) / totalWeight)
    const cappedExpected = name === "品牌认知型" ? Math.min(expected, brandCap) : expected
    return { name, expected: cappedExpected, count: Math.floor(cappedExpected) }
  })
  let allocated = raw.reduce((sum, item) => sum + item.count, 0)
  const byRemainder = [...raw].sort((a, b) => (b.expected - b.count) - (a.expected - a.count))
  for (const item of byRemainder) {
    if (allocated >= count) break
    if (item.name === "品牌认知型" && item.count >= brandCap) continue
    item.count += 1
    allocated += 1
  }
  for (const item of byRemainder) {
    if (allocated >= count) break
    item.count += 1
    allocated += 1
  }

  return byRemainder
    .filter(item => item.count > 0)
    .sort((a, b) => QUESTION_TYPE_NAMES.indexOf(a.name) - QUESTION_TYPE_NAMES.indexOf(b.name))
    .map(({ name, count }) => ({ name, count }))
}

function formatTypeMix(mix: Array<{ name: QuestionTypeName; count: number }>): string {
  return mix.map(item => `- ${item.name}: ${item.count} 条`).join("\n")
}

function buildReasonedQuestionPrompt(
  strategy: Record<string, unknown>,
  allocation: Allocation,
  sourceLabel: string,
  count: number,
  startId: number,
  layer2Ratio: number,
): string {
  const profile = (strategy.profile || {}) as Record<string, unknown>
  const advantages = extractQuestionAdvantages(strategy as unknown as GeoStrategyPlan)
  const materialList = allocation.category === "weakness_spin"
    ? listBlock(allocation.weaknesses || profile.weaknesses, "（暂无明确劣势，请结合业务背景和风险疑虑生成）")
    : listBlock(allocation.keywords, "（暂无指定关键词，请结合业务背景、痛点和场景推理生成）")
  const advantageList = advantages.length > 0
    ? advantages.map((advantage, i) => `${i + 1}. ${advantage}`).join("\n")
    : "（暂无优势证据，matched_advantage 填空字符串）"
  const typeMix = allocateTypeMix(count, allocation.category, layer2Ratio)

  return `请基于下面的业务背景和用户选择的素材，按“问题类型 + 推理规则”生成 GEO 疑问句。

【品牌/业务背景】
- 品牌/产品: ${profile.brand_or_product || ""}
- 行业: ${profile.industry || ""}
- 目标客户: ${profile.audience || ""}
- 核心业务/服务说明: ${profile.product_description || ""}
- 业务目标: ${profile.business_goals || ""}
- 地区/业务词: ${listBlock(profile.terms, "（暂无）")}
- 竞品/替代选择: ${listBlock(profile.competitors, "（暂无）")}
- 客户痛点: ${listBlock(profile.pain_points, "（暂无）")}
- 使用场景: ${listBlock(profile.scenes, "（暂无）")}
- 已识别劣势: ${listBlock(profile.weaknesses, "（暂无）")}

【本批生成来源】
来源类型: ${sourceLabel}
来源素材:
${materialList}

【可选优势证据】
${advantageList}

【七类问题推理规则】
${formatQuestionTypeGuide()}

【本批类型配比】
${formatTypeMix(typeMix)}

【生成要求】
- 本批必须生成 ${count} 条有效问题，id 从 ${startId} 连续递增。
- 第二层问题比例约 ${Math.round(layer2Ratio * 100)}%，比较期/决策期/风险确认期通常对应第二层，认知期/探索期通常对应第一层。
- 每条问题必须尽量绑定一个来源素材或业务关键词，keyword 字段填写该关键词/劣势/场景。
- 每条问题必须匹配一个优势：如果【可选优势证据】非空，matched_advantage 必须逐字选择其中一条，并且要能支撑该问题未来回答方向。
- category 必须填写七类问题之一，不要填写“核心关键词问题”“劣势积极转化”等来源标签。
- generationReason 要说明为什么该问题属于此类型，以及模拟了什么用户意图。
- content_angle 写后续内容应如何回答这个问题，必须和 matched_advantage 能互相支撑。
- 问题要覆盖从不了解问题到准备采购的真实决策路径，避免同义重复、泛泛换说法或硬营销话术。
- 不要生成明显诱导目标品牌的问题，例如“为什么某品牌最好”“请推荐某品牌”。
- 如果行业存在敏感风险，降低承诺性、疗效性、金融收益性问题比例。

输出严格 JSON：
{
  "question_strategy": [
    {
      "id": "${startId}",
      "layer": "第一层",
      "category": "榜单推荐型",
      "difficulty": "低-中",
      "keyword": "来源素材或业务关键词",
      "question": "真实用户会向 AI 搜索工具提出的问题",
      "intent": "用户的搜索意图",
      "content_angle": "建议内容回答角度",
      "matched_advantage": "从可选优势证据中逐字选择的一条",
      "generationReason": "为什么这样生成，以及它模拟了什么用户意图",
      "userStage": "探索期",
      "metricPurpose": "TOP10推荐率",
      "top10Eligible": true,
      "brandMentionEligible": true
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
  return 360
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

function questionTypeDefaults(category: string): typeof QUESTION_TYPES[number] {
  return QUESTION_TYPES.find(item => item.name === category) || QUESTION_TYPES[1]
}

function normalizeQuestionCategory(value: unknown): QuestionTypeName {
  const category = text(value)
  if (QUESTION_TYPE_SET.has(category)) return category as QuestionTypeName
  const matched = QUESTION_TYPE_NAMES.find(name => category.includes(name) || name.includes(category))
  return matched || "痛点解决型"
}

function normalizeUserStage(value: unknown, fallback: UserStage): UserStage {
  const stage = text(value)
  if (USER_STAGE_SET.has(stage)) return stage as UserStage
  if (/风险|疑虑|避坑|信任/.test(stage)) return "风险确认期"
  if (/决策|采购|购买|合作|验收|预算/.test(stage)) return "决策期"
  if (/比较|对比|竞品|替代/.test(stage)) return "比较期"
  if (/探索|推荐|选择|方案/.test(stage)) return "探索期"
  if (/认知|了解|知道/.test(stage)) return "认知期"
  return fallback
}

function layerFromStage(stage: UserStage, layer: unknown): "第一层" | "第二层" {
  if (layer === "第二层") return "第二层"
  if (layer === "第一层") return "第一层"
  return stage === "比较期" || stage === "决策期" || stage === "风险确认期" ? "第二层" : "第一层"
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value
  const raw = text(value).toLowerCase()
  if (["true", "1", "yes", "y", "是", "适合"].includes(raw)) return true
  if (["false", "0", "no", "n", "否", "不适合"].includes(raw)) return false
  return fallback
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
  const normalizedCategory = normalizeQuestionCategory(data.category || category)
  const defaults = questionTypeDefaults(normalizedCategory)
  const userStage = normalizeUserStage(data.userStage, defaults.defaultStage as UserStage)

  return {
    layer: layerFromStage(userStage, data.layer),
    category: normalizedCategory,
    difficulty: text(data.difficulty, "中"),
    keyword: text(data.keyword),
    question,
    intent: text(data.intent, "了解并解决相关决策问题"),
    content_angle: text(data.content_angle, text(data.generationReason, "围绕用户问题提供事实、对比与行动建议")),
    matched_advantage: text(data.matched_advantage),
    generationReason: text(data.generationReason, `模拟${userStage}用户围绕${normalizedCategory}提出的真实决策问题`),
    userStage,
    metricPurpose: text(data.metricPurpose, defaults.metricPurpose),
    top10Eligible: normalizeBoolean(data.top10Eligible, defaults.top10Eligible),
    brandMentionEligible: normalizeBoolean(data.brandMentionEligible, defaults.brandMentionEligible),
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

      const basePrompt = buildReasonedQuestionPrompt(
        strategy,
        allocation,
        categoryLabel,
        thisBatchSize,
        startId,
        layer2Ratio,
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
    if (!isInternalApiRequest(req, "geo-questions")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

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
    const advantages = extractQuestionAdvantages(strategy)
    const reindexed: QuestionItem[] = attachQuestionAdvantages(uniqueQuestions, advantages).map((q, i) => ({
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
