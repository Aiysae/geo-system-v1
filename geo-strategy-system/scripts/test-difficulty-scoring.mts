import assert from "node:assert/strict"
import { createRequire } from "node:module"
import type * as DifficultyScoringModule from "../src/lib/difficulty/scoring-v2"

const require = createRequire(import.meta.url)
const {
  competitorDensityScore,
  geographicScopeScore,
  scoreDifficultyV2,
} = require("../src/lib/difficulty/scoring-v2.ts") as typeof DifficultyScoringModule
type DifficultyScoringSignals = DifficultyScoringModule.DifficultyScoringSignals

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
  national.costEstimate.validation30Days.min > province.costEstimate.validation30Days.min,
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
