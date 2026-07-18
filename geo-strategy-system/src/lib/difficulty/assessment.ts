import "server-only"

import type {
  AnalysisSubjectType,
  DifficultyAssessmentMode,
  DifficultyAssessmentResult,
  DifficultyCommercialInput,
  DifficultyGeographicScope,
  DifficultyIndustryRiskLevel,
  DifficultyProcess,
  DifficultyStageKey,
  DifficultyStageOutput,
  ModelKey,
  PersonSubjectProfile,
} from "@/types"
import { ADAPTERS, MODEL_LABELS } from "@/lib/llm"
import { parseJsonStrict } from "@/lib/score-utils"
import {
  scoreDifficultyV2,
  type DifficultyScoringSignals,
} from "@/lib/difficulty/scoring-v2"
import {
  formatPersonSubjectContext,
  normalizeAnalysisSubjectType,
  normalizePersonSubjectProfile,
} from "@/lib/analysis-subject"

export const DIFFICULTY_MODEL_ORDER: ModelKey[] = [
  "qwen",
  "deepseek",
  "doubao",
  "kimi",
  "ernie",
  "hunyuan",
]

export type DifficultyAssessmentInput = {
  mode: DifficultyAssessmentMode
  subjectType?: AnalysisSubjectType
  personProfile?: PersonSubjectProfile
  industry: string
  city: string
  scope: DifficultyGeographicScope
  targetBrand?: string
  website?: string
  commercial?: DifficultyCommercialInput
  penetrationEvidence?: {
    generatedAt?: string
    totalSlots?: number
    topCompetitors: string[]
    industryShare: Array<{ brand: string; count: number; ratio: number }>
  }
}

const INDUSTRY_STAGES: Array<{
  key: DifficultyStageKey
  title: string
}> = [
  { key: "research", title: "调研取样" },
  { key: "comparison", title: "品牌/渠道对比" },
  { key: "scoring", title: "指标审计" },
  { key: "review", title: "一致性复核" },
  { key: "report", title: "生成报告" },
]

const BRAND_STAGES: Array<{
  key: DifficultyStageKey
  title: string
}> = [
  { key: "research", title: "行业调研" },
  { key: "comparison", title: "品牌现状识别" },
  { key: "scoring", title: "竞品指标审计" },
  { key: "review", title: "品牌难度复核" },
  { key: "report", title: "突破路径报告" },
]

export type DifficultyStageContext = {
  mode: DifficultyAssessmentMode
  subjectType: AnalysisSubjectType
  personProfile?: PersonSubjectProfile
  industry: string
  city: string
  scope: DifficultyGeographicScope
  target: string
  targetBrand?: string
  website?: string
  commercial?: DifficultyCommercialInput
  penetrationEvidence?: DifficultyAssessmentInput["penetrationEvidence"]
  research?: Record<string, unknown>
  comparison?: Record<string, unknown>
  scoring?: Record<string, unknown>
  review?: Record<string, unknown>
  process: Partial<DifficultyProcess>
}

function text(value: unknown, fallback = ""): string {
  const result = String(value ?? "").trim()
  return result || fallback
}

function optionalPositive(value: unknown): number | undefined {
  if (value === "" || value === null || value === undefined) return undefined
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function normalizeRiskLevel(value: unknown): DifficultyIndustryRiskLevel {
  if (
    value === "standard"
    || value === "high_trust"
    || value === "regulated"
    || value === "strict"
  ) {
    return value
  }
  return "auto"
}

function normalizeScope(value: unknown, region: string): DifficultyGeographicScope {
  if (value === "city" || value === "province" || value === "region" || value === "national") {
    return value
  }
  if (/全国|全国性|全中国|中国大陆/u.test(region)) return "national"
  if (/华东|华南|华北|华中|西南|西北|东北|长三角|珠三角|京津冀|多省|跨省/u.test(region)) return "region"
  if (/省|自治区/u.test(region)) return "province"
  return "city"
}

export function normalizeDifficultyInput(value: unknown): DifficultyAssessmentInput {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const mode: DifficultyAssessmentMode = source.mode === "brand" ? "brand" : "industry"
  const subjectType = normalizeAnalysisSubjectType(source.subjectType)
  const personProfile = subjectType === "person"
    ? normalizePersonSubjectProfile(source.personProfile)
    : undefined
  const industry = text(source.industry)
  const city = text(source.region ?? source.city, "全国")
  const scope = normalizeScope(source.scope, city)
  const targetBrand = text(source.targetBrand ?? source.brandName)
  const website = text(source.website ?? source.brandWebsite)
  const rawCommercial = source.commercial && typeof source.commercial === "object"
    ? source.commercial as Record<string, unknown>
    : source
  const commercial: DifficultyCommercialInput = {
    averageOrderValue: optionalPositive(rawCommercial.averageOrderValue),
    grossMarginRate: optionalPositive(rawCommercial.grossMarginRate),
    annualRepeatPurchases: optionalPositive(rawCommercial.annualRepeatPurchases),
    riskLevel: normalizeRiskLevel(rawCommercial.riskLevel),
  }
  const hasCommercial = Object.values(commercial).some(value => value !== undefined)

  if (!industry) throw new Error("请填写行业/赛道名称")
  if (mode === "brand" && !targetBrand) {
    throw new Error(subjectType === "person" ? "请填写要评估的人物姓名" : "请填写要评估的品牌名称")
  }

  return {
    mode,
    subjectType,
    personProfile,
    industry,
    city,
    scope,
    targetBrand: mode === "brand" ? targetBrand : undefined,
    website: mode === "brand" && website ? website : undefined,
    commercial: hasCommercial ? commercial : undefined,
  }
}

export function createDifficultyStageContext(input: DifficultyAssessmentInput): DifficultyStageContext {
  return {
    ...input,
    subjectType: normalizeAnalysisSubjectType(input.subjectType),
    target: input.mode === "brand"
      ? `${input.city !== "全国" ? input.city : "全国"} · ${input.industry} · ${input.targetBrand}`
      : input.city !== "全国" ? `${input.city}${input.industry}` : input.industry,
    process: {},
  }
}

function asStringArray(value: unknown, fallback: string[], limit = 3): string[] {
  const list = Array.isArray(value)
    ? value.map(item => String(item ?? "").trim()).filter(Boolean)
    : []
  return [...list, ...fallback].slice(0, limit)
}

function normalizeStageOutput(value: unknown, stage: { title: string }): DifficultyStageOutput {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {}
  return {
    title: text(source.title, stage.title),
    summary: text(source.summary, "该阶段暂无可展示的过程摘要。"),
    evidence: asStringArray(source.evidence, ["等待评估流程补充该阶段证据。"], 4),
    tags: asStringArray(source.tags, [stage.title], 5),
  }
}

export function difficultyStagesForMode(mode: DifficultyAssessmentMode) {
  return mode === "brand" ? BRAND_STAGES : INDUSTRY_STAGES
}

function normalizeProcess(
  process: Partial<DifficultyProcess>,
  mode: DifficultyAssessmentMode
): DifficultyProcess {
  return difficultyStagesForMode(mode).reduce((acc, stage) => {
    acc[stage.key] = normalizeStageOutput(process[stage.key], stage)
    return acc
  }, {} as DifficultyProcess)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function indicatorRecords(
  finalParsed: Record<string, unknown>,
  context: DifficultyStageContext,
): Record<string, unknown>[] {
  const stages = [finalParsed, context.review, context.scoring, context.comparison, context.research]
  const out: Record<string, unknown>[] = []
  for (const stage of stages) {
    const record = asRecord(stage)
    if (!record) continue
    const indicators = asRecord(record.indicators ?? record.raw_indicators)
    if (indicators) out.push(indicators)
    out.push(record)
  }
  return out
}

function firstValue(records: Record<string, unknown>[], keys: string[]): unknown {
  for (const record of records) {
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null && record[key] !== "") return record[key]
    }
  }
  return undefined
}

function numericIndicator(
  records: Record<string, unknown>[],
  keys: string[],
  options: { percent?: boolean } = {},
): number | undefined {
  const value = firstValue(records, keys)
  if (value === undefined) return undefined
  const direct = Number(value)
  const number = Number.isFinite(direct)
    ? direct
    : Number(String(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0])
  if (!Number.isFinite(number)) return undefined
  if (options.percent && number > 0 && number <= 1) return number * 100
  return number
}

function collectStringValues(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (typeof item === "string") return [item.trim()]
    const record = asRecord(item)
    if (!record) return []
    const name = text(record.name ?? record.brand ?? record.canonical)
    return name ? [name] : []
  }).filter(Boolean)
}

function collectCompetitorBrands(
  records: Record<string, unknown>[],
  context: DifficultyStageContext,
): string[] {
  const values: string[] = [...(context.penetrationEvidence?.topCompetitors ?? [])]
  for (const item of context.penetrationEvidence?.industryShare ?? []) values.push(item.brand)
  for (const record of records) {
    for (const key of [
      "competitor_brands",
      "candidate_brands",
      "top_answer_candidates",
      "major_incumbents",
      "top_brands",
    ]) {
      values.push(...collectStringValues(record[key]))
    }
  }
  return values.map(item => item.trim()).filter(Boolean)
}

function penetrationConcentration(context: DifficultyStageContext): number | undefined {
  const shares = context.penetrationEvidence?.industryShare ?? []
  if (shares.length === 0) return undefined
  const topThree = shares
    .map(item => Number(item.ratio))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)
    .slice(0, 3)
  if (topThree.length === 0) return undefined
  const sum = topThree.reduce((total, value) => total + value, 0)
  return sum <= 1 ? sum * 100 : sum
}

function extractScoringSignals(
  finalParsed: Record<string, unknown>,
  context: DifficultyStageContext,
): DifficultyScoringSignals {
  const records = indicatorRecords(finalParsed, context)
  const competitorBrands = collectCompetitorBrands(records, context)
  const knownIndicatorCount = [
    ["estimated_competitor_count", "brand_pool_count"],
    ["giant_incumbent_count", "major_incumbent_count"],
    ["top_brand_concentration", "top3_concentration"],
    ["geographic_complexity", "regional_complexity"],
    ["content_saturation", "content_supply_saturation"],
    ["authority_barrier", "trust_barrier"],
    ["source_concentration"],
    ["ai_entry_barrier"],
    ["market_size_score"],
    ["competitor_budget_strength", "marketing_budget_strength"],
  ].filter(keys => firstValue(records, keys) !== undefined).length
  const sourceCount = records.reduce((sum, record) => {
    const candidates = [record.sources, record.source_urls, record.evidence_urls]
    return sum + candidates.reduce<number>((count, value) => count + (Array.isArray(value) ? value.length : 0), 0)
  }, 0)
  const derivedCoverage = Math.min(100, knownIndicatorCount * 7 + Math.min(30, sourceCount * 3)
    + (context.penetrationEvidence?.totalSlots ? 15 : 0))
  const poolEstimate = numericIndicator(records, [
    "estimated_competitor_count",
    "brand_pool_count",
    "brand_pool_estimate",
  ])

  return {
    competitorBrands,
    estimatedCompetitorCount: poolEstimate,
    giantIncumbentCount: numericIndicator(records, ["giant_incumbent_count", "major_incumbent_count"]),
    topBrandConcentration: numericIndicator(
      records,
      ["top_brand_concentration", "top3_concentration"],
      { percent: true },
    ) ?? penetrationConcentration(context),
    geographicComplexity: numericIndicator(records, ["geographic_complexity", "regional_complexity"]),
    contentSaturation: numericIndicator(records, ["content_saturation", "content_supply_saturation"]),
    authorityBarrier: numericIndicator(records, ["authority_barrier", "trust_barrier"]),
    sourceConcentration: numericIndicator(records, ["source_concentration"]),
    aiEntryBarrier: numericIndicator(records, ["ai_entry_barrier"]),
    targetVisibilityGap: numericIndicator(records, ["target_visibility_gap", "brand_visibility_gap"]),
    trustAssetGap: numericIndicator(records, ["trust_asset_gap"]),
    contentAssetGap: numericIndicator(records, ["content_asset_gap", "content_matrix_gap"]),
    localResourceGap: numericIndicator(records, ["local_resource_gap", "regional_resource_gap"]),
    averageOrderValue: numericIndicator(records, ["average_order_value", "average_ticket"]),
    grossMarginRate: numericIndicator(records, ["gross_margin_rate", "gross_margin"], { percent: true }),
    annualRepeatPurchases: numericIndicator(records, ["annual_repeat_purchases", "repeat_purchases"]),
    marketSizeScore: numericIndicator(records, ["market_size_score"]),
    competitorBudgetStrength: numericIndicator(records, ["competitor_budget_strength", "marketing_budget_strength"]),
    evidenceCoverage: numericIndicator(records, ["evidence_coverage"]) ?? derivedCoverage,
  }
}

function normalizeResult(
  input: unknown,
  process: Partial<DifficultyProcess>,
  providerLabel: string,
  context: DifficultyStageContext
): DifficultyAssessmentResult {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {}
  const scope = normalizeScope(context.scope, context.city)
  const rawDimensions = source.dimensions && typeof source.dimensions === "object"
    ? source.dimensions as Record<string, unknown>
    : {}
  const scored = scoreDifficultyV2({
    industry: context.industry,
    mode: context.mode,
    subjectType: context.subjectType,
    scope,
    region: context.city,
    commercial: context.commercial,
    signals: extractScoringSignals(source, context),
  })
  const dimensions = Object.fromEntries(
    Object.entries(scored.dimensions).map(([key, calculated]) => {
      const row = asRecord(rawDimensions[key])
      return [key, {
        ...calculated,
        name: calculated.name,
        analysis: text(row?.analysis, calculated.analysis),
      }]
    }),
  )
  const normalizedProcess = normalizeProcess(process, context.mode)
  normalizedProcess.scoring = {
    ...normalizedProcess.scoring,
    summary: `V2 评分由后端固定公式计算，总分 ${scored.totalScore}/100；大模型只负责联网取证和提取原始指标。`,
    evidence: [
      `${context.subjectType === "person" ? "同行人物去重" : "品牌别名合并"}后按 ${scored.competitorCount} 个有效竞争主体计分`,
      `${context.city}按${scope}地域层级进入固定递增区间`,
      `商业价值与预算竞争指数 ${scored.commercialPressureIndex}/100`,
      ...normalizedProcess.scoring.evidence,
    ].slice(0, 5),
    tags: ["V2确定性评分", `${scored.totalScore}分`, "七维模型"],
  }

  return {
    scoreVersion: "v2",
    mode: context.mode,
    subjectType: context.subjectType,
    personProfile: context.personProfile,
    scope,
    region: context.city,
    targetBrand: context.targetBrand,
    website: context.website,
    totalScore: scored.totalScore,
    level: scored.level,
    stableMentionPeriod: scored.stableMentionPeriod,
    summary: text(
      source.summary,
      "本次评估已完成。请结合七个维度、联网证据和成本区间判断进入 AI 搜索推荐池的实际难度。"
    ),
    dimensions,
    insights: asStringArray(source.insights, [
      "推荐池结构决定曝光入口，需要先判断头部品牌是否已经稳定占位。",
      "本地搜索位往往比全国大词更容易出现错配，是 GEO 突围的关键观察点。",
      "内容来源越集中，越需要围绕权威渠道和真实案例建立可抓取资产。",
    ], 5),
    suggestions: asStringArray(source.suggestions, [
      "先从长尾问题和本地场景切入，避开被头部品牌长期占位的大词。",
      "持续发布结构化案例、服务流程和对比内容，提高被 AI 摘要引用的概率。",
      "建立多渠道内容矩阵，定期复测 AI 回答中的品牌提及变化。",
    ], 6),
    process: normalizedProcess,
    costEstimate: scored.costEstimate,
    generatedAt: new Date().toISOString(),
    providerLabel,
  }
}

export async function configuredDifficultyModels(preferred?: ModelKey): Promise<ModelKey[]> {
  const order = preferred
    ? [preferred, ...DIFFICULTY_MODEL_ORDER.filter(model => model !== preferred)]
    : DIFFICULTY_MODEL_ORDER
  const configured = await Promise.all(
    order.map(async model => ({ model, configured: await ADAPTERS[model].configured() })),
  )
  return configured.filter(item => item.configured).map(item => item.model)
}

const V2_INDICATOR_CONTRACT = `
同时必须返回 indicators，作为后端固定公式的原始输入。除品牌列表和商业金额外，强度类指标统一使用 0-100，数值越大代表难度越高；没有可靠依据时用 null，不得编造精确值：
"indicators": {
  "competitor_brands": ["去除平台、机构和形容词后的真实品牌名，别名也保留供后端合并"],
  "estimated_competitor_count": 0,
  "giant_incumbent_count": 0,
  "top_brand_concentration": 0,
  "geographic_complexity": 0,
  "content_saturation": 0,
  "authority_barrier": 0,
  "source_concentration": 0,
  "ai_entry_barrier": 0,
  "target_visibility_gap": 0,
  "trust_asset_gap": 0,
  "content_asset_gap": 0,
  "local_resource_gap": 0,
  "average_order_value": null,
  "gross_margin_rate": null,
  "annual_repeat_purchases": null,
  "market_size_score": 0,
  "competitor_budget_strength": 0,
  "evidence_coverage": 0
},
"source_urls": [{"title": "网页标题", "url": "https://可直接访问的页面", "supports": "支持哪个指标"}]
商业值允许给基于公开资料的合理区间中位数，但必须在 evidence 中标注为估算。source_urls 只收录具体文章、官网内容页、报告页或可读取数据页，不要图片、搜索页、首页占位或无效链接。下面各阶段的返回 JSON 示例只展示业务字段；最终对象必须把 indicators 和 source_urls 作为同级字段一并返回。`

function compactValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.trim().slice(0, 600)
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value
  if (depth >= 3) return undefined
  if (Array.isArray(value)) {
    return value.slice(0, 10).map(item => compactValue(item, depth + 1)).filter(item => item !== undefined)
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 18)
        .map(([key, item]) => [key, compactValue(item, depth + 1)])
        .filter(([, item]) => item !== undefined),
    )
  }
  return undefined
}

function compactRecord(
  value: Record<string, unknown> | undefined,
  keys: string[],
): Record<string, unknown> | null {
  if (!value) return null
  return Object.fromEntries(
    keys
      .filter(key => value[key] !== undefined)
      .map(key => [key, compactValue(value[key])]),
  )
}

function compactPriorContext(context: DifficultyStageContext): string {
  const compact = {
    research: compactRecord(context.research, [
      "summary", "questions", "candidate_brands", "top_answer_candidates", "source_channels",
      "brand_entry_risks", "uncertainties", "evidence", "indicators", "source_urls",
    ]),
    comparison: compactRecord(context.comparison, [
      "summary", "top_brands", "brand_pool_estimate", "local_visibility", "source_concentration",
      "content_quality", "entry_barrier", "brand_visibility", "trust_assets", "content_assets",
      "gap_against_top_brands", "entry_openings", "uncertainties", "evidence",
      "indicators", "source_urls",
    ]),
    scoring: compactRecord(context.scoring, [
      "summary", "dimension_scores", "total_score", "level", "priority_openings", "evidence", "indicators",
    ]),
    review: compactRecord(context.review, [
      "summary", "confidence", "adjustments", "warnings", "evidence", "indicators",
    ]),
  }
  const encoded = JSON.stringify(compact, null, 2)
  if (encoded.length <= 14_000) return encoded
  return JSON.stringify({
    research: compactRecord(context.research, ["summary", "evidence", "indicators", "source_urls"]),
    comparison: compactRecord(context.comparison, ["summary", "evidence", "indicators", "source_urls"]),
    scoring: compactRecord(context.scoring, ["summary", "dimension_scores", "total_score", "evidence", "indicators"]),
    review: compactRecord(context.review, ["summary", "confidence", "adjustments", "warnings", "indicators"]),
  }, null, 2)
}

function buildBrandStagePrompt(
  stageKey: DifficultyStageKey,
  context: DifficultyStageContext,
  system: string,
  common: string,
  prior: string
): { system: string; user: string } {
  const brand = context.targetBrand || "目标品牌"
  const websiteLine = context.website ? `品牌官网/资料：${context.website}` : "品牌官网/资料：未提供，需要在报告中提示可补充官网、案例或资质材料。"

  if (stageKey === "research") {
    return {
      system,
      user: `${common}
${websiteLine}
阶段1：行业调研。
请先联网评估「${context.industry}」行业在 AI 搜索/GEO 中的整体环境，不要直接给品牌总分。至少核验 6 个可访问的具体网页，并保留完整网址。
请完成：
1. 生成 8-12 个用户真实会问的问题，覆盖全国大词、本地词、场景词、价格/口碑/排名词。
2. 推断这些问题下 AI 可能优先提及哪些头部品牌、平台、榜单或机构。
3. 判断行业主要信源渠道，如官网、新闻、知乎、小红书、行业站、榜单软文、地图/本地生活平台等。
4. 判断目标品牌「${brand}」要进入答案时最可能遇到的行业阻力。
5. 识别有效竞品、强势大厂、客单价/毛利/复购区间、市场规模与竞品预算强度；品牌别名不要自行当成多个主体。
${V2_INDICATOR_CONTRACT}
返回 JSON：
{
  "summary": "行业调研摘要，120字左右",
  "questions": ["问题1", "问题2"],
  "top_answer_candidates": ["可能占位的头部品牌/平台/机构"],
  "source_channels": ["主要渠道"],
  "brand_entry_risks": ["目标品牌进入答案的阻力"],
  "evidence": ["证据摘要1", "证据摘要2", "证据摘要3"],
  "tags": ["行业调研", "标签2"]
}`,
    }
  }

  if (stageKey === "comparison") {
    return {
      system,
      user: `${common}
${websiteLine}
阶段2：品牌现状识别。
上一阶段 JSON：
${prior}
请围绕目标品牌「${brand}」判断它当前做 GEO 的基础。优先复用上一阶段联网证据，必要时继续联网补证；如果信息不足，要明确写入不确定性。
请完成：
1. 判断该品牌当前公开可见度、可验证信任资产、内容资产、地区/场景覆盖。
2. 对比头部品牌通常具备的官网、案例、资质、媒体、第三方提及和口碑信号。
3. 找出该品牌最短的突围入口，比如城市词、场景词、人群词、对比词。
4. 输出修正后的原始指标，重点核验品牌可见度、信任资产、内容资产、本地资源和商业预算差距。
${V2_INDICATOR_CONTRACT}
返回 JSON：
{
  "summary": "品牌现状摘要，120字左右",
  "brand_visibility": "高/中/低/未知，并说明原因",
  "trust_assets": ["已有或应补充的信任资产"],
  "content_assets": ["已有或应补充的内容资产"],
  "gap_against_top_brands": ["与头部品牌的差距"],
  "entry_openings": ["可优先切入的入口"],
  "uncertainties": ["需要人工补充或二次验证的点"],
  "evidence": ["品牌现状证据1", "品牌现状证据2", "品牌现状证据3"],
  "tags": ["品牌现状", "标签2"]
}`,
    }
  }

  if (stageKey === "scoring") {
    return {
      system,
      user: `${common}
${websiteLine}
阶段3：竞品信源对比与原始指标审计。
上一阶段 JSON：
${prior}
最终分数由后端固定公式计算，你不能输出或修改最终分数。请逐项审计联网证据与原始指标，合并同一品牌的中英文名、简称和公司全称，并说明每个指标为什么合理。
${V2_INDICATOR_CONTRACT}
返回 JSON：
{
  "summary": "指标审计摘要，120字左右",
  "dimension_evidence": {"dimension1": ["证据"], "dimension2": ["证据"], "dimension3": ["证据"], "dimension4": ["证据"], "dimension5": ["证据"], "dimension6": ["证据"], "dimension7": ["证据"]},
  "priority_openings": ["优先突破入口1", "入口2"],
  "evidence": ["指标证据1", "指标证据2", "指标证据3"],
  "tags": ["指标审计", "品牌别名合并"]
}`,
    }
  }

  if (stageKey === "review") {
    return {
      system,
      user: `${common}
${websiteLine}
阶段4：品牌难度复核。
上一阶段 JSON：
${prior}
请检查行业调研、品牌现状、竞品信源对比、评分之间是否一致，重点找：
1. 是否因为缺少品牌资料而过度推断。
2. 原始指标是否与目标品牌「${brand}」的证据匹配。
3. 是否把同一品牌的中英文名、简称或公司全称重复计数。
4. 哪些结论需要用户补充官网、资质、案例、媒体稿或客户评价后再复测。
最终分数由后端计算，本阶段只修正原始指标和置信度。
${V2_INDICATOR_CONTRACT}
返回 JSON：
{
  "summary": "复核结论，120字左右",
  "confidence": "高/中高/中/低",
  "adjustments": [{"dimension": "维度名", "before": "原判断", "after": "建议调整", "reason": "原因"}],
  "warnings": ["低置信度或需人工验证的点"],
  "evidence": ["复核证据1", "复核证据2", "复核证据3"],
  "tags": ["品牌复核", "标签2"]
}`,
    }
  }

  return {
    system,
    user: `${common}
${websiteLine}
阶段5：突破路径报告。
上一阶段 JSON：
${prior}
请基于前四步生成最终可展示报告。最终分数和成本由后端固定公式计算，你只负责根据联网证据撰写七个维度的分析、洞察和建议，不要自行打分。
维度名称必须保持：
dimension1 行业竞争与头部封锁，满分15
dimension2 目标品牌可见度差距，满分15
dimension3 信任资产差距，满分15
dimension4 内容矩阵缺口，满分15
dimension5 地域覆盖与本地资源差距，满分15
dimension6 商业预算竞争压力，满分15
dimension7 AI 答案进入门槛，满分10
返回 JSON：
{
  "dimensions": {
    "dimension1": {"analysis": "行业竞争与头部封锁分析，100字左右"},
    "dimension2": {"analysis": "目标品牌可见度差距分析"},
    "dimension3": {"analysis": "信任资产差距分析"},
    "dimension4": {"analysis": "内容矩阵缺口分析"},
    "dimension5": {"analysis": "地域覆盖与本地资源差距分析"},
    "dimension6": {"analysis": "商业预算竞争压力分析"},
    "dimension7": {"analysis": "AI 答案进入门槛分析"}
  },
  "summary": "整体评估总结，200字左右，必须说明该品牌为什么是这个难度",
  "insights": ["品牌短板1", "机会点2", "风险3"],
  "suggestions": ["优先内容动作1", "信源建设动作2", "复测动作3"],
  "process": {
    "report": {
      "summary": "最终报告如何由前四步得出，100字左右",
      "evidence": ["报告依据1", "报告依据2", "报告依据3"],
      "tags": ["品牌路径", "置信度"]
    }
  }
}`,
  }
}

function buildPersonStagePrompt(
  stageKey: DifficultyStageKey,
  context: DifficultyStageContext,
  system: string,
  common: string,
  prior: string,
): { system: string; user: string } {
  const person = context.targetBrand || "目标人物"
  const profileContext = formatPersonSubjectContext(context.personProfile)
  const websiteLine = context.website
    ? `个人主页/机构资料页：${context.website}`
    : "个人主页/机构资料页：未提供，需要在报告中提示补充可核验资料页、案例或资质材料。"
  const personIndicatorRules = `
【个人 IP 指标口径】
1. indicators.competitor_brands 沿用兼容字段名，但数组中只能放具名同行人物，不得放医院、律所、公司、学校、协会、平台、职称或普通形容词。
2. 同行必须与目标人物在职业、专业方向、服务地区或用户问题场景上存在直接竞争；仅在同一篇文章出现不等于同行。
3. 只合并同一人物的全名、带职称写法和用户明确提供的别名；不得因同姓、包含关系或名字相似而合并不同人物。
4. 机构可以作为信任资产和来源证据单独分析，但绝不能计入 estimated_competitor_count。`

  if (stageKey === "research") {
    return {
      system,
      user: `${common}
${websiteLine}
【目标人物身份资料】
${profileContext}
阶段1：行业与同行调研。
请联网评估「${context.industry}」领域中目标人物「${person}」的 AI 搜索环境，至少核验 6 个可访问的具体网页并保留完整网址。
请完成：
1. 生成 8-12 个用户真实会问的问题，覆盖专业能力、地区服务、场景需求、口碑、选择和风险。
2. 识别这些问题中可能被 AI 推荐的具名同行人物；机构、平台和榜单必须另列，不能混入人物。
3. 判断主要信源渠道和目标人物进入答案的行业阻力。
4. 识别有效同行人数、头部专家占位、商业价值、市场规模与同行内容投入强度。
${personIndicatorRules}
${V2_INDICATOR_CONTRACT}
返回 JSON：
{
  "summary": "行业与同行调研摘要，120字左右",
  "questions": ["问题1", "问题2"],
  "top_answer_candidates": ["只填写具名同行人物"],
  "institutions": ["相关机构、医院、律所、公司或平台"],
  "source_channels": ["主要渠道"],
  "brand_entry_risks": ["目标人物进入答案的阻力"],
  "evidence": ["证据摘要1", "证据摘要2", "证据摘要3"],
  "tags": ["个人IP调研", "同行人物"]
}`,
    }
  }

  if (stageKey === "comparison") {
    return {
      system,
      user: `${common}
${websiteLine}
【目标人物身份资料】
${profileContext}
阶段2：个人 IP 现状识别。
上一阶段 JSON：
${prior}
请围绕目标人物「${person}」判断其当前做 GEO 的基础。优先复用上一阶段联网证据，必要时继续联网补证；同名身份不能确认时必须标记歧义。
请完成：
1. 判断公开可见度、专业可信资产、内容资产、地区和场景覆盖。
2. 与头部同行人物通常具备的专业资料页、案例、资质、媒体、学术/行业内容和第三方提及对比。
3. 找出最短突围入口，如地区词、专业方向词、问题场景词和同行对比词。
4. 输出可见度、信任资产、内容资产、本地资源和商业预算差距的原始指标。
${personIndicatorRules}
${V2_INDICATOR_CONTRACT}
返回 JSON：
{
  "summary": "个人 IP 现状摘要，120字左右",
  "brand_visibility": "高/中/低/未知，并说明原因",
  "trust_assets": ["已有或应补充的专业信任资产"],
  "content_assets": ["已有或应补充的内容资产"],
  "gap_against_top_brands": ["与头部同行人物的差距"],
  "entry_openings": ["可优先切入的入口"],
  "uncertainties": ["同名歧义或需要人工补充的资料"],
  "evidence": ["人物现状证据1", "人物现状证据2", "人物现状证据3"],
  "tags": ["个人IP现状", "标签2"]
}`,
    }
  }

  if (stageKey === "scoring") {
    return {
      system,
      user: `${common}
${websiteLine}
阶段3：同行与信源指标审计。
上一阶段 JSON：
${prior}
最终分数由后端固定公式计算，你不能输出或修改最终分数。请逐项审计证据和原始指标，确保同行人物与机构分离，不把同姓、近似姓名或包含关系误合并。
${personIndicatorRules}
${V2_INDICATOR_CONTRACT}
返回 JSON：
{
  "summary": "个人 IP 指标审计摘要，120字左右",
  "dimension_evidence": {"dimension1": ["证据"], "dimension2": ["证据"], "dimension3": ["证据"], "dimension4": ["证据"], "dimension5": ["证据"], "dimension6": ["证据"], "dimension7": ["证据"]},
  "priority_openings": ["优先突破入口1", "入口2"],
  "evidence": ["指标证据1", "指标证据2", "指标证据3"],
  "tags": ["指标审计", "人物机构分离"]
}`,
    }
  }

  if (stageKey === "review") {
    return {
      system,
      user: `${common}
${websiteLine}
阶段4：个人 IP 难度复核。
上一阶段 JSON：
${prior}
请检查调研、人物现状、同行信源对比和原始指标是否一致，重点核验：
1. 是否因缺少人物资料而过度推断或发生同名串人。
2. 原始指标是否与目标人物「${person}」的证据匹配。
3. 是否把机构、职称、普通词或无直接竞争关系的人计入同行。
4. 哪些结论需要补充个人资料页、资质、案例、媒体稿或公开作品后复测。
${personIndicatorRules}
${V2_INDICATOR_CONTRACT}
返回 JSON：
{
  "summary": "复核结论，120字左右",
  "confidence": "高/中高/中/低",
  "adjustments": [{"dimension": "维度名", "before": "原判断", "after": "建议调整", "reason": "原因"}],
  "warnings": ["同名歧义、低置信度或需人工验证的点"],
  "evidence": ["复核证据1", "复核证据2", "复核证据3"],
  "tags": ["个人IP复核", "标签2"]
}`,
    }
  }

  return {
    system,
    user: `${common}
${websiteLine}
阶段5：个人 IP 突破路径报告。
上一阶段 JSON：
${prior}
请基于前四步生成最终报告。最终分数和成本由后端固定公式计算，你只负责根据联网证据撰写七个维度的分析、洞察和建议，不要自行打分。
维度名称必须保持：
dimension1 行业竞争与头部封锁，满分15
dimension2 目标人物可见度差距，满分15
dimension3 信任资产差距，满分15
dimension4 内容矩阵缺口，满分15
dimension5 地域覆盖与本地资源差距，满分15
dimension6 商业预算竞争压力，满分15
dimension7 AI 答案进入门槛，满分10
返回 JSON：
{
  "dimensions": {
    "dimension1": {"analysis": "行业与头部同行竞争分析，100字左右"},
    "dimension2": {"analysis": "目标人物可见度差距分析"},
    "dimension3": {"analysis": "专业信任资产差距分析"},
    "dimension4": {"analysis": "个人 IP 内容矩阵缺口分析"},
    "dimension5": {"analysis": "地域覆盖与本地资源差距分析"},
    "dimension6": {"analysis": "商业预算竞争压力分析"},
    "dimension7": {"analysis": "AI 答案进入门槛分析"}
  },
  "summary": "整体评估总结，200字左右，必须说明该人物为什么是这个难度",
  "insights": ["个人IP短板1", "机会点2", "风险3"],
  "suggestions": ["优先内容动作1", "信源建设动作2", "复测动作3"],
  "process": {
    "report": {
      "summary": "最终报告如何由前四步得出，100字左右",
      "evidence": ["报告依据1", "报告依据2", "报告依据3"],
      "tags": ["个人IP路径", "置信度"]
    }
  }
}`,
  }
}

function buildStagePrompt(stageKey: DifficultyStageKey, context: DifficultyStageContext): { system: string; user: string } {
  const system = "你是严格的 JSON 输出器，也是 AI 搜索/GEO 商业难度评估专家。调研阶段必须使用可用的联网工具核验公开网页；不确定的数据必须标成估算或 null。只返回一个 JSON 对象，不返回 Markdown、解释文字或代码块。"
  const scope = normalizeScope(context.scope, context.city)
  const penetrationEvidence = context.penetrationEvidence
    ? JSON.stringify(context.penetrationEvidence, null, 2)
    : "当前客户没有可复用的渗透率检测快照。"
  const commercialInput = context.commercial
    ? JSON.stringify(context.commercial, null, 2)
    : "用户未填写，需根据公开资料估算区间。"
  const common = `评估对象：「${context.target}」
当前任务采用分阶段评估，不能直接拍脑袋给总分；必须基于上一步证据继续分析。
行业/赛道：${context.industry}
城市/地区：${context.city}
地域层级：${scope}
用户填写的商业参数：${commercialInput}
当前客户已有渗透率证据：${penetrationEvidence}
评估模式：${context.mode === "brand"
    ? context.subjectType === "person" ? "个人 IP GEO 难度评估" : "品牌 GEO 难度评估"
    : "行业 GEO 难度评估"}
${context.targetBrand ? `${context.subjectType === "person" ? "目标人物" : "目标品牌"}：${context.targetBrand}` : ""}
输出要求：只返回 JSON 对象。`
  const prior = compactPriorContext(context)

  if (context.mode === "brand") {
    if (context.subjectType === "person") {
      return buildPersonStagePrompt(stageKey, context, system, common, prior)
    }
    return buildBrandStagePrompt(stageKey, context, system, common, prior)
  }

  if (stageKey === "research") {
    return {
      system,
      user: `${common}
阶段1：调研取样。
请执行真实联网 AI 搜索/GEO 调研，至少核验 6 个可访问的具体网页并保留完整网址，不能只凭行业常识推断。
请完成：
1. 生成 8-12 个用户真实会问的问题，覆盖全国大词、本地词、场景词、价格/口碑/排名词。
2. 推断这些问题下 AI 可能会提及的品牌/机构/平台类型。
3. 判断主要信息来源渠道，如官网、新闻、知乎、小红书、行业站、榜单软文、地图/本地生活平台等。
4. 输出不确定性和需要用户二次验证的点。
5. 识别有效竞品数量、强势大厂、头部集中度、客单价/毛利/复购区间、市场规模和竞品预算强度；同一品牌的中英文名和简称不能重复计数。
${V2_INDICATOR_CONTRACT}
返回 JSON：
{
  "summary": "本阶段调研摘要，120字左右",
  "questions": ["问题1", "问题2"],
  "candidate_brands": ["可能出现的品牌或机构"],
  "source_channels": ["主要渠道"],
  "uncertainties": ["不确定点"],
  "evidence": ["证据摘要1", "证据摘要2", "证据摘要3"],
  "tags": ["标签1", "标签2"]
}`,
    }
  }

  if (stageKey === "comparison") {
    return {
      system,
      user: `${common}
阶段2：品牌与渠道对比。
上一阶段 JSON：
${prior}
请基于调研结果，比较品牌曝光集中度、推荐池宽度、本地服务商可见度、内容真实性、准入门槛、信息来源渠道。
请复核并修正上一阶段的原始指标。竞品越多应判断为越难；地域范围由后端按单城市、单省、跨省、全国固定递增计分，不得反向解释。
${V2_INDICATOR_CONTRACT}
返回 JSON：
{
  "summary": "本阶段对比摘要，120字左右",
  "top_brands": [{"name": "品牌/机构名", "exposure_reason": "为什么容易被AI提及", "estimated_visibility": "高/中/低"}],
  "brand_pool_estimate": "推荐池数量判断，如10-15个",
  "local_visibility": "本地真实服务商在AI推荐里的可见度判断",
  "source_concentration": "渠道集中度判断",
  "content_quality": "软文/虚假/AI批量内容情况",
  "entry_barrier": "中小商家进入AI推荐池的门槛判断",
  "evidence": ["对比证据1", "对比证据2", "对比证据3"],
  "tags": ["标签1", "标签2"]
}`,
    }
  }

  if (stageKey === "scoring") {
    return {
      system,
      user: `${common}
阶段3：原始指标审计。
上一阶段 JSON：
${prior}
最终分数由后端固定公式计算，你不能输出或修改最终分数。请逐项核验原始指标，合并品牌别名；有效竞品越多必须表示竞争越难，高客单、高毛利、强复购和大厂预算必须进入商业竞争指标。
${V2_INDICATOR_CONTRACT}
返回 JSON：
{
  "summary": "指标审计摘要，120字左右",
  "dimension_evidence": {"dimension1": ["证据"], "dimension2": ["证据"], "dimension3": ["证据"], "dimension4": ["证据"], "dimension5": ["证据"], "dimension6": ["证据"], "dimension7": ["证据"]},
  "evidence": ["指标证据1", "指标证据2", "指标证据3"],
  "tags": ["指标审计", "品牌别名合并"]
}`,
    }
  }

  if (stageKey === "review") {
    return {
      system,
      user: `${common}
阶段4：一致性复核。
上一阶段 JSON：
${prior}
请检查调研、对比、评分之间是否一致，重点找：
1. 原始指标是否和证据匹配。
2. 是否把同一品牌的中英文名、简称或公司全称重复计数。
3. 是否低估高客单、高毛利、强复购或大厂密集行业。
4. 哪些结论置信度低，需要在报告中提示。
最终分数由后端计算，本阶段只修正原始指标和置信度。
${V2_INDICATOR_CONTRACT}
返回 JSON：
{
  "summary": "复核结论，120字左右",
  "confidence": "高/中高/中/低",
  "adjustments": [{"dimension": "维度名", "before": "原判断", "after": "建议调整", "reason": "原因"}],
  "warnings": ["低置信度或需人工验证的点"],
  "evidence": ["复核证据1", "复核证据2", "复核证据3"],
  "tags": ["标签1", "标签2"]
}`,
    }
  }

  return {
    system,
    user: `${common}
阶段5：生成最终报告。
上一阶段 JSON：
${prior}
请基于调研、对比、指标审计和复核，生成最终可展示报告。最终分数和成本由后端固定公式计算，你只负责根据联网证据撰写七个维度的分析、洞察和建议，不要自行打分。
维度名称必须保持：
dimension1 头部品牌锁定强度，满分15
dimension2 有效竞品密度，满分15
dimension3 地域覆盖复杂度，满分15
dimension4 商业价值与预算竞争，满分20
dimension5 内容供给饱和度，满分15
dimension6 权威信任门槛，满分10
dimension7 信源与 AI 入口壁垒，满分10
返回 JSON：
{
  "dimensions": {
    "dimension1": {"analysis": "头部品牌锁定强度分析，100字左右"},
    "dimension2": {"analysis": "有效竞品密度分析"},
    "dimension3": {"analysis": "地域覆盖复杂度分析"},
    "dimension4": {"analysis": "商业价值与预算竞争分析"},
    "dimension5": {"analysis": "内容供给饱和度分析"},
    "dimension6": {"analysis": "权威信任门槛分析"},
    "dimension7": {"analysis": "信源与 AI 入口壁垒分析"}
  },
  "summary": "整体评估总结，200字左右，必须说明分数来自前面哪些证据",
  "insights": ["关键洞察1", "关键洞察2", "关键洞察3"],
  "suggestions": ["GEO策略建议1", "GEO策略建议2", "GEO策略建议3"],
  "process": {
    "report": {
      "summary": "最终报告如何由前四步得出，100字左右",
      "evidence": ["报告依据1", "报告依据2", "报告依据3"],
      "tags": ["最终报告", "置信度"]
    }
  }
}`,
  }
}

export async function executeDifficultyStage(args: {
  stageKey: DifficultyStageKey
  context: DifficultyStageContext
  model: ModelKey
}): Promise<Record<string, unknown>> {
  const stage = difficultyStagesForMode(args.context.mode).find(item => item.key === args.stageKey)
  if (!stage) throw new Error(`未知测评阶段：${args.stageKey}`)

  const { system, user } = buildStagePrompt(args.stageKey, args.context)
  const webEvidenceStage = args.stageKey === "research" || args.stageKey === "comparison"
  const raw = await ADAPTERS[args.model].chat({
    system,
    user,
    temperature: args.stageKey === "report" ? 0.28 : 0.35,
    maxTokens: args.stageKey === "report" ? 4096 : webEvidenceStage ? 3200 : 2400,
    jsonMode: true,
    mode: "judge",
    allowWebSearch: webEvidenceStage,
    timeoutSec: webEvidenceStage ? 240 : 180,
  })
  return parseJsonStrict<Record<string, unknown>>(raw, stage.title)
}

export function applyDifficultyStageResult(
  stageKey: DifficultyStageKey,
  parsed: Record<string, unknown>,
  context: DifficultyStageContext,
): void {
  const stage = difficultyStagesForMode(context.mode).find(item => item.key === stageKey)
  if (!stage) throw new Error(`未知测评阶段：${stageKey}`)

  if (stageKey === "report") {
    const reportProcess = parsed.process && typeof parsed.process === "object"
      ? (parsed.process as Record<string, unknown>).report
      : undefined
    context.process.report = normalizeStageOutput(reportProcess ?? {
      summary: parsed.summary,
      evidence: parsed.insights,
      tags: ["最终报告", text(parsed.level, "已评分")],
    }, stage)
    return
  }

  context.process[stageKey] = normalizeStageOutput(parsed, stage)
  if (stageKey === "research") context.research = parsed
  if (stageKey === "comparison") context.comparison = parsed
  if (stageKey === "scoring") context.scoring = parsed
  if (stageKey === "review") context.review = parsed
}

export function finalizeDifficultyAssessment(
  finalParsed: Record<string, unknown>,
  context: DifficultyStageContext,
  providerLabel: string,
): DifficultyAssessmentResult {
  return normalizeResult(finalParsed, context.process, providerLabel, context)
}

export async function runDifficultyAssessment(
  input: DifficultyAssessmentInput,
  options: {
    preferredModel?: ModelKey
    isCancelled?: () => boolean | Promise<boolean>
    onStage?: (event: {
      stageKey: DifficultyStageKey
      stageIndex: number
      model: ModelKey
      parsed: Record<string, unknown>
      context: DifficultyStageContext
    }) => void | Promise<void>
  } = {},
): Promise<{ result: DifficultyAssessmentResult; stageModels: Partial<Record<DifficultyStageKey, ModelKey>> }> {
  const models = await configuredDifficultyModels(options.preferredModel)
  if (models.length === 0) {
    throw new Error("没有任何已配置的大模型可用，请先在后台管理页配置至少一个 API Key")
  }

  const context = createDifficultyStageContext(input)
  const stageModels: Partial<Record<DifficultyStageKey, ModelKey>> = {}
  let finalParsed: Record<string, unknown> | null = null
  const stages = difficultyStagesForMode(input.mode)

  for (let stageIndex = 0; stageIndex < stages.length; stageIndex++) {
    if (await options.isCancelled?.()) throw new Error("用户已停止测评")
    const stage = stages[stageIndex]
    let completed = false
    let lastError: unknown

    for (const model of models) {
      try {
        const parsed = await executeDifficultyStage({ stageKey: stage.key, context, model })
        applyDifficultyStageResult(stage.key, parsed, context)
        stageModels[stage.key] = model
        if (stage.key === "report") finalParsed = parsed
        await options.onStage?.({ stageKey: stage.key, stageIndex, model, parsed, context })
        completed = true
        break
      } catch (error) {
        lastError = error
      }
    }

    if (!completed) {
      const detail = lastError instanceof Error ? lastError.message : "未知错误"
      throw new Error(`${stage.title}失败：${detail}`)
    }
  }

  if (!finalParsed) throw new Error("多阶段评估未生成最终报告。")
  const usedModels = Array.from(new Set(Object.values(stageModels)))
  const providerLabel = usedModels.map(model => MODEL_LABELS[model]).join(" → ")
  return {
    result: finalizeDifficultyAssessment(finalParsed, context, providerLabel),
    stageModels,
  }
}
