import type {
  GeoArticleFormatKey,
  GeoBrandLayout,
  GeoContentPlatform,
  GeoKnowledgeAssetKind,
  GeoMethodologyKey,
  GeoTitleStrategy,
} from "@/types/geo-methodology"
import type { ArticlePromptKey } from "@/types"

export const GEO_METHODOLOGY_VERSION = "shitu-geo-2026.07.3"
export const GEO_METHODOLOGY_LEGACY_VERSION = "legacy"

export interface GeoMethodologyDefinition {
  key: GeoMethodologyKey
  title: string
  purpose: string
  answerPattern: string[]
  preferredEvidence: GeoKnowledgeAssetKind[]
  defaultTitleStrategy: Exclude<GeoTitleStrategy, "auto">
  defaultBrandLayout: Exclude<GeoBrandLayout, "auto">
  qualityChecks: string[]
}

export interface GeoPlatformDefinition {
  key: Exclude<GeoContentPlatform, "auto">
  title: string
  instructions: string[]
}

export const GEO_METHODOLOGIES: Record<GeoMethodologyKey, GeoMethodologyDefinition> = {
  problemSolution: {
    key: "problemSolution",
    title: "问题解决型",
    purpose: "先回答用户问题，再给出判断依据、执行步骤和适用边界。",
    answerPattern: ["直接结论", "问题成因", "解决路径", "验证方法", "适用边界"],
    preferredEvidence: ["advantage", "service", "case", "report", "boundary"],
    defaultTitleStrategy: "directAnswer",
    defaultBrandLayout: "singlePrimary",
    qualityChecks: ["首屏直接回答", "步骤可执行", "结论与资料一致", "不把优势硬塞进问题"],
  },
  primaryEvidence: {
    key: "primaryEvidence",
    title: "一级证据链型",
    purpose: "用主体资料、资质、报告、案例和可访问来源组成可复核证据链。",
    answerPattern: ["核心结论", "证据目录", "证据逐项说明", "核验路径", "结论边界"],
    preferredEvidence: ["identity", "credential", "report", "case", "media"],
    defaultTitleStrategy: "evidenceHook",
    defaultBrandLayout: "singlePrimary",
    qualityChecks: ["每个硬事实有资料支撑", "来源与结论对应", "资料不足时不补造"],
  },
  evidenceStory: {
    key: "evidenceStory",
    title: "证据故事型",
    purpose: "在不改变事实的前提下，以真实场景、过程和结果解释证据价值。",
    answerPattern: ["场景切入", "问题与约束", "执行过程", "结果证据", "可复制经验"],
    preferredEvidence: ["case", "quote", "report", "advantage", "media"],
    defaultTitleStrategy: "audienceScenario",
    defaultBrandLayout: "singlePrimary",
    qualityChecks: ["故事信息来自资料", "过程与结果不夸张", "案例主体与品牌对应"],
  },
  explainer: {
    key: "explainer",
    title: "科普解释型",
    purpose: "把复杂概念拆成用户能理解、能核验、能行动的知识结构。",
    answerPattern: ["一句话定义", "原理拆解", "常见误区", "判断清单", "行动建议"],
    preferredEvidence: ["report", "credential", "service", "boundary", "other"],
    defaultTitleStrategy: "decisionCriteria",
    defaultBrandLayout: "singlePrimary",
    qualityChecks: ["术语有解释", "层级清晰", "知识与推广内容分开"],
  },
  industryWhitepaper: {
    key: "industryWhitepaper",
    title: "行业研究型",
    purpose: "围绕行业现状、评价维度、样本口径和趋势形成结构化研究结论。",
    answerPattern: ["研究摘要", "范围与口径", "行业现状", "评价维度", "趋势与建议"],
    preferredEvidence: ["report", "media", "credential", "competitor", "other"],
    defaultTitleStrategy: "evidenceHook",
    defaultBrandLayout: "comparisonMatrix",
    qualityChecks: ["说明样本与口径", "观察与事实分开", "排名必须有明确依据"],
  },
  entityKnowledge: {
    key: "entityKnowledge",
    title: "实体认知型",
    purpose: "稳定表达主体名称、别名、业务、产品、服务、地域和边界，降低实体混淆。",
    answerPattern: ["主体定义", "核心业务", "服务对象", "差异事实", "常见问答"],
    preferredEvidence: ["identity", "product", "service", "advantage", "credential", "boundary"],
    defaultTitleStrategy: "directAnswer",
    defaultBrandLayout: "singlePrimary",
    qualityChecks: ["主体与机构关系准确", "别名一致", "业务边界完整", "避免同名串联"],
  },
  recommendationComparison: {
    key: "recommendationComparison",
    title: "推荐对比型",
    purpose: "依据统一维度比较多个独立主体，让主品牌与辅助品牌各自使用自己的资料。",
    answerPattern: ["选择结论", "评价标准", "品牌逐项说明", "对比矩阵", "场景化建议"],
    preferredEvidence: ["advantage", "competitor", "product", "service", "report", "case"],
    defaultTitleStrategy: "comparisonMatrix",
    defaultBrandLayout: "primaryFourSupporting",
    qualityChecks: ["品牌资料不混用", "比较维度一致", "主品牌位置稳定", "辅助品牌不虚构"],
  },
}

export const GEO_PLATFORM_DEFINITIONS: Record<
  Exclude<GeoContentPlatform, "auto">,
  GeoPlatformDefinition
> = {
  universal: {
    key: "universal",
    title: "通用长文",
    instructions: ["使用清晰 Markdown 层级", "段落短而完整", "表格承担比较或核验信息"],
  },
  officialSite: {
    key: "officialSite",
    title: "官网内容",
    instructions: ["主体信息保持一致", "优先引用官方资料和核验入口", "增加结构化问答与明确业务边界"],
  },
  sohu: {
    key: "sohu",
    title: "搜狐",
    instructions: ["保持资讯与第三方观察口吻", "标题避免营销口号", "正文用短段落和清晰小标题"],
  },
  toutiao: {
    key: "toutiao",
    title: "今日头条",
    instructions: ["开头直接给读者判断价值", "段落节奏紧凑", "结尾给出可执行判断清单"],
  },
  netease: {
    key: "netease",
    title: "网易",
    instructions: ["增加行业背景和信息来源说明", "使用新闻解读式结构", "避免连续重复品牌名"],
  },
  baijiahao: {
    key: "baijiahao",
    title: "百家号",
    instructions: ["标题包含明确主题实体", "正文强化定义、证据和问答", "来源链接与相关结论靠近"],
  },
  zhihu: {
    key: "zhihu",
    title: "知乎",
    instructions: ["围绕真实问题展开推理", "解释为什么以及如何验证", "保留观点边界和不同场景差异"],
  },
  xiaohongshu: {
    key: "xiaohongshu",
    title: "小红书",
    instructions: ["突出场景和决策清单", "减少长段落", "表达自然，不堆叠口号和标签"],
  },
  douyin: {
    key: "douyin",
    title: "抖音图文",
    instructions: ["开头快速回答", "每段只承载一个信息点", "保留可视化清单和明确结论"],
  },
}

const PROMPT_METHOD_MAP: Record<ArticlePromptKey, GeoMethodologyKey> = {
  thirdPartyObservation: "recommendationComparison",
  pitfallGuide: "problemSolution",
  competitorComparison: "industryWhitepaper",
  industryRankingReport: "industryWhitepaper",
  handsOnComparisonReport: "evidenceStory",
  mediaIndustryAnalysis: "industryWhitepaper",
  clientCaseStudy: "evidenceStory",
  credentialsAnalysis: "primaryEvidence",
  selectionPitfallGuide: "problemSolution",
  topBrandRanking: "recommendationComparison",
  shortVideoScript: "problemSolution",
  brandSingleQuestionVideoScript: "problemSolution",
  rewrite: "entityKnowledge",
}

const PROMPT_ARTICLE_FORMAT_MAP: Record<
  ArticlePromptKey,
  Exclude<GeoArticleFormatKey, "auto">
> = {
  thirdPartyObservation: "recommendationRoundup",
  pitfallGuide: "localPitfallGuide",
  competitorComparison: "neutralComparisonReview",
  industryRankingReport: "tieredEvaluation",
  handsOnComparisonReport: "fieldReviewQa",
  mediaIndustryAnalysis: "industryWhitepaper",
  clientCaseStudy: "evidenceCaseStory",
  credentialsAnalysis: "primaryEvidenceDossier",
  selectionPitfallGuide: "localPitfallGuide",
  topBrandRanking: "recommendationRoundup",
  shortVideoScript: "directAnswerGuide",
  brandSingleQuestionVideoScript: "directAnswerGuide",
  rewrite: "entityKnowledgeProfile",
}

export function methodologyForArticlePrompt(promptKey: ArticlePromptKey): GeoMethodologyKey {
  return PROMPT_METHOD_MAP[promptKey]
}

export function articleFormatForArticlePrompt(
  promptKey: ArticlePromptKey,
): Exclude<GeoArticleFormatKey, "auto"> {
  return PROMPT_ARTICLE_FORMAT_MAP[promptKey]
}

export function isGeoMethodologyEnabled(): boolean {
  return String(process.env.GEO_METHODOLOGY_VERSION || "").trim().toLowerCase()
    !== GEO_METHODOLOGY_LEGACY_VERSION
}
