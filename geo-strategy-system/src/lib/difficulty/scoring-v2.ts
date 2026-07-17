import { isUsableBrandName, normalizeBrandKey } from "@/lib/brand-canonicalization"
import { estimateGeoContentCost } from "@/lib/difficulty/content-cost-estimate"
import type {
  DifficultyAssessmentMode,
  DifficultyCommercialInput,
  DifficultyContentCostEstimate,
  DifficultyDimensionResult,
  DifficultyGeographicScope,
  DifficultyLevel,
} from "@/types"

export interface DifficultyScoringSignals {
  competitorBrands: string[]
  estimatedCompetitorCount?: number
  giantIncumbentCount?: number
  topBrandConcentration?: number
  geographicComplexity?: number
  contentSaturation?: number
  authorityBarrier?: number
  sourceConcentration?: number
  aiEntryBarrier?: number
  targetVisibilityGap?: number
  trustAssetGap?: number
  contentAssetGap?: number
  localResourceGap?: number
  averageOrderValue?: number
  grossMarginRate?: number
  annualRepeatPurchases?: number
  marketSizeScore?: number
  competitorBudgetStrength?: number
  evidenceCoverage?: number
}

export interface DifficultyScoringV2Input {
  industry: string
  mode: DifficultyAssessmentMode
  scope: DifficultyGeographicScope
  region: string
  commercial?: DifficultyCommercialInput
  signals: DifficultyScoringSignals
}

export interface DifficultyScoringV2Result {
  dimensions: Record<string, DifficultyDimensionResult>
  totalScore: number
  level: DifficultyLevel
  stableMentionPeriod: string
  costEstimate: DifficultyContentCostEstimate
  canonicalCompetitors: string[]
  competitorCount: number
  commercialPressureIndex: number
}

const SCOPE_LABELS: Record<DifficultyGeographicScope, string> = {
  city: "单城市/区县",
  province: "单省",
  region: "跨省区域",
  national: "全国",
}

const SCOPE_SCORE_RANGES: Record<DifficultyGeographicScope, [number, number]> = {
  city: [2, 5],
  province: [6, 9],
  region: [10, 12],
  national: [13, 15],
}

function clamp(value: unknown, min = 0, max = 100, fallback = 50): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}

function rounded(value: number): number {
  return Math.round(value)
}

function asRate(value: unknown): number | undefined {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return undefined
  return Math.min(1, number > 1 ? number / 100 : number)
}

function positive(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function levelForScore(score: number, max: number): DifficultyLevel {
  const ratio = score / Math.max(1, max)
  if (ratio >= 0.78) return "超难"
  if (ratio >= 0.55) return "困难"
  if (ratio >= 0.28) return "中等"
  return "容易"
}

function totalLevel(score: number): DifficultyLevel {
  if (score >= 75) return "超难"
  if (score >= 50) return "困难"
  if (score >= 25) return "中等"
  return "容易"
}

function dimension(
  name: string,
  score: number,
  max: number,
  analysis: string,
): DifficultyDimensionResult {
  const normalized = rounded(clamp(score, 0, max, 0))
  return {
    name,
    score: normalized,
    max,
    level: levelForScore(normalized, max),
    analysis,
  }
}

function interpolate(value: number, points: Array<[number, number]>): number {
  if (value <= points[0][0]) return points[0][1]
  for (let index = 1; index < points.length; index++) {
    const [rightX, rightY] = points[index]
    const [leftX, leftY] = points[index - 1]
    if (value <= rightX) {
      const progress = (value - leftX) / Math.max(1, rightX - leftX)
      return leftY + (rightY - leftY) * progress
    }
  }
  return points[points.length - 1][1]
}

export function competitorDensityScore(count: number): number {
  const normalized = Math.max(0, Math.round(count))
  if (normalized <= 3) return normalized
  if (normalized <= 7) return rounded(interpolate(normalized, [[4, 4], [7, 6]]))
  if (normalized <= 15) return rounded(interpolate(normalized, [[8, 7], [15, 10]]))
  if (normalized <= 30) return rounded(interpolate(normalized, [[16, 11], [30, 13]]))
  return normalized <= 50 ? 14 : 15
}

export function geographicScopeScore(
  scope: DifficultyGeographicScope,
  complexity: number | undefined,
): number {
  const [min, max] = SCOPE_SCORE_RANGES[scope]
  return rounded(min + (max - min) * clamp(complexity, 0, 100, 50) / 100)
}

function canonicalCompetitors(values: string[]): string[] {
  const filtered = values
    .map(value => value.trim())
    .filter(value => value && isUsableBrandName(value))
  const keys = filtered.map(normalizeBrandKey)
  const parent = keys.map((_, index) => index)

  function find(index: number): number {
    if (parent[index] === index) return index
    parent[index] = find(parent[index])
    return parent[index]
  }

  function union(left: number, right: number) {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot
  }

  function mixedAliasParts(value: string): string[] {
    const cjk = value.match(/[\u3400-\u9fff]+/gu)?.join("") ?? ""
    const latin = value.match(/[a-z0-9]+/gi)?.join("").toLowerCase() ?? ""
    return [cjk, latin].filter(part => part.length >= 2)
  }

  function shouldMerge(left: string, right: string): boolean {
    const leftKey = normalizeBrandKey(left)
    const rightKey = normalizeBrandKey(right)
    if (!leftKey || !rightKey) return false
    if (leftKey === rightKey) return true
    const leftMixed = /[\u3400-\u9fff]/u.test(leftKey) && /[a-z]/i.test(leftKey)
    const rightMixed = /[\u3400-\u9fff]/u.test(rightKey) && /[a-z]/i.test(rightKey)
    if (leftMixed && mixedAliasParts(leftKey).includes(rightKey)) return true
    if (rightMixed && mixedAliasParts(rightKey).includes(leftKey)) return true
    return false
  }

  for (let left = 0; left < filtered.length; left++) {
    for (let right = left + 1; right < filtered.length; right++) {
      if (shouldMerge(filtered[left], filtered[right])) union(left, right)
    }
  }

  const groups = new Map<number, string[]>()
  for (let index = 0; index < filtered.length; index++) {
    const root = find(index)
    const group = groups.get(root) ?? []
    group.push(filtered[index])
    groups.set(root, group)
  }
  return Array.from(groups.values()).map(group => [...group].sort((left, right) => {
    const leftMixed = /[\u3400-\u9fff]/u.test(left) && /[a-z]/i.test(left)
    const rightMixed = /[\u3400-\u9fff]/u.test(right) && /[a-z]/i.test(right)
    if (leftMixed !== rightMixed) return leftMixed ? -1 : 1
    return right.length - left.length
  })[0])
}

function commercialPressure(
  signals: DifficultyScoringSignals,
  commercial: DifficultyCommercialInput | undefined,
): {
  index: number
  averageOrderValue?: number
  grossMarginRate?: number
  annualRepeatPurchases?: number
  userSupplied: boolean
} {
  const userAov = positive(commercial?.averageOrderValue)
  const userMargin = asRate(commercial?.grossMarginRate)
  const userRepeat = positive(commercial?.annualRepeatPurchases)
  const userRiskLevel = commercial?.riskLevel
  const averageOrderValue = userAov ?? positive(signals.averageOrderValue)
  const grossMarginRate = userMargin ?? asRate(signals.grossMarginRate)
  const annualRepeatPurchases = userRepeat ?? positive(signals.annualRepeatPurchases) ?? 1
  const marketSize = clamp(signals.marketSizeScore, 0, 100, 50)
  const competitorBudget = clamp(signals.competitorBudgetStrength, 0, 100, 50)
  const grossProfitKnown = Boolean(averageOrderValue && grossMarginRate)
  const annualGrossProfit = grossProfitKnown
    ? averageOrderValue! * grossMarginRate! * Math.max(1, annualRepeatPurchases)
    : 0
  const grossProfitScore = grossProfitKnown
    ? interpolate(annualGrossProfit, [
        [0, 5],
        [100, 12],
        [500, 28],
        [2_000, 50],
        [10_000, 76],
        [50_000, 94],
        [200_000, 100],
      ])
    : (marketSize + competitorBudget) / 2
  let index = grossProfitScore * 0.42 + marketSize * 0.24 + competitorBudget * 0.34
  const giantCount = rounded(clamp(signals.giantIncumbentCount, 0, 20, 0))
  if (giantCount >= 3) index = Math.max(index, 74)
  else if (giantCount >= 1) index = Math.max(index, 62)
  return {
    index: rounded(clamp(index, 0, 100, 50)),
    averageOrderValue,
    grossMarginRate,
    annualRepeatPurchases,
    userSupplied: Boolean(
      userAov
      || userMargin
      || userRepeat
      || (userRiskLevel && userRiskLevel !== "auto"),
    ),
  }
}

function estimateCost(args: {
  input: DifficultyScoringV2Input
  totalScore: number
  commercial: ReturnType<typeof commercialPressure>
}): DifficultyContentCostEstimate {
  const coverage = clamp(args.input.signals.evidenceCoverage, 0, 100, 35)
  const confidence: DifficultyContentCostEstimate["confidence"] =
    args.commercial.userSupplied && coverage >= 65 ? "高" : coverage >= 45 ? "中" : "低"
  return estimateGeoContentCost({
    totalScore: args.totalScore,
    confidence,
    scopeLabel: SCOPE_LABELS[args.input.scope],
    region: args.input.region,
    industry: args.input.industry,
    requestedRiskLevel: args.input.commercial?.riskLevel,
    averageOrderValue: args.commercial.averageOrderValue,
    authorityBarrier: args.input.signals.authorityBarrier,
  })
}

function industryDimensions(args: {
  input: DifficultyScoringV2Input
  competitorCount: number
  commercial: ReturnType<typeof commercialPressure>
}): Record<string, DifficultyDimensionResult> {
  const { input, competitorCount, commercial } = args
  const signals = input.signals
  const giantCount = rounded(clamp(signals.giantIncumbentCount, 0, 20, 0))
  const concentration = clamp(signals.topBrandConcentration, 0, 100, 45)
  let headLockIndex = concentration * 0.76 + Math.min(100, giantCount * 28) * 0.24
  if (giantCount >= 3) headLockIndex = Math.max(headLockIndex, 82)
  else if (giantCount >= 1) headLockIndex = Math.max(headLockIndex, 65)
  const scopeScore = geographicScopeScore(input.scope, signals.geographicComplexity)
  const sourceAndEntry = clamp(signals.sourceConcentration, 0, 100, 50) * 0.42
    + clamp(signals.aiEntryBarrier, 0, 100, 50) * 0.58

  return {
    dimension1: dimension(
      "头部品牌锁定强度",
      headLockIndex / 100 * 15,
      15,
      `头部集中度按 ${rounded(concentration)}% 计，识别到 ${giantCount} 个强势头部主体；头部越稳定占位，进入核心答案越难。`,
    ),
    dimension2: dimension(
      "有效竞品密度",
      competitorDensityScore(competitorCount),
      15,
      `品牌别名合并后按 ${competitorCount} 个有效竞争主体计分。竞品越多，内容、信源和推荐位争夺越激烈。`,
    ),
    dimension3: dimension(
      "地域覆盖复杂度",
      scopeScore,
      15,
      `本次范围为${SCOPE_LABELS[input.scope]}（${input.region || "未指定具体地区"}）。地域得分采用固定递增区间，确保同条件下全国高于跨省、跨省高于单省、单省高于单城市。`,
    ),
    dimension4: dimension(
      "商业价值与预算竞争",
      commercial.index / 100 * 20,
      20,
      `综合客单价、毛利、复购、市场规模与竞品预算强度，商业竞争指数为 ${commercial.index}/100；高利润、高客单和强势大厂会直接抬高该项。`,
    ),
    dimension5: dimension(
      "内容供给饱和度",
      clamp(signals.contentSaturation, 0, 100, 50) / 100 * 15,
      15,
      "按公开内容数量、重复度、榜单/批量内容占比和可持续选题空间折算；内容越饱和，新增内容越难形成差异。",
    ),
    dimension6: dimension(
      "权威信任门槛",
      clamp(signals.authorityBarrier, 0, 100, 50) / 100 * 10,
      10,
      "按资质、案例、媒体、标准、专家和第三方验证要求折算；越依赖强背书，进入推荐池的前置成本越高。",
    ),
    dimension7: dimension(
      "信源与 AI 入口壁垒",
      sourceAndEntry / 100 * 10,
      10,
      "综合主要信源集中度和 AI 答案进入门槛计算；少数渠道长期控制答案时，需要更长的多渠道建设周期。",
    ),
  }
}

function brandDimensions(args: {
  input: DifficultyScoringV2Input
  competitorCount: number
  commercial: ReturnType<typeof commercialPressure>
}): Record<string, DifficultyDimensionResult> {
  const { input, competitorCount, commercial } = args
  const signals = input.signals
  const giantCount = rounded(clamp(signals.giantIncumbentCount, 0, 20, 0))
  const concentration = clamp(signals.topBrandConcentration, 0, 100, 45)
  let headLockIndex = concentration * 0.76 + Math.min(100, giantCount * 28) * 0.24
  if (giantCount >= 3) headLockIndex = Math.max(headLockIndex, 82)
  else if (giantCount >= 1) headLockIndex = Math.max(headLockIndex, 65)
  const densityIndex = competitorDensityScore(competitorCount) / 15 * 100
  const competitionIndex = headLockIndex * 0.72 + densityIndex * 0.28
  const scopeBase = geographicScopeScore(input.scope, signals.geographicComplexity)
  const localGap = clamp(signals.localResourceGap, 0, 100, 50)
  const geographyIndex = Math.min(15, scopeBase * 0.68 + localGap / 100 * 15 * 0.32)

  return {
    dimension1: dimension(
      "行业竞争与头部封锁",
      competitionIndex / 100 * 15,
      15,
      `头部集中度按 ${rounded(concentration)}% 计，识别 ${giantCount} 个强势主体和 ${competitorCount} 个有效竞争主体；竞品越多、头部锁定越强，该项得分越高。`,
    ),
    dimension2: dimension(
      "目标品牌可见度差距",
      clamp(signals.targetVisibilityGap, 0, 100, 55) / 100 * 15,
      15,
      "对比目标品牌与头部竞品在搜索结果、AI 提及、官网收录和第三方引用上的差距，差距越大得分越高。",
    ),
    dimension3: dimension(
      "信任资产差距",
      clamp(signals.trustAssetGap, 0, 100, 55) / 100 * 15,
      15,
      "按资质、真实案例、客户评价、媒体和第三方验证与头部竞品的差距折算。",
    ),
    dimension4: dimension(
      "内容矩阵缺口",
      clamp(signals.contentAssetGap, 0, 100, 55) / 100 * 15,
      15,
      "按官网、问答、案例、对比、场景和区域内容的完整度反向计分，缺口越大，前期建设量越高。",
    ),
    dimension5: dimension(
      "地域覆盖与本地资源差距",
      geographyIndex,
      15,
      `本次范围为${SCOPE_LABELS[input.scope]}（${input.region || "未指定具体地区"}），同时计入地图、门店、本地案例和区域媒体等资源差距。`,
    ),
    dimension6: dimension(
      "商业预算竞争压力",
      commercial.index / 100 * 15,
      15,
      `商业竞争指数为 ${commercial.index}/100。高客单、高毛利、强复购或大厂密集的赛道，会产生更高的内容和信源争夺预算。`,
    ),
    dimension7: dimension(
      "AI 答案进入门槛",
      clamp(signals.aiEntryBarrier, 0, 100, 55) / 100 * 10,
      10,
      "衡量目标品牌从可检索到被稳定引用、再到进入推荐答案的综合门槛。",
    ),
  }
}

export function scoreDifficultyV2(input: DifficultyScoringV2Input): DifficultyScoringV2Result {
  const canonical = canonicalCompetitors(input.signals.competitorBrands)
  const estimatedCount = rounded(clamp(input.signals.estimatedCompetitorCount, 0, 500, canonical.length))
  const competitorCount = Math.max(canonical.length, estimatedCount)
  const commercial = commercialPressure(input.signals, input.commercial)
  const dimensions = input.mode === "brand"
    ? brandDimensions({ input, competitorCount, commercial })
    : industryDimensions({ input, competitorCount, commercial })
  const totalScore = Object.values(dimensions).reduce((sum, item) => sum + item.score, 0)
  const costEstimate = estimateCost({ input, totalScore, commercial })
  const stableMilestone = costEstimate.milestones.find(item => item.key === "stableMention")

  return {
    dimensions,
    totalScore,
    level: totalLevel(totalScore),
    stableMentionPeriod: stableMilestone
      ? `约${stableMilestone.days.min}-${stableMilestone.days.max}天`
      : "待测算",
    costEstimate,
    canonicalCompetitors: canonical,
    competitorCount,
    commercialPressureIndex: commercial.index,
  }
}

export function difficultyScopeLabel(scope: DifficultyGeographicScope): string {
  return SCOPE_LABELS[scope]
}
