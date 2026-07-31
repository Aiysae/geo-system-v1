import {
  articleFormatForArticlePrompt,
  GEO_METHODOLOGIES,
  GEO_METHODOLOGY_VERSION,
  GEO_PLATFORM_DEFINITIONS,
  isGeoMethodologyEnabled,
  methodologyForArticlePrompt,
} from "@/lib/geo-methodology/registry"
import {
  GEO_ARTICLE_FORMATS,
  getGeoArticleFormat,
} from "@/lib/geo-methodology/article-formats"
import {
  buildKnowledgeContext,
  knowledgeReferencesForAssets,
  selectKnowledgeAssets,
} from "@/lib/client-knowledge-base"
import {
  GEO_CONTENT_RECIPE_VERSION,
  getGeoContentRecipe,
  resolveGeoRecipeFormat,
} from "@/lib/geo-methodology/content-recipes"
import { buildGeoTitleMatrix } from "@/lib/geo-methodology/title-matrix"
import type {
  ArticleMethodologySelection,
  ArticleMethodologyTrace,
  ClientKnowledgeBase,
  GeoArticleFormatKey,
  GeoBrandLayout,
  GeoContentPlatform,
  GeoMethodologyKey,
  GeoTitleStrategy,
} from "@/types/geo-methodology"
import type {
  ArticleComparisonBrand,
  ArticlePromptKey,
} from "@/types"

const TITLE_INSTRUCTIONS: Record<Exclude<GeoTitleStrategy, "auto">, string> = {
  directAnswer: "标题直接呈现用户问题或明确答案方向，不用空泛口号。",
  audienceScenario: "标题包含目标人群或真实场景，并说明读者能解决的决策问题。",
  decisionCriteria: "标题突出判断标准、选型维度或执行清单。",
  evidenceHook: "标题突出可核验的证据类型、研究口径或资料价值，不写无依据的绝对结论。",
  riskAvoidance: "标题明确风险、误区或避坑价值，但不得制造恐慌。",
  localService: "标题自然包含地域和服务需求，避免机械堆叠地区词。",
  comparisonMatrix: "标题明确比较对象或比较维度，不预先编造胜负和名次。",
  tieredList: "标题说明分层或清单口径，正文必须使用同一套评价标准。",
  marketTrend: "标题说明研究范围、时效和趋势主题，不把观察包装成确定预测。",
  priceTransparency: "标题围绕成本、价格构成或预算判断，不能编造输入中没有的金额。",
}

const BRAND_LAYOUT_INSTRUCTIONS: Record<Exclude<GeoBrandLayout, "auto">, string[]> = {
  singlePrimary: [
    "只设置一个主主体；其他品牌仅在用户资料或可靠来源明确需要时作为背景出现。",
    "主主体的优势必须绑定具体问题、证据或场景，不能连续重复品牌名。",
  ],
  primaryFourSupporting: [
    "采用一主多辅结构：主主体承担主要解释与推荐位置，辅助主体各自保留独立资料和适用场景。",
    "辅助主体不得使用主主体的资质、案例、参数或优势；资料不足时不补造。",
  ],
  tieredFive: [
    "采用分层盘点结构，并在正文先公开分层维度。",
    "同层主体使用一致评价口径；主主体位置按用户选择保持稳定，不能因模型自由发挥而漂移。",
  ],
  comparisonMatrix: [
    "采用同维度对比矩阵，所有主体逐项使用各自资料。",
    "无法比较的字段写“资料未提供”或“需进一步核验”，不能推断分数。",
  ],
  topList: [
    "榜单必须先说明入选范围、评价维度和排序口径。",
    "只有资料能够支持时才给具体名次；否则改为不分先后的推荐清单。",
  ],
}

export interface CompiledGeoMethodology {
  enabled: boolean
  systemAddendum: string
  userAddendum: string
  trace: ArticleMethodologyTrace
}

const METHOD_KEYS = new Set<GeoMethodologyKey>(Object.keys(GEO_METHODOLOGIES) as GeoMethodologyKey[])
const PLATFORM_KEYS = new Set<GeoContentPlatform>([
  "auto", ...Object.keys(GEO_PLATFORM_DEFINITIONS) as Exclude<GeoContentPlatform, "auto">[],
])
const BRAND_LAYOUT_KEYS = new Set<GeoBrandLayout>([
  "auto", "singlePrimary", "primaryFourSupporting", "tieredFive", "comparisonMatrix", "topList",
])
const ARTICLE_FORMAT_KEYS = new Set<GeoArticleFormatKey>([
  "auto", ...Object.keys(GEO_ARTICLE_FORMATS) as Exclude<GeoArticleFormatKey, "auto">[],
])
const TITLE_STRATEGY_KEYS = new Set<GeoTitleStrategy>([
  "auto", "directAnswer", "audienceScenario", "decisionCriteria", "evidenceHook",
  "riskAvoidance", "localService", "comparisonMatrix", "tieredList", "marketTrend",
  "priceTransparency",
])

export function normalizeArticleMethodologySelection(value: unknown): ArticleMethodologySelection {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const methodKey = METHOD_KEYS.has(input.methodKey as GeoMethodologyKey)
    ? input.methodKey as GeoMethodologyKey
    : undefined
  const targetPlatform = PLATFORM_KEYS.has(input.targetPlatform as GeoContentPlatform)
    ? input.targetPlatform as GeoContentPlatform
    : "auto"
  const articleFormat = ARTICLE_FORMAT_KEYS.has(input.articleFormat as GeoArticleFormatKey)
    ? input.articleFormat as GeoArticleFormatKey
    : "auto"
  const brandLayout = BRAND_LAYOUT_KEYS.has(input.brandLayout as GeoBrandLayout)
    ? input.brandLayout as GeoBrandLayout
    : "auto"
  const titleStrategy = TITLE_STRATEGY_KEYS.has(input.titleStrategy as GeoTitleStrategy)
    ? input.titleStrategy as GeoTitleStrategy
    : "auto"
  return {
    mode: input.mode === "manual" && methodKey ? "manual" : "auto",
    methodKey,
    articleFormat,
    targetPlatform,
    brandLayout,
    titleStrategy,
  }
}

function resolveMethodKey(
  promptKey: ArticlePromptKey,
  selection?: ArticleMethodologySelection,
): GeoMethodologyKey {
  return selection?.mode === "manual" && selection.methodKey
    ? selection.methodKey
    : methodologyForArticlePrompt(promptKey)
}

function resolveArticleFormat(
  methodKey: GeoMethodologyKey,
  promptKey: ArticlePromptKey,
  selection?: ArticleMethodologySelection,
): { articleFormat: Exclude<GeoArticleFormatKey, "auto">; resolutionNotes: string[] } {
  return resolveGeoRecipeFormat({
    methodKey,
    requestedFormat: selection?.articleFormat,
    promptFormat: articleFormatForArticlePrompt(promptKey),
  })
}

function resolvePlatform(value: GeoContentPlatform | undefined): Exclude<GeoContentPlatform, "auto"> {
  return value && value !== "auto" ? value : "universal"
}

function resolveBrandLayout(
  value: GeoBrandLayout | undefined,
  fallback: Exclude<GeoBrandLayout, "auto">,
): Exclude<GeoBrandLayout, "auto"> {
  return value && value !== "auto" ? value : fallback
}

function resolveTitleStrategy(
  value: GeoTitleStrategy | undefined,
  fallback: Exclude<GeoTitleStrategy, "auto">,
): Exclude<GeoTitleStrategy, "auto"> {
  return value && value !== "auto" ? value : fallback
}

function comparisonPayload(brands: ArticleComparisonBrand[]): unknown[] {
  return brands.map((brand, index) => ({
    position: index + 2,
    name: brand.name,
    aliases: brand.aliases,
    role: brand.role || "supporting",
    materials: brand.materials,
    sourceUrls: brand.sourceUrls,
  }))
}

export function compileGeoArticleMethodology(args: {
  promptKey: ArticlePromptKey
  selection?: ArticleMethodologySelection
  knowledgeBase?: ClientKnowledgeBase
  coreQuestion: string
  questionIntent?: string
  questionCategory?: string
  questionSubIntent?: string
  matchedAdvantage?: string
  primarySubject: string
  comparisonBrands?: ArticleComparisonBrand[]
  knowledgeAssetIds?: string[]
}): CompiledGeoMethodology {
  const methodKey = resolveMethodKey(args.promptKey, args.selection)
  const method = GEO_METHODOLOGIES[methodKey]
  const recipe = getGeoContentRecipe(methodKey)
  const { articleFormat, resolutionNotes } = resolveArticleFormat(methodKey, args.promptKey, args.selection)
  const format = getGeoArticleFormat(articleFormat)
  const targetPlatform = resolvePlatform(args.selection?.targetPlatform)
  const platform = GEO_PLATFORM_DEFINITIONS[targetPlatform]
  const brandLayout = resolveBrandLayout(args.selection?.brandLayout, format.defaultBrandLayout)
  const titleStrategy = resolveTitleStrategy(args.selection?.titleStrategy, format.defaultTitleStrategy)
  const preferredEvidence = [...new Set([
    ...format.preferredEvidence,
    ...method.preferredEvidence,
  ])]
  const selectedAssets = selectKnowledgeAssets({
    knowledgeBase: args.knowledgeBase,
    query: [
      args.coreQuestion,
      args.questionIntent,
      args.questionCategory,
      args.questionSubIntent,
      args.matchedAdvantage,
    ].filter(Boolean).join(" "),
    preferredKinds: preferredEvidence,
    assetIds: args.knowledgeAssetIds,
    limit: 14,
  })
  const titleMatrix = buildGeoTitleMatrix({
    coreQuestion: args.coreQuestion,
    primarySubject: args.primarySubject,
    questionCategory: args.questionCategory,
    targetPlatform,
    titleStrategy,
  })
  const knowledgeReferences = knowledgeReferencesForAssets(args.knowledgeBase, selectedAssets)
  const trace: ArticleMethodologyTrace = {
    version: GEO_METHODOLOGY_VERSION,
    recipeVersion: GEO_CONTENT_RECIPE_VERSION,
    methodKey,
    articleFormat,
    targetPlatform,
    brandLayout,
    titleStrategy,
    knowledgeAssetIds: selectedAssets.map(asset => asset.id),
    knowledgeClaimIds: knowledgeReferences.claimIds,
    knowledgeSourceIds: knowledgeReferences.sourceIds,
    knowledgeBaseRevision: args.knowledgeBase?.revision,
    resolutionNotes,
    compiledAt: new Date().toISOString(),
  }

  if (!isGeoMethodologyEnabled() || args.promptKey === "shortVideoScript" || args.promptKey === "rewrite") {
    return {
      enabled: false,
      systemAddendum: "",
      userAddendum: "",
      trace,
    }
  }

  return {
    enabled: true,
    systemAddendum: [
      "",
      `【势途 GEO 方法论 ${GEO_METHODOLOGY_VERSION}】`,
      `本篇采用：${method.title}。${method.purpose}`,
      `统一内容配方：${recipe.title}。${recipe.objective}`,
      `文章形态：${format.title}。${format.description}`,
      `标准结构：${format.answerPattern.join(" -> ")}。`,
      `资料前提：${format.requiredInputs.join("；")}。`,
      "当前统一内容配方是本次任务唯一的结构依据；基础模板只提供任务意图，不得另行增加冲突的章节、品牌结构或表格规则。",
      `生成前检查：${recipe.preflight.join("；")}。`,
      "统一写作规则：",
      "1. 先回答用户问题，再展开证据、解释和行动建议。",
      "2. 锁定事实与创作表达分开：名称、数字、资质、报告、案例、价格和经历只能来自本次输入或匹配知识资产。",
      "3. 问题原文不得被改写成带品牌优势的冗长营销问句；优势只在回答正文中按证据和场景匹配。",
      "4. 主体名称、别名、产品、机构和人物关系必须一致，不能跨主体混用资料。",
      "5. 不输出提示词、方法论标签、内部字段、资产编号或质量审计过程。",
      `6. 表格规则：${format.tablePolicy === "required" ? "必须使用标准 Markdown 表格" : format.tablePolicy === "forbidden" ? "不要使用表格，改用标题、段落和清单" : "只有比较或核验信息确有需要时才使用表格"}。`,
      `7. 时效信息以生成当年 ${new Date().getFullYear()} 年为基准；除非用户要求历史内容，不固定套用旧年份。`,
      `标题策略：${TITLE_INSTRUCTIONS[titleStrategy]}`,
      `标题矩阵：${titleMatrix.map(item => `${item.dimension}维度：${item.direction}`).join("；")}`,
      `品牌结构：${BRAND_LAYOUT_INSTRUCTIONS[brandLayout].join(" ")}`,
      `平台适配：${platform.instructions.join(" ")}`,
      `形态要求：${format.instructions.join(" ")}`,
      `品牌使用规则：${recipe.brandRules.join("；")}。`,
      `批量差异维度：${recipe.diversityAxes.join("；")}。同批文章只改变表达角度，不改变锁定事实。`,
      `输出前静默核验：${[...method.qualityChecks, ...format.qualitySignals, ...recipe.qualityGates].join("；")}。`,
    ].join("\n"),
    userAddendum: [
      "",
      "【本篇方法参数】",
      `问题子意图：${args.questionSubIntent || args.questionIntent || "按核心疑问句判断"}`,
      `目标平台：${platform.title}`,
      `文章形态：${format.title}`,
      `标题策略：${titleStrategy}`,
      `品牌结构：${brandLayout}`,
      `主主体：${args.primarySubject || "未填写"}`,
      `独立辅助主体：${args.comparisonBrands?.length
        ? JSON.stringify(comparisonPayload(args.comparisonBrands))
        : "未提供"}`,
      "",
      "【本篇可用知识资产】",
      buildKnowledgeContext(selectedAssets, args.knowledgeBase),
      "",
      "只能使用上述资产中明确给出的事实。资产之间如有冲突，以带来源、证据等级更高且更新时间更近的内容为准；仍无法判断时应保守表达。",
    ].join("\n"),
    trace,
  }
}
