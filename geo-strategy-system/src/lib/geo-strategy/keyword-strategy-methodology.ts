import { parseJsonLoose } from "@/lib/score-utils"
import type {
  GeoQuestionOptimization,
  GeoStrategyPlan,
  KeywordStrategyGenerationSettings,
  KeywordStrategyLanguageStyle,
  KeywordStrategyQualityAudit,
  KeywordStrategyResearchAudit,
  KeywordStrategyResearchSource,
} from "@/types/geo-strategy"

export const KEYWORD_STRATEGY_METHODOLOGY_VERSION = "doubao-geo-keyword-strategy-v1"

export const KEYWORD_STRATEGY_LANGUAGE_LABELS: Record<KeywordStrategyLanguageStyle, string> = {
  auto: "根据目标地域自动判断",
  mainland_simplified: "中国大陆简体口语",
  hong_kong_traditional_cantonese: "香港繁体及粤语表达",
  formal_traditional: "正式繁体中文",
  custom: "自定义语言风格",
}

export const KEYWORD_DECISION_DIMENSIONS = [
  "需求判断",
  "品牌/方案推荐",
  "价格费用",
  "对比选型",
  "场景细分",
  "避坑风险",
  "口碑评价",
  "流程服务",
  "品质工艺",
  "时效/地域",
] as const

export type KeywordDecisionDimension = typeof KEYWORD_DECISION_DIMENSIONS[number]

export const KEYWORD_DIMENSION_CATEGORY_MAP: Record<KeywordDecisionDimension, string> = {
  "需求判断": "品牌认知型",
  "品牌/方案推荐": "榜单推荐型",
  "价格费用": "采购决策型",
  "对比选型": "竞品对比型",
  "场景细分": "场景人群型",
  "避坑风险": "风险疑虑型",
  "口碑评价": "品牌认知型",
  "流程服务": "采购决策型",
  "品质工艺": "品牌认知型",
  "时效/地域": "场景人群型",
}

const IMAGE_OR_ASSET_PATH = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:$|[?#])/i
const ASSET_HINT = /(?:\/|^)(?:assets?|images?|img|icons?|logos?|static)(?:\/|$)/i

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringList(value: unknown, limit = 20): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    const text = String(item || "").trim()
    const key = text.replace(/\s+/g, "").toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    result.push(text)
    if (result.length >= limit) break
  }
  return result
}

export function parseKeywordInput(value: unknown, limit = 120): string[] {
  const values = Array.isArray(value)
    ? value.map(item => String(item))
    : String(value || "").split(/[\n\r,，;；、]+/)
  return stringList(values, limit)
}

export function normalizeKeywordStrategyLanguageStyle(
  value: unknown,
): KeywordStrategyLanguageStyle {
  const styles = new Set<KeywordStrategyLanguageStyle>([
    "auto",
    "mainland_simplified",
    "hong_kong_traditional_cantonese",
    "formal_traditional",
    "custom",
  ])
  return typeof value === "string" && styles.has(value as KeywordStrategyLanguageStyle)
    ? value as KeywordStrategyLanguageStyle
    : "auto"
}

export function normalizeKeywordStrategySettings(
  value: unknown,
  fallbackRegion = "",
): KeywordStrategyGenerationSettings {
  const source = record(value)
  const languageStyle = normalizeKeywordStrategyLanguageStyle(source.language_style)
  return {
    target_region: String(source.target_region || fallbackRegion || "不限地域").trim() || "不限地域",
    language_style: languageStyle,
    custom_language_style: languageStyle === "custom"
      ? String(source.custom_language_style || "").trim().slice(0, 120)
      : undefined,
    custom_keywords: parseKeywordInput(source.custom_keywords),
  }
}

export function keywordLanguageInstruction(
  settings: KeywordStrategyGenerationSettings,
): string {
  if (settings.language_style === "custom") {
    return settings.custom_language_style || "使用目标用户自然、易懂的中文表达"
  }
  return KEYWORD_STRATEGY_LANGUAGE_LABELS[settings.language_style]
}

export function normalizeKeywordResearchSources(
  value: unknown,
  limit = 16,
): KeywordStrategyResearchSource[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: KeywordStrategyResearchSource[] = []

  for (const item of value) {
    const source = record(item)
    const rawUrl = String(source.url || "").trim()
    if (!rawUrl || IMAGE_OR_ASSET_PATH.test(rawUrl) || ASSET_HINT.test(rawUrl)) continue
    try {
      const url = new URL(rawUrl)
      if (url.protocol !== "http:" && url.protocol !== "https:") continue
      url.hash = ""
      const normalizedUrl = url.toString()
      if (seen.has(normalizedUrl)) continue
      seen.add(normalizedUrl)
      result.push({
        title: String(source.title || source.name || url.hostname).trim().slice(0, 180),
        url: normalizedUrl,
        domain: String(source.domain || url.hostname).replace(/^www\./i, "").trim(),
      })
      if (result.length >= limit) break
    } catch {
      continue
    }
  }
  return result
}

export function buildKeywordResearchPrompt(input: {
  profile: Record<string, unknown>
  settings: KeywordStrategyGenerationSettings
}): { system: string; user: string } {
  const profile = input.profile
  const enabledText = (value: unknown) => Array.isArray(value)
    ? value
        .filter(item => !item || typeof item !== "object" || (item as { enabled?: unknown }).enabled !== false)
        .map(item => typeof item === "object" && item
          ? String((item as { text?: unknown }).text || "")
          : String(item || ""))
        .map(item => item.trim())
        .filter(Boolean)
    : []
  const customKeywords = input.settings.custom_keywords.length > 0
    ? input.settings.custom_keywords.join("、")
    : "请根据业务资料研究并提炼"
  const language = keywordLanguageInstruction(input.settings)

  return {
    system: `你是 GEO 关键词策略的联网研究员。必须先使用联网搜索核验目标地域、行业、用户真实搜索表达、采购决策因素和近期公开信息，再输出结构化研究摘要。

要求：
1. 只引用可打开、可阅读的公开网页，不要把图片、图标、Logo、静态资源或无正文页面当成来源。
2. 不编造排名、价格、资质、案例或市场数据。
3. 研究用于后续关键词和真实疑问句生成，不得写成品牌广告。
4. 输出严格 JSON，不要 Markdown，不要解释 JSON 之外的内容。`,
    user: `请联网研究下面项目的 GEO 关键词与用户提问语境。

目标对象：${String(profile.project_name || profile.brand_or_product || "")}
行业：${String(profile.industry || "")}
目标客户：${String(profile.audience || "")}
产品/服务：${String(profile.product_description || "")}
目标地域：${input.settings.target_region}
语言风格：${language}
自定义核心关键词：${customKeywords}
痛点：${enabledText(profile.pain_points).join("、") || "暂无"}
劣势：${enabledText(profile.weaknesses).join("、") || "暂无"}
场景：${enabledText(profile.scenes).join("、") || "暂无"}
竞品/同行：${enabledText(profile.competitors).join("、") || "暂无"}

请重点研究：
- 当地用户如何自然表达这类需求；
- 从需求判断、推荐、价格、对比、场景、避坑、口碑、流程、品质、时效/地域十个维度会问什么；
- 哪些决策因素、风险信号和长尾表达值得进入后续策略；
- 哪些公开网页能够支撑上述判断。

输出：
{
  "brief": "不超过800字的联网研究摘要",
  "user_language_patterns": ["真实自然表达模式"],
  "decision_signals": ["影响选择和采购的决策信号"],
  "regional_expressions": ["地域或语言表达"],
  "recommended_keywords": ["研究后建议的核心或长尾关键词"]
}`,
  }
}

export function parseKeywordResearchBrief(raw: string): {
  brief: string
  userLanguagePatterns: string[]
  decisionSignals: string[]
  regionalExpressions: string[]
  recommendedKeywords: string[]
} {
  const parsed = record(parseJsonLoose(raw))
  return {
    brief: String(parsed.brief || raw || "").trim().slice(0, 8_000),
    userLanguagePatterns: stringList(parsed.user_language_patterns, 24),
    decisionSignals: stringList(parsed.decision_signals, 24),
    regionalExpressions: stringList(parsed.regional_expressions, 24),
    recommendedKeywords: stringList(parsed.recommended_keywords, 40),
  }
}

export function buildKeywordMethodologyInstruction(): string {
  return `【豆包 GEO 关键词策略方法论 ${KEYWORD_STRATEGY_METHODOLOGY_VERSION}】
1. 关键词和问题要覆盖完整决策链：${KEYWORD_DECISION_DIMENSIONS.join("、")}。
2. 系统界面继续使用七类主意图：榜单推荐型、痛点解决型、竞品对比型、采购决策型、场景人群型、品牌认知型、风险疑虑型；十个决策维度写入 decisionDimension，作为七类下面的细分维度。
3. 问题必须自然、口语、地域适配、语义不同，不能只是同义词替换。
4. 生成问题时禁止植入品牌优势、优势数字、认证、案例和卖点；优势由系统在生成后独立匹配。
5. 每条问题都要有可执行的 content_angle 和 geo_optimization：
   - keyword_placement：关键词应自然出现在哪里；
   - conclusion_first：开头应先回答什么结论；
   - structure_format：推荐的标题层级、清单、对比表、FAQ 或步骤结构；
   - long_tail_terms：至少一个与问题直接相关的长尾词。
6. 不得把联网资料里的图片、广告口号、页面噪声或未经证实的信息当成用户问题。`
}

export function normalizeGeoQuestionOptimization(
  value: unknown,
  question: string,
  keyword: string,
): GeoQuestionOptimization {
  const source = record(value)
  const cleanKeyword = keyword.trim() || "核心关键词"
  const questionLongTail = question
    .replace(/[？?。！!]/g, "")
    .trim()
    .slice(0, 42)
  const suppliedTerms = stringList(source.long_tail_terms, 6)
  return {
    keyword_placement: String(
      source.keyword_placement
      || `标题或首段自然出现“${cleanKeyword}”，正文小标题按用户决策步骤展开`,
    ).trim(),
    conclusion_first: String(
      source.conclusion_first
      || "开头先直接回答用户问题，再补充判断依据、适用条件和行动建议",
    ).trim(),
    structure_format: String(
      source.structure_format
      || "使用清晰的 H2/H3、要点清单、必要的对比表和 FAQ",
    ).trim(),
    long_tail_terms: suppliedTerms.length > 0
      ? suppliedTerms
      : [questionLongTail || `${cleanKeyword}怎么选`],
  }
}

function normalizedQuestionText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”"'`，。！？?、；：:,.!()\[\]{}【】\s]/g, "")
    .replace(/(?:请问|想知道|到底|一般|通常|应该|需要|可以|是否)/g, "")
}

function questionBigrams(value: string): Set<string> {
  const compact = normalizedQuestionText(value)
  const grams = new Set<string>()
  if (compact.length <= 2) {
    if (compact) grams.add(compact)
    return grams
  }
  for (let index = 0; index < compact.length - 1; index += 1) {
    grams.add(compact.slice(index, index + 2))
  }
  return grams
}

export function areNearDuplicateQuestions(a: string, b: string): boolean {
  const normalizedA = normalizedQuestionText(a)
  const normalizedB = normalizedQuestionText(b)
  if (normalizedA && normalizedA === normalizedB) return true
  const left = questionBigrams(a)
  const right = questionBigrams(b)
  if (left.size === 0 || right.size === 0) return false
  let intersection = 0
  for (const gram of left) {
    if (right.has(gram)) intersection += 1
  }
  const union = left.size + right.size - intersection
  return union > 0 && intersection / union >= 0.84
}

export function auditKeywordStrategyPlan(
  plan: GeoStrategyPlan,
  research: KeywordStrategyResearchAudit,
  settings = plan.generation_settings,
): KeywordStrategyQualityAudit {
  const keywordGroups = [
    plan.keyword_strategy?.core_keywords || [],
    plan.keyword_strategy?.pain_advantage_keywords || [],
    plan.keyword_strategy?.weakness_conversion_keywords || [],
    plan.keyword_strategy?.scenario_keywords || [],
  ]
  const keys = new Set<string>()
  let keywordCount = 0
  let duplicateKeywordCount = 0
  let missingKeywordLogicCount = 0
  const searchableKeywordText: string[] = []

  for (const group of keywordGroups) {
    for (const item of group) {
      const keyword = String(item.keyword || "").trim()
      if (!keyword) continue
      keywordCount += 1
      const key = keyword.replace(/\s+/g, "").toLowerCase()
      searchableKeywordText.push(`${keyword}${String(item.logic || "")}`.replace(/\s+/g, "").toLowerCase())
      if (keys.has(key)) duplicateKeywordCount += 1
      else keys.add(key)
      if (!String(item.logic || "").trim()) missingKeywordLogicCount += 1
    }
  }

  const notes: string[] = []
  if (keywordCount === 0) notes.push("没有生成有效关键词")
  if (duplicateKeywordCount > 0) notes.push(`发现 ${duplicateKeywordCount} 个跨分组重复关键词`)
  if (missingKeywordLogicCount > 0) notes.push(`有 ${missingKeywordLogicCount} 个关键词缺少策略逻辑`)
  if (research.sources.length === 0) notes.push("没有可审计的联网来源")
  const customKeywords = settings?.custom_keywords || []
  const coveredCustomKeywordCount = customKeywords.filter(keyword => {
    const key = keyword.replace(/\s+/g, "").toLowerCase()
    return key && searchableKeywordText.some(item => item.includes(key))
  }).length
  if (coveredCustomKeywordCount < customKeywords.length) {
    notes.push(`有 ${customKeywords.length - coveredCustomKeywordCount} 个指定关键词未覆盖`)
  }

  return {
    checked_at: new Date().toISOString(),
    methodology_version: KEYWORD_STRATEGY_METHODOLOGY_VERSION,
    keyword_count: keywordCount,
    duplicate_keyword_count: duplicateKeywordCount,
    missing_keyword_logic_count: missingKeywordLogicCount,
    custom_keyword_count: customKeywords.length,
    covered_custom_keyword_count: coveredCustomKeywordCount,
    valid_source_count: research.sources.length,
    seven_category_ready: true,
    passed: keywordCount > 0
      && duplicateKeywordCount === 0
      && missingKeywordLogicCount === 0
      && coveredCustomKeywordCount === customKeywords.length
      && research.sources.length > 0,
    notes,
  }
}

export function buildResearchAudit(input: {
  model: string
  settings: KeywordStrategyGenerationSettings
  query: string
  raw: string
  event?: {
    searchExecuted?: boolean
    providerRequestId?: string
    sources?: unknown[]
  }
}): KeywordStrategyResearchAudit {
  const brief = parseKeywordResearchBrief(input.raw)
  return {
    methodology_version: KEYWORD_STRATEGY_METHODOLOGY_VERSION,
    provider: "doubao",
    model: input.model,
    target_region: input.settings.target_region,
    language_style: input.settings.language_style,
    searched_at: new Date().toISOString(),
    search_executed: input.event?.searchExecuted === true,
    provider_request_id: input.event?.providerRequestId,
    query: input.query,
    brief: brief.brief,
    user_language_patterns: brief.userLanguagePatterns,
    decision_signals: brief.decisionSignals,
    regional_expressions: brief.regionalExpressions,
    sources: normalizeKeywordResearchSources(input.event?.sources),
  }
}
