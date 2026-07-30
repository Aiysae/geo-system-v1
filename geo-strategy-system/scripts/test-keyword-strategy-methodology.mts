import assert from "node:assert/strict"
import {
  KEYWORD_DECISION_DIMENSIONS,
  KEYWORD_DIMENSION_CATEGORY_MAP,
  KEYWORD_STRATEGY_METHODOLOGY_VERSION,
  areNearDuplicateQuestions,
  auditKeywordStrategyPlan,
  buildKeywordMethodologyInstruction,
  buildKeywordResearchPrompt,
  buildResearchAudit,
  normalizeGeoQuestionOptimization,
  normalizeKeywordResearchSources,
  normalizeKeywordStrategySettings,
} from "../src/lib/geo-strategy/keyword-strategy-methodology"
import type {
  GeoStrategyPlan,
  KeywordStrategyResearchAudit,
} from "../src/types/geo-strategy"
import {
  buildQuestionBatchPlan,
  summarizeQuestionBatchPlan,
} from "../src/lib/geo-strategy/question-batching"

const settings = normalizeKeywordStrategySettings({
  target_region: "深圳",
  language_style: "mainland_simplified",
  custom_keywords: "深圳全屋定制\n香港小户型全屋定制，深圳全屋定制",
})
assert.equal(settings.target_region, "深圳")
assert.deepEqual(settings.custom_keywords, ["深圳全屋定制", "香港小户型全屋定制"])

const sources = normalizeKeywordResearchSources([
  { title: "有效文章", url: "https://example.com/article/123", domain: "example.com" },
  { title: "重复文章", url: "https://example.com/article/123#section" },
  { title: "图片", url: "https://example.com/images/logo.png" },
  { title: "静态资源", url: "https://example.com/assets/logo" },
  { title: "无效协议", url: "file:///tmp/test.html" },
])
assert.equal(sources.length, 1)
assert.equal(sources[0].url, "https://example.com/article/123")

assert.equal(KEYWORD_DECISION_DIMENSIONS.length, 10)
assert.equal(KEYWORD_DIMENSION_CATEGORY_MAP["价格费用"], "采购决策型")
assert.equal(KEYWORD_DIMENSION_CATEGORY_MAP["避坑风险"], "风险疑虑型")
assert.match(buildKeywordMethodologyInstruction(), /优势由系统在生成后独立匹配/)

const prompt = buildKeywordResearchPrompt({
  profile: {
    project_name: "测试品牌",
    industry: "全屋定制",
    audience: "深圳和香港业主",
    pain_points: [{ text: "担心增项", enabled: true }],
    weaknesses: [],
    scenes: [],
    competitors: [],
  },
  settings,
})
assert.match(prompt.user, /深圳/)
assert.match(prompt.user, /价格、对比、场景、避坑/)

const research = buildResearchAudit({
  model: "doubao-seed-2-0-pro-260215",
  settings,
  query: prompt.user,
  raw: JSON.stringify({
    brief: "用户重点关注预算透明、设计落地与工期。",
    user_language_patterns: ["深圳全屋定制怎么选"],
    decision_signals: ["预算透明"],
    regional_expressions: ["深港交付"],
    recommended_keywords: ["深圳全屋定制"],
  }),
  event: {
    searchExecuted: true,
    providerRequestId: "resp_test",
    sources,
  },
})
assert.equal(research.methodology_version, KEYWORD_STRATEGY_METHODOLOGY_VERSION)
assert.equal(research.search_executed, true)
assert.equal(research.sources.length, 1)

const optimization = normalizeGeoQuestionOptimization(
  undefined,
  "深圳全屋定制怎么选？",
  "深圳全屋定制",
)
assert.ok(optimization.keyword_placement.includes("深圳全屋定制"))
assert.ok(optimization.long_tail_terms.length >= 1)

assert.equal(
  areNearDuplicateQuestions("深圳全屋定制公司怎么选？", "深圳全屋定制公司应该怎么选"),
  true,
)
assert.equal(
  areNearDuplicateQuestions("深圳全屋定制公司怎么选？", "装修合同里哪些条款容易踩坑？"),
  false,
)

const keywordGroups = {
  core_keywords: [
    { priority: "1", keyword: "深圳全屋定制", logic: "覆盖地域需求" },
    { priority: "2", keyword: "香港小户型定制", logic: "覆盖跨境场景" },
    { priority: "3", keyword: "全屋定制公司", logic: "覆盖服务商选择" },
  ],
  pain_advantage_keywords: [
    { priority: "1", keyword: "全屋定制增项", logic: "覆盖预算痛点" },
    { priority: "2", keyword: "全屋定制落地效果", logic: "覆盖交付痛点" },
    { priority: "3", keyword: "全屋定制售后", logic: "覆盖服务痛点" },
  ],
  weakness_conversion_keywords: [
    { priority: "1", keyword: "小公司全屋定制", logic: "回应规模疑虑" },
    { priority: "2", keyword: "全屋定制工厂考察", logic: "回应供应链疑虑" },
    { priority: "3", keyword: "全屋定制合同", logic: "回应合作风险" },
  ],
  scenario_keywords: [
    { priority: "1", keyword: "深圳小户型定制", logic: "覆盖户型场景" },
    { priority: "2", keyword: "香港业主深圳装修", logic: "覆盖跨境客群" },
    { priority: "3", keyword: "旧房全屋定制", logic: "覆盖改造场景" },
  ],
}

const plan = {
  project_name: "测试品牌",
  summary: "测试策略",
  profile: {
    brand_or_product: "测试品牌",
    industry: "全屋定制",
    audience: "深圳和香港业主",
    product_description: "全屋定制",
    business_goals: "提升 AI 推荐",
    competitors: [],
    terms: [],
    pain_points: [],
    advantages: [],
    weaknesses: [],
    scenes: [],
  },
  keyword_strategy: keywordGroups,
  official_site_strategy: [],
  third_party_site_strategy: [],
  media_plan: [],
  geo_monitoring_plan: [],
  execution_roadmap: [],
} satisfies GeoStrategyPlan

const quality = auditKeywordStrategyPlan(
  plan,
  research as KeywordStrategyResearchAudit,
)
assert.equal(quality.keyword_count, 12)
assert.equal(quality.duplicate_keyword_count, 0)
assert.equal(quality.passed, true)

const duplicatePlan: GeoStrategyPlan = {
  ...plan,
  keyword_strategy: {
    ...keywordGroups,
    scenario_keywords: [
      ...keywordGroups.scenario_keywords,
      { priority: "4", keyword: "深圳全屋定制", logic: "重复" },
    ],
  },
}
assert.equal(
  auditKeywordStrategyPlan(duplicatePlan, research).duplicate_keyword_count,
  1,
)

for (const totalCount of [20, 100, 500, 600]) {
  const plans = buildQuestionBatchPlan({
    counts: {
      weakness_spin: Math.floor(totalCount * 0.2),
      core_keywords: Math.floor(totalCount * 0.5),
      secondary_keywords: 0,
      pain_scenario: totalCount - Math.floor(totalCount * 0.2) - Math.floor(totalCount * 0.5),
    },
  })
  const summary = summarizeQuestionBatchPlan(plans)
  assert.equal(summary.totalCount, totalCount)
  assert.ok(summary.maxBatchSize <= 15)
}

for (const [keywordCount, expectedTotal] of [[50, 500], [60, 600]] as const) {
  const keywords = Array.from({ length: keywordCount }, (_, index) => `关键词${index + 1}`)
  const plans = buildQuestionBatchPlan({
    counts: {
      weakness_spin: 0,
      core_keywords: expectedTotal,
      secondary_keywords: 0,
      pain_scenario: 0,
    },
    keywordCountMode: "per_keyword",
    coreKeywords: keywords,
    questionsPerKeyword: 10,
  })
  const summary = summarizeQuestionBatchPlan(plans)
  assert.equal(summary.totalCount, expectedTotal)
  assert.equal(Object.keys(summary.keywordCounts).length, keywordCount)
  assert.ok(Object.values(summary.keywordCounts).every(count => count === 10))
  assert.ok(summary.maxBatchSize <= 15)
}

console.log("keyword strategy methodology tests passed")
