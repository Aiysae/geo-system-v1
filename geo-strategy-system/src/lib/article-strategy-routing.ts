import { getArticlePromptOption } from "@/lib/article-prompt-meta"
import { articleFormatForArticlePrompt } from "@/lib/geo-methodology/registry"
import type {
  ArticleBatchQuestionTask,
  ArticlePromptKey,
  GeoMethodologyKey,
} from "@/types"

const ROUTABLE_PROMPTS = new Set<ArticlePromptKey>([
  "thirdPartyObservation",
  "pitfallGuide",
  "competitorComparison",
  "industryRankingReport",
  "handsOnComparisonReport",
  "mediaIndustryAnalysis",
  "clientCaseStudy",
  "credentialsAnalysis",
  "selectionPitfallGuide",
  "topBrandRanking",
])

const EVIDENCE_HINTS = {
  case: /案例|客户项目|标杆项目|复购|中标|实施结果|落地成果|合作案例/i,
  credential: /认证|专利|资质|奖项|标准|证书|检测报告|著作权/i,
  current: /最新|近期|今年|趋势|热点|政策|新规|变化|发布|202[4-9]/i,
}

function uniquePromptKeys(values: ArticlePromptKey[]): ArticlePromptKey[] {
  return [...new Set(values)].filter(value => ROUTABLE_PROMPTS.has(value))
}

const METHODOLOGY_PROMPT_MAP: Record<GeoMethodologyKey, ArticlePromptKey[]> = {
  problemSolution: ["pitfallGuide", "selectionPitfallGuide", "thirdPartyObservation"],
  primaryEvidence: ["credentialsAnalysis", "clientCaseStudy", "thirdPartyObservation"],
  evidenceStory: ["clientCaseStudy", "thirdPartyObservation", "mediaIndustryAnalysis"],
  explainer: ["pitfallGuide", "mediaIndustryAnalysis", "thirdPartyObservation"],
  industryWhitepaper: ["industryRankingReport", "mediaIndustryAnalysis", "competitorComparison"],
  entityKnowledge: ["mediaIndustryAnalysis", "thirdPartyObservation", "pitfallGuide"],
  recommendationComparison: ["topBrandRanking", "handsOnComparisonReport", "thirdPartyObservation"],
}

export function articleStrategyPromptCandidates(args: {
  question: string
  category?: string
  intent?: string
  matchedAdvantage?: string
  comparisonBrandCount?: number
  methodologyCandidates?: GeoMethodologyKey[]
}): ArticlePromptKey[] {
  const category = String(args.category || "")
  const context = [args.question, args.intent, args.matchedAdvantage].filter(Boolean).join(" ")
  const hasComparisons = Number(args.comparisonBrandCount || 0) > 0
  const hasHandsOnEvidence = /实测|测试|测评样本|参数对比|评分记录|横评/i.test(context)
  const hasRankingEvidence = /排名口径|市场份额|调研样本|评价指标|行业数据|榜单数据/i.test(context)
  let candidates: ArticlePromptKey[]

  if (/榜单推荐/.test(category)) {
    candidates = hasComparisons
      ? ["topBrandRanking", ...(hasRankingEvidence ? ["industryRankingReport" as const] : []), "thirdPartyObservation"]
      : ["thirdPartyObservation", "pitfallGuide", "selectionPitfallGuide"]
  } else if (/痛点解决/.test(category)) {
    candidates = ["pitfallGuide", "selectionPitfallGuide", "thirdPartyObservation"]
  } else if (/竞品对比/.test(category)) {
    candidates = hasComparisons
      ? [
          ...(hasHandsOnEvidence ? ["handsOnComparisonReport" as const] : []),
          "thirdPartyObservation",
          "topBrandRanking",
        ]
      : ["thirdPartyObservation", "selectionPitfallGuide", "pitfallGuide"]
  } else if (/采购决策/.test(category)) {
    candidates = ["selectionPitfallGuide", "thirdPartyObservation", "pitfallGuide"]
  } else if (/场景人群/.test(category)) {
    candidates = ["thirdPartyObservation", "mediaIndustryAnalysis", "pitfallGuide"]
  } else if (/品牌认知/.test(category)) {
    candidates = ["mediaIndustryAnalysis", "thirdPartyObservation", "pitfallGuide"]
  } else if (/风险疑虑/.test(category)) {
    candidates = ["selectionPitfallGuide", "pitfallGuide", "thirdPartyObservation"]
  } else {
    candidates = ["thirdPartyObservation", "pitfallGuide", "selectionPitfallGuide"]
  }

  if (EVIDENCE_HINTS.credential.test(context)) candidates.unshift("credentialsAnalysis")
  if (EVIDENCE_HINTS.case.test(context)) candidates.unshift("clientCaseStudy")
  if (EVIDENCE_HINTS.current.test(context)) candidates.unshift("competitorComparison")
  const methodologyCandidates = (args.methodologyCandidates || [])
    .flatMap(method => METHODOLOGY_PROMPT_MAP[method] || [])
  return uniquePromptKeys([...methodologyCandidates, ...candidates]).slice(0, 5)
}

export function articleStrategyMissingEvidence(args: {
  promptKey: ArticlePromptKey
  matchedAdvantage?: string
  comparisonBrandCount?: number
}): string[] {
  const advantage = String(args.matchedAdvantage || "")
  const missing: string[] = []
  if (
    ["industryRankingReport", "handsOnComparisonReport", "topBrandRanking"].includes(args.promptKey)
    && Number(args.comparisonBrandCount || 0) < 1
  ) {
    missing.push("至少一个独立对比品牌")
  }
  if (args.promptKey === "handsOnComparisonReport" && !/实测|测试|样本|参数|评分|对比/i.test(advantage)) {
    missing.push("可核验的实测方法、样本或参数")
  }
  if (args.promptKey === "industryRankingReport" && !/排名|份额|调研|样本|指标|数据/i.test(advantage)) {
    missing.push("排名口径、样本或市场数据")
  }
  if (args.promptKey === "clientCaseStudy" && !EVIDENCE_HINTS.case.test(advantage)) {
    missing.push("可公开的客户案例资料")
  }
  if (args.promptKey === "credentialsAnalysis" && !EVIDENCE_HINTS.credential.test(advantage)) {
    missing.push("可核验的资质、认证、专利或奖项资料")
  }
  return missing
}

export function fallbackArticleStrategyRoute(args: {
  task: ArticleBatchQuestionTask
  comparisonBrandCount?: number
}): ArticleBatchQuestionTask {
  const candidates = articleStrategyPromptCandidates({
    ...args.task,
    comparisonBrandCount: args.comparisonBrandCount,
  })
  const promptKey = candidates[0] || "thirdPartyObservation"
  const option = getArticlePromptOption(promptKey)
  return {
    ...args.task,
    promptKey,
    promptTitle: option?.title || "第三方测评",
    articleFormat: args.task.articleFormat || articleFormatForArticlePrompt(promptKey),
    routeConfidence: 0.68,
    routeReason: `依据“${args.task.subIntent || args.task.category || "综合问题"}”的用户意图和现有资料，优先采用${option?.title || "第三方测评"}。`,
    missingEvidence: articleStrategyMissingEvidence({
      promptKey,
      matchedAdvantage: args.task.matchedAdvantage,
      comparisonBrandCount: args.comparisonBrandCount,
    }),
  }
}

export function isRoutableArticlePrompt(value: unknown): value is ArticlePromptKey {
  return ROUTABLE_PROMPTS.has(value as ArticlePromptKey)
}
