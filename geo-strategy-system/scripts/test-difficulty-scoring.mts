import assert from "node:assert/strict"
import { createRequire } from "node:module"
import type * as ContentCostModule from "../src/lib/difficulty/content-cost-estimate"
import type * as DifficultyScoringModule from "../src/lib/difficulty/scoring-v2"

const require = createRequire(import.meta.url)
const {
  competitorDensityScore,
  geographicScopeScore,
  scoreDifficultyV2,
} = require("../src/lib/difficulty/scoring-v2.ts") as typeof DifficultyScoringModule
const {
  allocateGeoContent,
  estimateGeoContentCost,
  geoContentExecutionCost,
  isContentVolumeCostEstimate,
  isContentVolumeV3CostEstimate,
} = require("../src/lib/difficulty/content-cost-estimate.ts") as typeof ContentCostModule
type DifficultyScoringSignals = DifficultyScoringModule.DifficultyScoringSignals

const calibratedCost = estimateGeoContentCost({
  totalScore: 60,
  confidence: "中",
  scopeLabel: "单省",
  region: "浙江省",
  industry: "一般消费服务",
  requestedRiskLevel: "standard",
})
const [firstMention, halfStable, stableMention] = calibratedCost.milestones
assert.equal(calibratedCost.version, "content-volume-v3")
assert.ok(isContentVolumeCostEstimate(calibratedCost))
assert.ok(isContentVolumeV3CostEstimate(calibratedCost))
assert.equal(calibratedCost.difficultyBand.level, "困难")
assert.equal(calibratedCost.difficultyBand.minScore, 50)
assert.equal(calibratedCost.difficultyBand.maxScore, 74)
assert.equal(calibratedCost.difficultyBand.perPointGrowthRate, 0.035)
assert.equal(firstMention.contentCount.recommended, 169)
assert.equal(halfStable.contentCount.recommended, 406)
assert.equal(stableMention.contentCount.recommended, 677)
assert.equal(firstMention.recommendedCost, 3_714)
assert.equal(halfStable.recommendedCost, 6_819)
assert.equal(stableMention.recommendedCost, 10_369)
assert.equal(calibratedCost.difficultyBand.nextScoreImpact?.toScore, 61)
assert.equal(calibratedCost.difficultyBand.nextScoreImpact?.contentDelta, 24)
assert.equal(calibratedCost.difficultyBand.nextScoreImpact?.costDelta, 314)
assert.deepEqual(calibratedCost.difficultyBand.nextLevelTransition, {
  fromScore: 74,
  toScore: 75,
  fromContent: 1_096,
  toContent: 1_650,
  contentDelta: 554,
  costDelta: 7_257,
})

const historicalV2Snapshot = {
  ...calibratedCost,
  version: "content-volume-v2" as const,
}
assert.ok(isContentVolumeCostEstimate(historicalV2Snapshot))
assert.equal(isContentVolumeV3CostEstimate(historicalV2Snapshot), false)

const expectedBandAnchors = new Map([
  [0, 60],
  [24, 97],
  [25, 150],
  [49, 305],
  [50, 480],
  [60, 677],
  [70, 955],
  [74, 1_096],
  [75, 1_650],
  [100, 4_399],
])
let previousStableContent = 0
let previousStableCost = 0
for (let score = 0; score <= 100; score += 1) {
  const estimate = estimateGeoContentCost({
    totalScore: score,
    confidence: "中",
    scopeLabel: "单省",
    region: "浙江省",
    industry: "一般消费服务",
    requestedRiskLevel: "standard",
  })
  const stable = estimate.milestones.find(item => item.key === "stableMention")!
  assert.equal(
    stable.contentCount.recommended,
    expectedBandAnchors.get(score) ?? stable.contentCount.recommended,
    `${score} 分的四档逐分内容量锚点不正确`,
  )
  assert.ok(
    stable.contentCount.recommended > previousStableContent || score === 0,
    `${score - 1} 分升到 ${score} 分时，稳定内容量必须严格增加`,
  )
  assert.ok(
    (stable.recommendedCost ?? 0) > previousStableCost || score === 0,
    `${score - 1} 分升到 ${score} 分时，稳定成本必须严格增加`,
  )
  previousStableContent = stable.contentCount.recommended
  previousStableCost = stable.recommendedCost ?? 0
}

for (const [score, expected] of [
  [24, { fromScore: 24, toScore: 25, fromContent: 97, toContent: 150, contentDelta: 53, costDelta: 694 }],
  [49, { fromScore: 49, toScore: 50, fromContent: 305, toContent: 480, contentDelta: 175, costDelta: 2_292 }],
  [74, { fromScore: 74, toScore: 75, fromContent: 1_096, toContent: 1_650, contentDelta: 554, costDelta: 7_257 }],
] as const) {
  const estimate = estimateGeoContentCost({
    totalScore: score,
    confidence: "中",
    scopeLabel: "单省",
    region: "浙江省",
    industry: "一般消费服务",
    requestedRiskLevel: "standard",
  })
  assert.deepEqual(estimate.difficultyBand.nextLevelTransition, expected)
}

const score70Cost = estimateGeoContentCost({
  totalScore: 70,
  confidence: "中",
  scopeLabel: "单省",
  region: "浙江省",
  industry: "一般消费服务",
  requestedRiskLevel: "standard",
})
const score70Stable = score70Cost.milestones.find(item => item.key === "stableMention")!
assert.equal(score70Stable.contentCount.recommended, 955)
assert.equal(score70Stable.recommendedCost, 14_011)
assert.ok(
  (score70Stable.recommendedCost ?? 0) / (stableMention.recommendedCost ?? 1) > 1.35,
  "困难档内 60 分升到 70 分时，稳定成本应提升约 35%",
)

const medicalCost = estimateGeoContentCost({
  totalScore: 60,
  confidence: "中",
  scopeLabel: "全国",
  region: "全国",
  industry: "医疗诊疗服务",
  requestedRiskLevel: "auto",
  authorityBarrier: 88,
})
assert.ok(isContentVolumeV3CostEstimate(medicalCost))
assert.equal(medicalCost.industryProfile.resolvedLevel, "strict")
assert.equal(medicalCost.industryProfile.effectiveMultiplier, 2.8)
assert.deepEqual(medicalCost.contentRatios, {
  selfMediaArticles: 0.4,
  authorityMediaArticles: 0.45,
  douyinVideos: 0.15,
})
for (const milestone of medicalCost.milestones) {
  assert.equal(
    milestone.allocation.selfMediaArticles
      + milestone.allocation.authorityMediaArticles
      + milestone.allocation.douyinVideos,
    milestone.allocation.total,
    "严格监管行业的渠道结构分配不能丢失内容数量",
  )
}
assert.equal(
  medicalCost.milestones.find(item => item.key === "stableMention")?.recommendedCost,
  29_033,
)

const highValueCost = estimateGeoContentCost({
  totalScore: 60,
  confidence: "高",
  scopeLabel: "全国",
  region: "全国",
  industry: "工业设备",
  requestedRiskLevel: "standard",
  averageOrderValue: 1_200_000,
})
assert.equal(highValueCost.industryProfile.valueMultiplier, 2.5)
assert.equal(highValueCost.industryProfile.effectiveMultiplier, 2.5)

const highValueMedicalCost = estimateGeoContentCost({
  totalScore: 60,
  confidence: "高",
  scopeLabel: "全国",
  region: "全国",
  industry: "高端医疗服务",
  requestedRiskLevel: "auto",
  averageOrderValue: 1_200_000,
})
assert.equal(highValueMedicalCost.industryProfile.effectiveMultiplier, 3.325)
assert.ok(
  (highValueMedicalCost.milestones[2].recommendedCost ?? 0)
    > (medicalCost.milestones[2].recommendedCost ?? 0),
)

for (let total = 0; total <= 500; total++) {
  const allocation = allocateGeoContent(total)
  assert.equal(
    allocation.selfMediaArticles + allocation.authorityMediaArticles + allocation.douyinVideos,
    total,
    `内容量 ${total} 的渠道分配不能丢失或重复`,
  )
  assert.equal(
    geoContentExecutionCost(allocation),
    1_500 + allocation.selfMediaArticles * 3 + allocation.authorityMediaArticles * 50 + allocation.douyinVideos * 10,
  )
}
assert.ok(firstMention.cumulativeCost.max < halfStable.cumulativeCost.min)
assert.ok(halfStable.cumulativeCost.max < stableMention.cumulativeCost.max)

const baseSignals: DifficultyScoringSignals = {
  competitorBrands: ["品牌甲", "品牌乙", "品牌丙", "品牌丁", "品牌戊"],
  estimatedCompetitorCount: 5,
  giantIncumbentCount: 1,
  topBrandConcentration: 58,
  geographicComplexity: 50,
  contentSaturation: 55,
  authorityBarrier: 60,
  sourceConcentration: 52,
  aiEntryBarrier: 58,
  marketSizeScore: 55,
  competitorBudgetStrength: 58,
  evidenceCoverage: 75,
}

for (let count = 1; count <= 80; count++) {
  assert.ok(
    competitorDensityScore(count) >= competitorDensityScore(count - 1),
    `竞品数量从 ${count - 1} 增加到 ${count} 时，难度不能下降`,
  )
}

assert.ok(geographicScopeScore("city", 100) < geographicScopeScore("province", 0))
assert.ok(geographicScopeScore("province", 100) < geographicScopeScore("region", 0))
assert.ok(geographicScopeScore("region", 100) < geographicScopeScore("national", 0))

const aliasResult = scoreDifficultyV2({
  industry: "全屋定制",
  mode: "industry",
  scope: "city",
  region: "深圳",
  signals: {
    ...baseSignals,
    estimatedCompetitorCount: undefined,
    competitorBrands: ["威法VIFA", "威法", "VIFA"],
  },
})
assert.equal(aliasResult.competitorCount, 1, "同一品牌的中英文名和简称必须合并")

const subBrandResult = scoreDifficultyV2({
  industry: "智能汽车",
  mode: "industry",
  scope: "city",
  region: "北京",
  signals: {
    ...baseSignals,
    estimatedCompetitorCount: undefined,
    competitorBrands: ["小米", "小米汽车"],
  },
})
assert.equal(subBrandResult.competitorCount, 2, "独立子品牌不能仅凭名称包含关系被合并")

const province = scoreDifficultyV2({
  industry: "除甲醛",
  mode: "industry",
  scope: "province",
  region: "浙江省",
  signals: baseSignals,
})
const national = scoreDifficultyV2({
  industry: "除甲醛",
  mode: "industry",
  scope: "national",
  region: "全国",
  signals: baseSignals,
})
assert.ok(national.totalScore > province.totalScore, "同一证据下，全国难度必须高于单省")
assert.ok(
  national.costEstimate.milestones[2].cumulativeCost.min > province.costEstimate.milestones[2].cumulativeCost.min,
  "同一证据下，全国预算必须高于单省",
)

const lowCommercial = scoreDifficultyV2({
  industry: "日用消费品",
  mode: "industry",
  scope: "province",
  region: "浙江省",
  commercial: { averageOrderValue: 80, grossMarginRate: 15, annualRepeatPurchases: 1 },
  signals: {
    ...baseSignals,
    giantIncumbentCount: 0,
    marketSizeScore: 25,
    competitorBudgetStrength: 20,
  },
})
const highCommercial = scoreDifficultyV2({
  industry: "高端企业服务",
  mode: "industry",
  scope: "province",
  region: "浙江省",
  commercial: { averageOrderValue: 8_000, grossMarginRate: 70, annualRepeatPurchases: 3 },
  signals: {
    ...baseSignals,
    giantIncumbentCount: 3,
    marketSizeScore: 90,
    competitorBudgetStrength: 95,
  },
})
assert.ok(
  highCommercial.dimensions.dimension4.score > lowCommercial.dimensions.dimension4.score,
  "高客单、高毛利、大厂密集行业的商业竞争分必须更高",
)
assert.ok(highCommercial.totalScore > lowCommercial.totalScore)
assert.ok(
  highCommercial.costEstimate.milestones[2].cumulativeCost.min
    > lowCommercial.costEstimate.milestones[2].cumulativeCost.min,
  "高商业竞争行业达到稳定提及所需内容与成本必须更高",
)

const brandFewCompetitors = scoreDifficultyV2({
  industry: "全屋定制",
  mode: "brand",
  scope: "province",
  region: "浙江省",
  signals: {
    ...baseSignals,
    competitorBrands: ["品牌甲", "品牌乙"],
    estimatedCompetitorCount: 2,
    targetVisibilityGap: 55,
    trustAssetGap: 55,
    contentAssetGap: 55,
    localResourceGap: 55,
  },
})
const brandManyCompetitors = scoreDifficultyV2({
  industry: "全屋定制",
  mode: "brand",
  scope: "province",
  region: "浙江省",
  signals: {
    ...baseSignals,
    competitorBrands: ["品牌甲", "品牌乙", "品牌丙", "品牌丁", "品牌戊", "品牌己", "品牌庚", "品牌辛"],
    estimatedCompetitorCount: 24,
    targetVisibilityGap: 55,
    trustAssetGap: 55,
    contentAssetGap: 55,
    localResourceGap: 55,
  },
})
assert.ok(
  brandManyCompetitors.dimensions.dimension1.score > brandFewCompetitors.dimensions.dimension1.score,
  "品牌测评中竞品越多，行业竞争维度也必须更高",
)
assert.ok(brandManyCompetitors.totalScore > brandFewCompetitors.totalScore)

const liquor = scoreDifficultyV2({
  industry: "白酒",
  mode: "industry",
  scope: "national",
  region: "全国",
  commercial: { averageOrderValue: 1_500, grossMarginRate: 72, annualRepeatPurchases: 5 },
  signals: {
    competitorBrands: ["茅台", "五粮液", "国窖1573", "汾酒", "洋河", "剑南春", "郎酒", "古井贡酒"],
    estimatedCompetitorCount: 35,
    giantIncumbentCount: 4,
    topBrandConcentration: 88,
    geographicComplexity: 75,
    contentSaturation: 86,
    authorityBarrier: 82,
    sourceConcentration: 72,
    aiEntryBarrier: 86,
    marketSizeScore: 95,
    competitorBudgetStrength: 98,
    evidenceCoverage: 85,
  },
})
assert.ok(liquor.totalScore >= 75, `全国白酒强竞争样本不应低于超难区间，实际 ${liquor.totalScore}`)

console.log("difficulty scoring and content cost v3: all calibration checks passed")
