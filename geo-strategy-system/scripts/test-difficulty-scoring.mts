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
} = require("../src/lib/difficulty/content-cost-estimate.ts") as typeof ContentCostModule
type DifficultyScoringSignals = DifficultyScoringModule.DifficultyScoringSignals

const calibratedCost = estimateGeoContentCost({
  totalScore: 60,
  confidence: "中",
  scopeLabel: "单省",
  region: "浙江省",
})
const [firstMention, halfStable, stableMention] = calibratedCost.milestones
assert.deepEqual(firstMention.contentCount, { min: 55, max: 75, recommended: 65 })
assert.deepEqual(firstMention.days, { min: 22, max: 30 })
assert.deepEqual(firstMention.cumulativeCost, { min: 2_217, max: 2_479 })
assert.deepEqual(halfStable.contentCount, { min: 130, max: 175, recommended: 150 })
assert.deepEqual(halfStable.days, { min: 48, max: 64 })
assert.deepEqual(halfStable.cumulativeCost, { min: 3_203, max: 3_789 })
assert.deepEqual(stableMention.contentCount, { min: 215, max: 290, recommended: 250 })
assert.deepEqual(stableMention.days, { min: 87, max: 117 })
assert.deepEqual(stableMention.cumulativeCost, { min: 4_313, max: 5_299 })

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
  mode: "industry",
  scope: "province",
  region: "浙江省",
  signals: baseSignals,
})
const national = scoreDifficultyV2({
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

console.log("difficulty scoring v2: all calibration checks passed")
