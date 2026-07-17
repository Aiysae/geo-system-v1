import type {
  DifficultyContentAllocation,
  DifficultyContentCostEstimate,
  DifficultyContentCostEstimateV3,
  DifficultyContentCostMilestone,
  DifficultyCostEstimate,
  DifficultyCostRange,
  DifficultyIndustryRiskLevel,
  DifficultyResolvedIndustryRiskLevel,
} from "@/types"

type ContentRatios = DifficultyContentCostEstimateV3["contentRatios"]

interface RiskProfileDefinition {
  label: string
  contentRatios: ContentRatios
  complianceMultiplier: number
  dailyThroughput: number
}

export const GEO_CONTENT_COST_MODEL = {
  version: "content-volume-v3" as const,
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
  scoreBands: [
    { level: "容易" as const, minScore: 0, maxScore: 24, anchorContent: 60, perPointGrowthRate: 0.02 },
    { level: "中等" as const, minScore: 25, maxScore: 49, anchorContent: 150, perPointGrowthRate: 0.03 },
    { level: "困难" as const, minScore: 50, maxScore: 74, anchorContent: 480, perPointGrowthRate: 0.035 },
    { level: "超难" as const, minScore: 75, maxScore: 100, anchorContent: 1_650, perPointGrowthRate: 0.04 },
  ],
} as const

const RISK_PROFILES: Record<DifficultyResolvedIndustryRiskLevel, RiskProfileDefinition> = {
  standard: {
    label: "普通行业",
    contentRatios: {
      selfMediaArticles: 0.7,
      authorityMediaArticles: 0.2,
      douyinVideos: 0.1,
    },
    complianceMultiplier: 1,
    dailyThroughput: 4,
  },
  high_trust: {
    label: "高信任决策行业",
    contentRatios: {
      selfMediaArticles: 0.6,
      authorityMediaArticles: 0.3,
      douyinVideos: 0.1,
    },
    complianceMultiplier: 1.1,
    dailyThroughput: 3.5,
  },
  regulated: {
    label: "强监管行业",
    contentRatios: {
      selfMediaArticles: 0.5,
      authorityMediaArticles: 0.4,
      douyinVideos: 0.1,
    },
    complianceMultiplier: 1.28,
    dailyThroughput: 3,
  },
  strict: {
    label: "严格监管行业",
    contentRatios: {
      selfMediaArticles: 0.4,
      authorityMediaArticles: 0.45,
      douyinVideos: 0.15,
    },
    complianceMultiplier: 1.46,
    dailyThroughput: 2.5,
  },
}

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
    validationBufferDays: 14,
  },
  {
    key: "halfStable" as const,
    label: "提及稳定性达到 50%",
    successDefinition: "连续 2 次复测，问题与模型检测槽位的品牌提及率达到 50%",
    contentRatio: 0.6,
    validationBufferDays: 30,
  },
  {
    key: "stableMention" as const,
    label: "达到稳定提及",
    successDefinition: "连续 3 次复测达到 70% 以上，且提及率波动不超过 15%",
    contentRatio: 1,
    validationBufferDays: 45,
  },
] as const

const STRICT_INDUSTRY_PATTERN =
  /(医疗|医药|药品|药械|制药|医院|诊所|体检|医美|金融|银行|证券|基金|期货|信托|贷款|借贷|融资担保|保险|支付|征信)/u
const REGULATED_INDUSTRY_PATTERN =
  /(法律|律师|司法|教育|培训|保健|养老|食品|消防|危化|化工|建筑资质)/u
const HIGH_TRUST_INDUSTRY_PATTERN =
  /(装修|家装|全屋定制|汽车|房产|房地产|工业设备|机械设备|企业服务|母婴|珠宝|留学)/u

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)))
}

function roundMultiplier(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

function rangeAround(
  value: number,
  uncertainty: number,
  round: (input: number) => number = Math.round,
): DifficultyCostRange {
  const min = Math.max(1, round(value * (1 - uncertainty)))
  const max = Math.max(min, round(value * (1 + uncertainty)))
  return { min, max }
}

function scoreBandFor(scoreInput: number) {
  const score = clampScore(scoreInput)
  return GEO_CONTENT_COST_MODEL.scoreBands.find(
    band => score >= band.minScore && score <= band.maxScore,
  ) ?? GEO_CONTENT_COST_MODEL.scoreBands[GEO_CONTENT_COST_MODEL.scoreBands.length - 1]
}

export function stableContentForScore(scoreInput: number): number {
  const score = clampScore(scoreInput)
  const band = scoreBandFor(score)
  return Math.round(
    band.anchorContent * Math.pow(1 + band.perPointGrowthRate, score - band.minScore),
  )
}

function weightedUnitCost(ratios: ContentRatios): number {
  return ratios.selfMediaArticles
      * GEO_CONTENT_COST_MODEL.unitCosts.selfMediaArticle
    + ratios.authorityMediaArticles
      * GEO_CONTENT_COST_MODEL.unitCosts.authorityMediaArticle
    + ratios.douyinVideos
      * GEO_CONTENT_COST_MODEL.unitCosts.douyinVideo
}

function baselineWeightedUnitCost(): number {
  return weightedUnitCost(GEO_CONTENT_COST_MODEL.contentRatios)
}

function valueMultiplierForAov(averageOrderValue: number | undefined): {
  multiplier: number
  reason: string
} {
  if (!averageOrderValue) {
    return { multiplier: 1, reason: "未取得可靠客单价，暂不增加高客单执行溢价" }
  }
  if (averageOrderValue <= 10_000) {
    return { multiplier: 1, reason: `平均客单价约 ${Math.round(averageOrderValue)} 元，采用普通执行标准` }
  }
  if (averageOrderValue <= 50_000) {
    return { multiplier: 1.15, reason: `平均客单价约 ${Math.round(averageOrderValue)} 元，增加 15% 高价值内容要求` }
  }
  if (averageOrderValue <= 200_000) {
    return { multiplier: 1.4, reason: `平均客单价约 ${Math.round(averageOrderValue)} 元，采用 1.4 倍高价值执行标准` }
  }
  if (averageOrderValue <= 1_000_000) {
    return { multiplier: 2, reason: `平均客单价约 ${Math.round(averageOrderValue)} 元，采用 2 倍重大决策执行标准` }
  }
  return { multiplier: 2.5, reason: `平均客单价约 ${Math.round(averageOrderValue)} 元，采用 2.5 倍超高价值执行标准` }
}

function resolveRiskLevel(args: {
  industry: string
  requestedLevel: DifficultyIndustryRiskLevel
  authorityBarrier?: number
}): {
  level: DifficultyResolvedIndustryRiskLevel
  source: "manual" | "system"
  reason: string
} {
  if (args.requestedLevel !== "auto") {
    const profile = RISK_PROFILES[args.requestedLevel]
    return {
      level: args.requestedLevel,
      source: "manual",
      reason: `用户手动选择“${profile.label}”`,
    }
  }

  const industry = args.industry.trim()
  const authorityBarrier = Number(args.authorityBarrier)
  if (STRICT_INDUSTRY_PATTERN.test(industry)) {
    return {
      level: "strict",
      source: "system",
      reason: `行业名称“${industry || "未填写"}”命中金融、医疗或其他严格监管类别`,
    }
  }
  if (Number.isFinite(authorityBarrier) && authorityBarrier >= 90) {
    return {
      level: "strict",
      source: "system",
      reason: `联网调研识别到权威信任门槛 ${Math.round(authorityBarrier)}/100，按严格监管标准测算`,
    }
  }
  if (REGULATED_INDUSTRY_PATTERN.test(industry)) {
    return {
      level: "regulated",
      source: "system",
      reason: `行业名称“${industry || "未填写"}”涉及资质、合规或专业审校要求`,
    }
  }
  if (Number.isFinite(authorityBarrier) && authorityBarrier >= 78) {
    return {
      level: "regulated",
      source: "system",
      reason: `联网调研识别到权威信任门槛 ${Math.round(authorityBarrier)}/100，按强监管标准测算`,
    }
  }
  if (HIGH_TRUST_INDUSTRY_PATTERN.test(industry)) {
    return {
      level: "high_trust",
      source: "system",
      reason: `行业名称“${industry || "未填写"}”属于高信任或长决策链类别`,
    }
  }
  if (Number.isFinite(authorityBarrier) && authorityBarrier >= 65) {
    return {
      level: "high_trust",
      source: "system",
      reason: `联网调研识别到权威信任门槛 ${Math.round(authorityBarrier)}/100，按高信任标准测算`,
    }
  }
  return {
    level: "standard",
    source: "system",
    reason: `行业“${industry || "未填写"}”暂未识别到显著监管或高信任门槛`,
  }
}

function blendedMultiplier(riskMultiplier: number, valueMultiplier: number): number {
  const higher = Math.max(riskMultiplier, valueMultiplier)
  const lower = Math.min(riskMultiplier, valueMultiplier)
  return roundMultiplier(Math.min(3.5, higher + Math.max(0, lower - 1) * 0.35))
}

function baseExecutionCostForContent(totalInput: number): number {
  const total = Math.max(0, Math.round(totalInput))
  return Math.round(
    GEO_CONTENT_COST_MODEL.foundationCost + total * baselineWeightedUnitCost(),
  )
}

function profiledExecutionCost(totalInput: number, multiplier: number): number {
  return Math.round(baseExecutionCostForContent(totalInput) * multiplier)
}

export function allocateGeoContent(
  totalInput: number,
  ratios: ContentRatios = GEO_CONTENT_COST_MODEL.contentRatios,
): DifficultyContentAllocation {
  const total = Math.max(0, Math.round(totalInput))
  const weighted = [
    { key: "selfMediaArticles" as const, weight: Math.max(0, ratios.selfMediaArticles) },
    { key: "authorityMediaArticles" as const, weight: Math.max(0, ratios.authorityMediaArticles) },
    { key: "douyinVideos" as const, weight: Math.max(0, ratios.douyinVideos) },
  ]
  const weightTotal = weighted.reduce((sum, item) => sum + item.weight, 0) || 1
  const rawCounts = weighted.map(item => total * item.weight / weightTotal)
  const counts = {
    selfMediaArticles: Math.floor(rawCounts[0]),
    authorityMediaArticles: Math.floor(rawCounts[1]),
    douyinVideos: Math.floor(rawCounts[2]),
  }
  const remaining = total
    - counts.selfMediaArticles
    - counts.authorityMediaArticles
    - counts.douyinVideos
  const byRemainder = weighted
    .map((item, index) => ({ ...item, index, remainder: rawCounts[index] - Math.floor(rawCounts[index]) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
  for (let index = 0; index < remaining; index += 1) {
    counts[byRemainder[index % byRemainder.length].key] += 1
  }
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
  industry?: string
  requestedRiskLevel?: DifficultyIndustryRiskLevel
  averageOrderValue?: number
  authorityBarrier?: number
}): DifficultyContentCostEstimateV3 {
  const score = clampScore(args.totalScore)
  const uncertainty = CONFIDENCE_UNCERTAINTY[args.confidence]
  const band = scoreBandFor(score)
  const stableContent = stableContentForScore(score)
  const requestedLevel = args.requestedRiskLevel ?? "auto"
  const resolvedRisk = resolveRiskLevel({
    industry: args.industry ?? "",
    requestedLevel,
    authorityBarrier: args.authorityBarrier,
  })
  const riskProfile = RISK_PROFILES[resolvedRisk.level]
  const valueProfile = valueMultiplierForAov(args.averageOrderValue)
  const riskMultiplier = Math.round(
    weightedUnitCost(riskProfile.contentRatios)
      * riskProfile.complianceMultiplier
      / baselineWeightedUnitCost()
      * 10,
  ) / 10
  const effectiveMultiplier = blendedMultiplier(
    riskMultiplier,
    valueProfile.multiplier,
  )
  const dailyThroughput = Math.max(
    1.5,
    riskProfile.dailyThroughput / Math.sqrt(valueProfile.multiplier),
  )
  let previousCost: DifficultyCostRange | null = null

  const milestones: DifficultyContentCostMilestone[] = MILESTONE_RULES.map(rule => {
    const recommendedContent = Math.max(1, Math.round(stableContent * rule.contentRatio))
    const contentRange = rangeAround(recommendedContent, uncertainty)
    const recommendedDays = rule.validationBufferDays
      + Math.ceil(recommendedContent / dailyThroughput)
    const days = rangeAround(recommendedDays, uncertainty)
    const allocation = allocateGeoContent(recommendedContent, riskProfile.contentRatios)
    const cumulativeCost = {
      min: profiledExecutionCost(contentRange.min, effectiveMultiplier),
      max: profiledExecutionCost(contentRange.max, effectiveMultiplier),
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
      recommendedCost: profiledExecutionCost(recommendedContent, effectiveMultiplier),
    }
  })

  const currentStableCost = profiledExecutionCost(stableContent, effectiveMultiplier)
  const nextScore = score < 100 ? score + 1 : null
  const nextStableContent = nextScore === null ? null : stableContentForScore(nextScore)
  const nextStableCost = nextStableContent === null
    ? null
    : profiledExecutionCost(nextStableContent, effectiveMultiplier)
  const nextLevelScore = band.maxScore < 100 ? band.maxScore + 1 : null
  const boundaryFromContent = nextLevelScore === null
    ? null
    : stableContentForScore(band.maxScore)
  const boundaryToContent = nextLevelScore === null
    ? null
    : stableContentForScore(nextLevelScore)
  const baselineUnitCost = baselineWeightedUnitCost()
  const formula = `${band.anchorContent} × ${(1 + band.perPointGrowthRate).toFixed(3)}^${score - band.minScore} = ${stableContent} 条`

  return {
    version: GEO_CONTENT_COST_MODEL.version,
    currency: "CNY",
    confidence: args.confidence,
    foundationCost: GEO_CONTENT_COST_MODEL.foundationCost,
    riskPreparationCost: Math.round(
      GEO_CONTENT_COST_MODEL.foundationCost * Math.max(0, effectiveMultiplier - 1),
    ),
    effectiveFoundationCost: Math.round(
      GEO_CONTENT_COST_MODEL.foundationCost * effectiveMultiplier,
    ),
    unitCosts: { ...GEO_CONTENT_COST_MODEL.unitCosts },
    contentRatios: { ...riskProfile.contentRatios },
    baselineWeightedUnitCost: baselineUnitCost,
    effectiveWeightedUnitCost: Math.round(baselineUnitCost * effectiveMultiplier * 100) / 100,
    difficultyBand: {
      level: band.level,
      score,
      minScore: band.minScore,
      maxScore: band.maxScore,
      anchorContent: band.anchorContent,
      scoreOffset: score - band.minScore,
      perPointGrowthRate: band.perPointGrowthRate,
      stableContent,
      formula,
      nextScoreImpact: nextScore !== null && nextStableContent !== null && nextStableCost !== null
        ? {
            fromScore: score,
            toScore: nextScore,
            contentDelta: nextStableContent - stableContent,
            costDelta: nextStableCost - currentStableCost,
          }
        : undefined,
      nextLevelTransition: nextLevelScore !== null
        && boundaryFromContent !== null
        && boundaryToContent !== null
        ? {
            fromScore: band.maxScore,
            toScore: nextLevelScore,
            fromContent: boundaryFromContent,
            toContent: boundaryToContent,
            contentDelta: boundaryToContent - boundaryFromContent,
            costDelta: profiledExecutionCost(boundaryToContent, effectiveMultiplier)
              - profiledExecutionCost(boundaryFromContent, effectiveMultiplier),
          }
        : undefined,
    },
    industryProfile: {
      requestedLevel,
      resolvedLevel: resolvedRisk.level,
      label: riskProfile.label,
      source: resolvedRisk.source,
      reason: resolvedRisk.reason,
      riskMultiplier,
      valueMultiplier: valueProfile.multiplier,
      effectiveMultiplier,
      complianceMultiplier: riskProfile.complianceMultiplier,
      dailyThroughput: Math.round(dailyThroughput * 10) / 10,
      averageOrderValue: args.averageOrderValue,
      valueReason: valueProfile.reason,
    },
    milestones,
    assumptions: [
      `难度 ${score}/100 属于${band.level}档（${band.minScore}-${band.maxScore} 分），稳定内容量按 ${formula} 逐分复合增长。`,
      `行业按“${riskProfile.label}”测算，渠道结构与合规审校共同形成 ${riskMultiplier} 倍行业系数；${resolvedRisk.reason}。`,
      `${valueProfile.reason}；行业与客单价重叠时取较高项为主并有限叠加，综合系数封顶 3.5 倍。`,
      `发文结构按自媒体 ${Math.round(riskProfile.contentRatios.selfMediaArticles * 100)}%、权威媒体 ${Math.round(riskProfile.contentRatios.authorityMediaArticles * 100)}%、抖音视频 ${Math.round(riskProfile.contentRatios.douyinVideos * 100)}% 分配。`,
      "基准单价为自媒体文章 3 元/篇、权威媒体文章 50 元/篇、抖音视频 10 元/个。",
      `官网及第三方站基础建设为 1500 元；行业溢价另列信任与合规准备成本 ${Math.round(GEO_CONTENT_COST_MODEL.foundationCost * Math.max(0, effectiveMultiplier - 1))} 元。`,
      `按${args.scopeLabel}范围（${args.region || "未指定具体地区"}）测算；周期由内容量、发布能力和复测缓冲期共同决定。`,
      "三个阶段均为累计投入，不能相加；测算不含付费广告、代运营人力、拍摄制作和线下活动费用，不构成效果承诺。",
    ],
  }
}

export function isContentVolumeCostEstimate(
  estimate: DifficultyCostEstimate | null | undefined,
): estimate is DifficultyContentCostEstimate {
  return Boolean(
    estimate
      && "version" in estimate
      && (estimate.version === "content-volume-v2" || estimate.version === "content-volume-v3")
      && Array.isArray((estimate as DifficultyContentCostEstimate).milestones),
  )
}

export function isContentVolumeV3CostEstimate(
  estimate: DifficultyCostEstimate | null | undefined,
): estimate is DifficultyContentCostEstimateV3 {
  return Boolean(
    isContentVolumeCostEstimate(estimate)
      && estimate.version === "content-volume-v3",
  )
}
