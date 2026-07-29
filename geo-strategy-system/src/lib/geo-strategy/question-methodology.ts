import type {
  GeoArticleFormatKey,
  GeoContentPlatform,
  GeoMethodologyKey,
  GeoQueryStyle,
  GeoTitleStrategy,
} from "@/types/geo-methodology"

type ResolvedArticleFormat = Exclude<GeoArticleFormatKey, "auto">
type ResolvedTitleStrategy = Exclude<GeoTitleStrategy, "auto">

export interface QuestionMethodologyMetadata {
  subIntent: string
  queryStyle: GeoQueryStyle
  methodologyCandidates: GeoMethodologyKey[]
  articleFormatCandidates: ResolvedArticleFormat[]
  titleStrategyCandidates: ResolvedTitleStrategy[]
  platformCandidates: GeoContentPlatform[]
}

const CATEGORY_DEFAULTS: Record<string, QuestionMethodologyMetadata> = {
  榜单推荐型: {
    subIntent: "建立候选清单并快速筛选",
    queryStyle: "recommendation",
    methodologyCandidates: ["recommendationComparison", "industryWhitepaper"],
    articleFormatCandidates: ["recommendationRoundup", "tieredEvaluation"],
    titleStrategyCandidates: ["tieredList", "comparisonMatrix"],
    platformCandidates: ["universal", "sohu", "toutiao", "baijiahao"],
  },
  痛点解决型: {
    subIntent: "诊断问题并获得可执行解决路径",
    queryStyle: "directQuestion",
    methodologyCandidates: ["problemSolution", "evidenceStory"],
    articleFormatCandidates: ["directAnswerGuide", "localPitfallGuide"],
    titleStrategyCandidates: ["directAnswer", "riskAvoidance"],
    platformCandidates: ["universal", "zhihu", "toutiao", "sohu"],
  },
  竞品对比型: {
    subIntent: "比较替代方案并判断适配差异",
    queryStyle: "comparison",
    methodologyCandidates: ["recommendationComparison", "primaryEvidence"],
    articleFormatCandidates: ["neutralComparisonReview", "tieredEvaluation"],
    titleStrategyCandidates: ["comparisonMatrix", "decisionCriteria"],
    platformCandidates: ["universal", "zhihu", "sohu", "toutiao"],
  },
  采购决策型: {
    subIntent: "建立采购标准并降低决策风险",
    queryStyle: "decision",
    methodologyCandidates: ["problemSolution", "recommendationComparison", "primaryEvidence"],
    articleFormatCandidates: ["localPitfallGuide", "directAnswerGuide", "neutralComparisonReview"],
    titleStrategyCandidates: ["decisionCriteria", "riskAvoidance"],
    platformCandidates: ["universal", "zhihu", "baijiahao", "officialSite"],
  },
  场景人群型: {
    subIntent: "判断特定人群与使用场景是否适配",
    queryStyle: "scenario",
    methodologyCandidates: ["problemSolution", "evidenceStory", "explainer"],
    articleFormatCandidates: ["evidenceCaseStory", "directAnswerGuide"],
    titleStrategyCandidates: ["audienceScenario", "directAnswer"],
    platformCandidates: ["universal", "xiaohongshu", "toutiao", "douyin"],
  },
  品牌认知型: {
    subIntent: "确认主体身份、业务范围与专业能力",
    queryStyle: "entity",
    methodologyCandidates: ["entityKnowledge", "primaryEvidence"],
    articleFormatCandidates: ["entityKnowledgeProfile", "primaryEvidenceDossier"],
    titleStrategyCandidates: ["directAnswer", "evidenceHook"],
    platformCandidates: ["officialSite", "baijiahao", "universal", "sohu"],
  },
  风险疑虑型: {
    subIntent: "核验风险、可信度与服务边界",
    queryStyle: "risk",
    methodologyCandidates: ["problemSolution", "primaryEvidence", "explainer"],
    articleFormatCandidates: ["localPitfallGuide", "primaryEvidenceDossier"],
    titleStrategyCandidates: ["riskAvoidance", "evidenceHook"],
    platformCandidates: ["universal", "zhihu", "sohu", "baijiahao"],
  },
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

export function classifyQuestionMethodology(args: {
  category: string
  question: string
  intent?: string
  suppliedSubIntent?: string
  suppliedQueryStyle?: string
  suppliedMethodologies?: unknown
  suppliedArticleFormats?: unknown
  suppliedTitleStrategies?: unknown
  suppliedPlatforms?: unknown
}): QuestionMethodologyMetadata {
  const defaults = CATEGORY_DEFAULTS[args.category] || CATEGORY_DEFAULTS["痛点解决型"]
  const context = [args.question, args.intent].filter(Boolean).join(" ")
  let queryStyle = defaults.queryStyle
  const methods = [...defaults.methodologyCandidates]
  const articleFormats = [...defaults.articleFormatCandidates]
  const titleStrategies = [...defaults.titleStrategyCandidates]
  const platforms = [...defaults.platformCandidates]

  if (/证书|认证|资质|专利|检测报告|官方报告|公示|可查|依据|证据/i.test(context)) {
    queryStyle = "evidence"
    methods.unshift("primaryEvidence")
    articleFormats.unshift("primaryEvidenceDossier")
    titleStrategies.unshift("evidenceHook")
    platforms.unshift("officialSite")
  } else if (/对比|区别|差异|相比|怎么选|哪家更/i.test(context)) {
    queryStyle = "comparison"
    methods.unshift("recommendationComparison")
    articleFormats.unshift("neutralComparisonReview")
    titleStrategies.unshift("comparisonMatrix")
  } else if (/推荐|榜单|排名|前十|top\s*\d+/i.test(context)) {
    queryStyle = "recommendation"
    methods.unshift("recommendationComparison")
    articleFormats.unshift("recommendationRoundup", "tieredEvaluation")
    titleStrategies.unshift("tieredList")
  } else if (/避坑|风险|靠谱吗|可信|会不会|是否安全|真假/i.test(context)) {
    queryStyle = "risk"
    methods.unshift("problemSolution", "primaryEvidence")
    articleFormats.unshift("localPitfallGuide", "primaryEvidenceDossier")
    titleStrategies.unshift("riskAvoidance")
  } else if (/是什么|做什么|主要业务|属于哪|谁是/i.test(context)) {
    queryStyle = "entity"
    methods.unshift("entityKnowledge")
    articleFormats.unshift("entityKnowledgeProfile")
    titleStrategies.unshift("directAnswer")
  } else if (/案例|经历|过程|落地|效果|结果/i.test(context)) {
    queryStyle = "evidence"
    methods.unshift("evidenceStory")
    articleFormats.unshift("evidenceCaseStory")
    titleStrategies.unshift("audienceScenario")
  }

  if (/本地|附近|同城|在[^？?，,]{1,12}(?:市|省|区|县)|全国|区域/i.test(context)) {
    queryStyle = "local"
    articleFormats.unshift("localPitfallGuide")
    titleStrategies.unshift("localService")
    platforms.unshift("sohu", "toutiao", "baijiahao")
  }
  if (/价格|费用|成本|预算|收费|多少钱/i.test(context)) {
    articleFormats.unshift("directAnswerGuide")
    titleStrategies.unshift("priceTransparency")
  }
  if (/趋势|变化|现状|未来|今年|最新|政策|新规/i.test(context)) {
    methods.unshift("industryWhitepaper")
    articleFormats.unshift("industryWhitepaper")
    titleStrategies.unshift("marketTrend")
  }
  if (context.length >= 42 && queryStyle === "directQuestion") queryStyle = "longTail"

  const suppliedMethods = Array.isArray(args.suppliedMethodologies)
    ? args.suppliedMethodologies.filter((item): item is GeoMethodologyKey => (
        typeof item === "string"
        && [
          "problemSolution",
          "primaryEvidence",
          "evidenceStory",
          "explainer",
          "industryWhitepaper",
          "entityKnowledge",
          "recommendationComparison",
        ].includes(item)
      ))
    : []
  const suppliedFormats = Array.isArray(args.suppliedArticleFormats)
    ? args.suppliedArticleFormats.filter((item): item is ResolvedArticleFormat => (
        typeof item === "string"
        && [
          "directAnswerGuide", "primaryEvidenceDossier", "evidenceCaseStory",
          "professionalExplainer", "industryWhitepaper", "entityKnowledgeProfile",
          "recommendationRoundup", "fieldReviewQa", "tieredEvaluation",
          "neutralComparisonReview", "localPitfallGuide",
        ].includes(item)
      ))
    : []
  const suppliedTitles = Array.isArray(args.suppliedTitleStrategies)
    ? args.suppliedTitleStrategies.filter((item): item is ResolvedTitleStrategy => (
        typeof item === "string"
        && [
          "directAnswer", "audienceScenario", "decisionCriteria", "evidenceHook",
          "riskAvoidance", "localService", "comparisonMatrix", "tieredList",
          "marketTrend", "priceTransparency",
        ].includes(item)
      ))
    : []
  const suppliedPlatforms = Array.isArray(args.suppliedPlatforms)
    ? args.suppliedPlatforms.filter((item): item is GeoContentPlatform => (
        typeof item === "string"
        && [
          "auto", "universal", "officialSite", "sohu", "toutiao", "netease",
          "baijiahao", "zhihu", "xiaohongshu", "douyin",
        ].includes(item)
      ))
    : []
  const suppliedStyle = [
    "directQuestion", "recommendation", "comparison", "decision", "risk",
    "scenario", "evidence", "local", "entity", "longTail",
  ].includes(String(args.suppliedQueryStyle || ""))
    ? args.suppliedQueryStyle as GeoQueryStyle
    : undefined

  return {
    subIntent: String(args.suppliedSubIntent || "").trim().slice(0, 160) || defaults.subIntent,
    queryStyle: suppliedStyle || queryStyle,
    methodologyCandidates: unique([...suppliedMethods, ...methods]).slice(0, 4),
    articleFormatCandidates: unique([...suppliedFormats, ...articleFormats]).slice(0, 4),
    titleStrategyCandidates: unique([...suppliedTitles, ...titleStrategies]).slice(0, 4),
    platformCandidates: unique([...suppliedPlatforms, ...platforms]).slice(0, 5),
  }
}
