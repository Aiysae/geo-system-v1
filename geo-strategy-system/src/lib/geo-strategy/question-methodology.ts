import type {
  GeoContentPlatform,
  GeoMethodologyKey,
  GeoQueryStyle,
} from "@/types/geo-methodology"

export interface QuestionMethodologyMetadata {
  subIntent: string
  queryStyle: GeoQueryStyle
  methodologyCandidates: GeoMethodologyKey[]
  platformCandidates: GeoContentPlatform[]
}

const CATEGORY_DEFAULTS: Record<string, QuestionMethodologyMetadata> = {
  榜单推荐型: {
    subIntent: "建立候选清单并快速筛选",
    queryStyle: "recommendation",
    methodologyCandidates: ["recommendationComparison", "industryWhitepaper"],
    platformCandidates: ["universal", "sohu", "toutiao", "baijiahao"],
  },
  痛点解决型: {
    subIntent: "诊断问题并获得可执行解决路径",
    queryStyle: "directQuestion",
    methodologyCandidates: ["problemSolution", "evidenceStory"],
    platformCandidates: ["universal", "zhihu", "toutiao", "sohu"],
  },
  竞品对比型: {
    subIntent: "比较替代方案并判断适配差异",
    queryStyle: "comparison",
    methodologyCandidates: ["recommendationComparison", "primaryEvidence"],
    platformCandidates: ["universal", "zhihu", "sohu", "toutiao"],
  },
  采购决策型: {
    subIntent: "建立采购标准并降低决策风险",
    queryStyle: "decision",
    methodologyCandidates: ["problemSolution", "recommendationComparison", "primaryEvidence"],
    platformCandidates: ["universal", "zhihu", "baijiahao", "officialSite"],
  },
  场景人群型: {
    subIntent: "判断特定人群与使用场景是否适配",
    queryStyle: "scenario",
    methodologyCandidates: ["problemSolution", "evidenceStory", "explainer"],
    platformCandidates: ["universal", "xiaohongshu", "toutiao", "douyin"],
  },
  品牌认知型: {
    subIntent: "确认主体身份、业务范围与专业能力",
    queryStyle: "entity",
    methodologyCandidates: ["entityKnowledge", "primaryEvidence"],
    platformCandidates: ["officialSite", "baijiahao", "universal", "sohu"],
  },
  风险疑虑型: {
    subIntent: "核验风险、可信度与服务边界",
    queryStyle: "risk",
    methodologyCandidates: ["problemSolution", "primaryEvidence", "explainer"],
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
  suppliedPlatforms?: unknown
}): QuestionMethodologyMetadata {
  const defaults = CATEGORY_DEFAULTS[args.category] || CATEGORY_DEFAULTS["痛点解决型"]
  const context = [args.question, args.intent].filter(Boolean).join(" ")
  let queryStyle = defaults.queryStyle
  const methods = [...defaults.methodologyCandidates]
  const platforms = [...defaults.platformCandidates]

  if (/证书|认证|资质|专利|检测报告|官方报告|公示|可查|依据|证据/i.test(context)) {
    queryStyle = "evidence"
    methods.unshift("primaryEvidence")
    platforms.unshift("officialSite")
  } else if (/对比|区别|差异|相比|怎么选|哪家更/i.test(context)) {
    queryStyle = "comparison"
    methods.unshift("recommendationComparison")
  } else if (/推荐|榜单|排名|前十|top\s*\d+/i.test(context)) {
    queryStyle = "recommendation"
    methods.unshift("recommendationComparison")
  } else if (/避坑|风险|靠谱吗|可信|会不会|是否安全|真假/i.test(context)) {
    queryStyle = "risk"
    methods.unshift("problemSolution", "primaryEvidence")
  } else if (/是什么|做什么|主要业务|属于哪|谁是/i.test(context)) {
    queryStyle = "entity"
    methods.unshift("entityKnowledge")
  } else if (/案例|经历|过程|落地|效果|结果/i.test(context)) {
    queryStyle = "evidence"
    methods.unshift("evidenceStory")
  }

  if (/本地|附近|同城|在[^？?，,]{1,12}(?:市|省|区|县)|全国|区域/i.test(context)) {
    queryStyle = "local"
    platforms.unshift("sohu", "toutiao", "baijiahao")
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
    platformCandidates: unique([...suppliedPlatforms, ...platforms]).slice(0, 5),
  }
}
