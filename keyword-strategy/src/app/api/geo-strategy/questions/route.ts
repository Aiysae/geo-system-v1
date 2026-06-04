import { NextRequest, NextResponse } from "next/server"
import { openaiCompatChat } from "@/lib/llm/openai-compat"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

const BATCH_SIZE = 80

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
- 每条问题包含 id、layer、category、difficulty、keyword、question、intent、content_angle、suggested_channel
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
      "content_angle": "",
      "suggested_channel": ""
    }
  ]
}`

const CALENDAR_SYSTEM = `你是一个 GEO 内容日历规划专家。基于已有的疑问句池，安排内容发布日历。

输出严格 JSON，格式：
{
  "content_calendar": [
    {
      "week": "第 1 周",
      "platform": "",
      "question": "",
      "article_title": "",
      "content_type": "",
      "geo_goal": ""
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
      "content_angle": "建议的内容角度",
      "suggested_channel": "推荐发布渠道"
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
      "content_angle": "建议的内容角度",
      "suggested_channel": "推荐发布渠道"
    }
  ]
}`
}

function buildCalendarUserPrompt(questions: unknown[], strategy: Record<string, unknown>): string {
  const sampleSize = Math.min(questions.length, 60)
  const sampled = questions.slice(0, sampleSize)

  return [
    "请基于以下策略方案和疑问句池（节选），安排至少 4 周的内容发布日历。",
    "",
    "【策略方案】",
    JSON.stringify(strategy, null, 2),
    "",
    `【疑问句池（共 ${questions.length} 条，节选前 ${sampleSize} 条）】`,
    JSON.stringify(sampled, null, 2),
    "",
    "请根据平台分工（知乎、小红书、公众号、百家号、头条号、B站专栏等）安排发布计划。",
  ].join("\n")
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

function calculateAllocations(
  strategy: Record<string, unknown>,
  coreKeywordsInput: string[],
  totalCount: number,
  cfg: { weaknessesPerWeakness: number; coreRatio: number; secondaryRatio: number },
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
  let coreAlloc = Math.max(Math.floor(remaining * cfg.coreRatio), Math.min(coreMinTotal, remaining))
  let secondaryAlloc = Math.floor(remaining * cfg.secondaryRatio)
  let painScenarioAlloc = remaining - coreAlloc - secondaryAlloc

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

  if (coreAlloc < coreMinTotal && remaining > 0) {
    warnings.push(`核心关键词问题 (${coreAlloc}条) 低于总量的30%最低要求 (${coreMinTotal}条)`)
  }

  // Derive keywords
  const derivedCore = coreKeywordsInput.length > 0 ? coreKeywordsInput : deriveCoreKeywords(strategy)
  const coreSet = new Set(derivedCore)
  const secondaryKws = deriveSecondaryKeywords(strategy, coreSet)
  const painScenarioKws = derivePainScenarioKeywords(strategy)

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
  retries = 1,
): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await openaiCompatChat({
        url,
        apiKey,
        model,
        system: attempt === 0 ? system : `${system}\n\n注意：上次输出 JSON 解析失败，请确保输出合法 JSON。`,
        user,
        temperature: 0.4,
        maxTokens,
        jsonMode: true,
        label,
      })
      return result
    } catch (err) {
      if (attempt === retries) throw err
    }
  }
  throw new Error("LLM 调用全部失败")
}

function cleanAndParse(raw: string): unknown {
  let s = raw.trim()

  const fm = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fm) s = fm[1].trim()
  else if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim()

  try { return JSON.parse(s) } catch { /* fall through */ }
  try { return JSON.parse(s.replace(/\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1")) } catch { /* fall through */ }

  const objMatch = s.match(/\{[\s\S]*\}/)
  if (objMatch) {
    const extracted = objMatch[0]
    try { return JSON.parse(extracted) } catch { /* fall through */ }
    try { return JSON.parse(extracted.replace(/\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1")) } catch { return null }
  }

  return null
}

function estimateTokensPerQuestion(): number {
  return 250
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
): Promise<{ questions: unknown[]; warnings: string[] }> {
  const allQuestions: unknown[] = []
  const warnings: string[] = []

  if (allocation.count === 0) {
    return { questions: [], warnings: [] }
  }

  const batchCount = Math.ceil(allocation.count / BATCH_SIZE)

  for (let batch = 0; batch < batchCount; batch++) {
    const startId = startIdOffset + batch * BATCH_SIZE + 1
    const thisBatchSize = Math.min(BATCH_SIZE, allocation.count - batch * BATCH_SIZE)

    let userPrompt: string

    if (allocation.category === "weakness_spin") {
      userPrompt = buildWeaknessSpinPrompt(
        strategy, thisBatchSize, startId, layer2Ratio,
        allocation.weaknesses || [],
      )
    } else {
      const label = CATEGORY_LABELS[allocation.category] || allocation.category
      const extra = EXTRA_INSTRUCTIONS[allocation.category] || ""
      userPrompt = buildKeywordPrompt(
        strategy, label, label, thisBatchSize, startId, layer2Ratio,
        allocation.keywords, extra,
      )
    }

    const system = batch === 0
      ? SYSTEM_TEMPLATE
      : `${SYSTEM_TEMPLATE}\n\n注意：这是第 ${batch + 1}/${batchCount} 批，请继续生成新的疑问句，不要与之前的重复。id 从 ${startId} 开始。`

    const tokensPerBatch = thisBatchSize * estimateTokensPerQuestion() + 2048
    const raw = await callLlm(url, apiKey, model, system, userPrompt,
      tokensPerBatch, `GEO问题-${allocation.category}-批次${batch + 1}`)

    const parsed = cleanAndParse(raw)
    if (!parsed || typeof parsed !== "object") {
      warnings.push(`${CATEGORY_LABELS[allocation.category]} 批次 ${batch + 1} 返回格式异常，已跳过`)
      continue
    }

    const batchQuestions = (parsed as Record<string, unknown>).question_strategy
    if (!Array.isArray(batchQuestions)) {
      warnings.push(`${CATEGORY_LABELS[allocation.category]} 批次 ${batch + 1} 缺少 question_strategy，已跳过`)
      continue
    }

    allQuestions.push(...batchQuestions)
  }

  if (allQuestions.length < allocation.count * 0.5) {
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
      strategy, apiConfig, totalCount = 40, layer2Ratio = 0.35,
      categoryConfig, coreKeywords = [],
    } = body

    if (!strategy) {
      return NextResponse.json({ error: "请提供策略方案" }, { status: 400 })
    }

    const baseUrl = (apiConfig?.baseUrl || "https://api.openai.com").replace(/\/+$/, "")
    const apiKey = apiConfig?.apiKey || ""
    const model = apiConfig?.model || "gpt-4o"
    const url = `${baseUrl}${apiConfig?.chatPath || "/v1/chat/completions"}`
    const ratio = Math.min(Math.max(layer2Ratio, 0.15), 0.45)
    const count = Math.min(Math.max(totalCount, 10), 600)

    if (!apiKey) {
      return NextResponse.json({ error: "API Key 未配置" }, { status: 400 })
    }

    const cfg = {
      weaknessesPerWeakness: Math.min(Math.max(
        categoryConfig?.weaknessesPerWeakness ?? 10, 5), 30),
      coreRatio: Math.min(Math.max(
        categoryConfig?.coreRatio ?? 0.30, 0.30), 0.70),
      secondaryRatio: Math.min(Math.max(
        categoryConfig?.secondaryRatio ?? 0.35, 0.05), 0.50),
    }

    // 1. Calculate allocations
    const { allocations, warnings: allocWarnings } = calculateAllocations(
      strategy, coreKeywords, count, cfg,
    )

    // 2. Generate per category sequentially (ensures sequential IDs)
    const allQuestions: unknown[] = []
    let currentId = 0
    const allWarnings = [...allocWarnings]

    for (const alloc of allocations) {
      if (alloc.count === 0) continue
      const result = await generateCategoryQuestions(
        url, apiKey, model, alloc, strategy, ratio, currentId,
      )
      allQuestions.push(...result.questions)
      allWarnings.push(...result.warnings)
      currentId += alloc.count
    }

    // 3. Re-index IDs to ensure sequential order
    const reindexed = allQuestions.map((q, i) => ({
      ...(q as Record<string, unknown>),
      id: String(i + 1),
    }))

    // 4. Generate content calendar
    let contentCalendar: unknown[] = []
    if (reindexed.length > 0) {
      const calendarTokens = 8192
      const calendarRaw = await callLlm(
        url, apiKey, model,
        CALENDAR_SYSTEM,
        buildCalendarUserPrompt(reindexed, strategy),
        calendarTokens,
        "GEO日历",
      )

      const calendarParsed = cleanAndParse(calendarRaw)
      if (calendarParsed && typeof calendarParsed === "object") {
        contentCalendar = ((calendarParsed as Record<string, unknown>).content_calendar as unknown[]) || []
      }
    }

    return NextResponse.json({
      question_strategy: reindexed,
      content_calendar: contentCalendar,
      warnings: allWarnings.length > 0 ? allWarnings : undefined,
    })
  } catch (error) {
    console.error("[geo-questions]", error)
    const message = error instanceof Error ? error.message : "未知错误"
    if (message.includes("API Key")) return NextResponse.json({ error: "API Key 无效或无权限" }, { status: 401 })
    if (message.includes("timeout")) return NextResponse.json({ error: "模型响应超时，请增加超时时间后重试" }, { status: 504 })
    return NextResponse.json({ error: `疑问句生成失败: ${message}` }, { status: 500 })
  }
}

export const POST = handler
