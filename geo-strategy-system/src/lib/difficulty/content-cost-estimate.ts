import type {
  DifficultyContentAllocation,
  DifficultyContentCostEstimate,
  DifficultyContentCostMilestone,
  DifficultyCostEstimate,
  DifficultyCostRange,
} from "@/types"

export const GEO_CONTENT_COST_MODEL = {
  version: "content-volume-v2" as const,
  foundationCost: 1_500,
  unitCosts: {
    selfMediaArticle: 3,
    authorityMediaArticle: 50,
    douyinVideo: 10,
  },
  contentRatios: {
    selfMediaArticles: 0.7,
    authorityMediaArticles: 0.2,
    douyinVideos: 0.1,
  },
  stableContentBase: 60,
  stableContentPerScore: 3.2,
  stableDaysBase: 30,
  stableDaysPerScore: 1.2,
} as const

const CONFIDENCE_UNCERTAINTY = {
  高: 0.1,
  中: 0.15,
  低: 0.2,
} as const

const MILESTONE_RULES = [
  {
    key: "firstMention" as const,
    label: "开始被 AI 提及",
    successDefinition: "至少 1 个目标模型在有效联网回答中提及品牌",
    contentRatio: 0.25,
    daysRatio: 0.25,
  },
  {
    key: "halfStable" as const,
    label: "提及稳定性达到 50%",
    successDefinition: "连续 2 次复测，问题与模型检测槽位的品牌提及率达到 50%",
    contentRatio: 0.6,
    daysRatio: 0.55,
  },
  {
    key: "stableMention" as const,
    label: "达到稳定提及",
    successDefinition: "连续 3 次复测达到 70% 以上，且提及率波动不超过 15%",
    contentRatio: 1,
    daysRatio: 1,
  },
] as const

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
}

function roundToFive(value: number): number {
  return Math.max(1, Math.round(value / 5) * 5)
}

function rangeAround(value: number, uncertainty: number, round: (input: number) => number): DifficultyCostRange {
  const min = round(value * (1 - uncertainty))
  const max = round(value * (1 + uncertainty))
  return { min, max: Math.max(min, max) }
}

export function allocateGeoContent(totalInput: number): DifficultyContentAllocation {
  const total = Math.max(0, Math.round(totalInput))
  const weighted = [
    { key: "selfMediaArticles" as const, weight: 7 },
    { key: "authorityMediaArticles" as const, weight: 2 },
    { key: "douyinVideos" as const, weight: 1 },
  ]
  const counts = {
    selfMediaArticles: Math.floor(total * weighted[0].weight / 10),
    authorityMediaArticles: Math.floor(total * weighted[1].weight / 10),
    douyinVideos: Math.floor(total * weighted[2].weight / 10),
  }
  let remaining = total - counts.selfMediaArticles - counts.authorityMediaArticles - counts.douyinVideos
  const byRemainder = weighted
    .map((item, index) => ({ ...item, index, remainder: total * item.weight % 10 }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
  for (let index = 0; index < remaining; index += 1) {
    counts[byRemainder[index % byRemainder.length].key] += 1
  }
  remaining = total - counts.selfMediaArticles - counts.authorityMediaArticles - counts.douyinVideos
  if (remaining !== 0) counts.selfMediaArticles += remaining
  return { total, ...counts }
}

export function geoContentExecutionCost(allocation: DifficultyContentAllocation): number {
  return GEO_CONTENT_COST_MODEL.foundationCost
    + allocation.selfMediaArticles * GEO_CONTENT_COST_MODEL.unitCosts.selfMediaArticle
    + allocation.authorityMediaArticles * GEO_CONTENT_COST_MODEL.unitCosts.authorityMediaArticle
    + allocation.douyinVideos * GEO_CONTENT_COST_MODEL.unitCosts.douyinVideo
}

export function estimateGeoContentCost(args: {
  totalScore: number
  confidence: DifficultyContentCostEstimate["confidence"]
  scopeLabel: string
  region: string
}): DifficultyContentCostEstimate {
  const score = clampScore(args.totalScore)
  const uncertainty = CONFIDENCE_UNCERTAINTY[args.confidence]
  const stableContent = roundToFive(
    GEO_CONTENT_COST_MODEL.stableContentBase + score * GEO_CONTENT_COST_MODEL.stableContentPerScore,
  )
  const stableDays = Math.max(
    7,
    Math.round(GEO_CONTENT_COST_MODEL.stableDaysBase + score * GEO_CONTENT_COST_MODEL.stableDaysPerScore),
  )
  let previousCost: DifficultyCostRange | null = null

  const milestones: DifficultyContentCostMilestone[] = MILESTONE_RULES.map(rule => {
    const recommendedContent = roundToFive(stableContent * rule.contentRatio)
    const contentRange = rangeAround(recommendedContent, uncertainty, roundToFive)
    const recommendedDays = Math.max(7, Math.round(stableDays * rule.daysRatio))
    const days = rangeAround(recommendedDays, uncertainty, value => Math.max(7, Math.round(value)))
    const allocation = allocateGeoContent(recommendedContent)
    const cumulativeCost = {
      min: geoContentExecutionCost(allocateGeoContent(contentRange.min)),
      max: geoContentExecutionCost(allocateGeoContent(contentRange.max)),
    }
    const incrementalCost = previousCost
      ? {
          min: Math.max(0, cumulativeCost.min - previousCost.min),
          max: Math.max(0, cumulativeCost.max - previousCost.max),
        }
      : { ...cumulativeCost }
    previousCost = cumulativeCost
    return {
      key: rule.key,
      label: rule.label,
      successDefinition: rule.successDefinition,
      days,
      contentCount: {
        ...contentRange,
        recommended: recommendedContent,
      },
      allocation,
      cumulativeCost,
      incrementalCost,
    }
  })

  return {
    version: GEO_CONTENT_COST_MODEL.version,
    currency: "CNY",
    confidence: args.confidence,
    foundationCost: GEO_CONTENT_COST_MODEL.foundationCost,
    unitCosts: { ...GEO_CONTENT_COST_MODEL.unitCosts },
    contentRatios: { ...GEO_CONTENT_COST_MODEL.contentRatios },
    milestones,
    assumptions: [
      `难度总分 ${Math.round(score)}/100 已包含地域、竞品、商业价值和资产缺口，本成本模型不再重复乘这些系数。`,
      `按${args.scopeLabel}范围（${args.region || "未指定具体地区"}）测算，内容总量随难度分连续增长。`,
      "发文结构按自媒体 70%、权威媒体 20%、抖音视频 10% 分配。",
      "单价按自媒体文章 3 元/篇、权威媒体文章 50 元/篇、抖音视频 10 元/个计算。",
      "官网及第三方站基础建设合计 1500 元，仅计一次；三个阶段均为累计投入，不能相加。",
      "该测算不含付费广告、代运营人力、拍摄制作和线下活动费用，不构成效果承诺。",
    ],
  }
}

export function isContentVolumeCostEstimate(
  estimate: DifficultyCostEstimate | null | undefined,
): estimate is DifficultyContentCostEstimate {
  return Boolean(
    estimate
      && "version" in estimate
      && estimate.version === GEO_CONTENT_COST_MODEL.version
      && Array.isArray((estimate as DifficultyContentCostEstimate).milestones),
  )
}
