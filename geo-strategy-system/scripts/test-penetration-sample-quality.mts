import assert from "node:assert/strict"
import type { PenetrationByModel } from "../src/types"

const {
  PENETRATION_QUESTION_CATEGORIES,
  arePenetrationQuestionsSemanticallySimilar,
  buildPenetrationCategoryQuotas,
  buildPenetrationQuestionSamples,
  buildPenetrationSampleQuality,
  computePenetrationSourceDiversity,
  normalizePenetrationQuestionGenerationSettings,
} = await import("../src/lib/penetration/sample-design")

const narrowQuestions = [
  "八字排盘软件哪个好用求推荐",
  "靠谱的八字排盘工具有哪些",
  "大众评价高的八字排盘推荐有哪些",
  "实用的八字排盘软件推荐",
  "无隐形消费的八字排盘工具推荐",
]

assert.equal(
  arePenetrationQuestionsSemanticallySimilar(narrowQuestions[0], narrowQuestions[1]),
  true,
  "换说法的同一推荐意图必须被聚到一起",
)
assert.equal(
  arePenetrationQuestionsSemanticallySimilar(
    "预算有限时如何选择服务商？",
    "签合同前有哪些合规风险？",
  ),
  false,
)

const narrowSamples = buildPenetrationQuestionSamples(narrowQuestions)
assert.ok(new Set(narrowSamples.map(sample => sample.intentId)).size < narrowQuestions.length)
const narrowQuality = buildPenetrationSampleQuality(narrowQuestions, {
  modelCount: 5,
  plannedSlots: 25,
  completedSlots: 25,
})
assert.equal(narrowQuality.confidence, "low")
assert.ok(narrowQuality.categoryCoverageCount < 7)
assert.ok(narrowQuality.warnings.some(message => message.includes("单一推荐场景")))

const balancedQuestions = [
  "这个行业有哪些值得推荐的服务商？",
  "行业工具口碑榜单怎么看？",
  "新产品中哪些比较好用？",
  "行业里常用的平台有哪些？",
  "部署失败后应该怎么解决？",
  "使用效果不稳定怎么办？",
  "数据不准确应该如何改善？",
  "项目没有效果的常见原因是什么？",
  "方案 A 和方案 B 的区别是什么？",
  "本地公司与全国公司应该如何对比？",
  "自建系统和购买服务哪个更合适？",
  "传统方案与 AI 方案有哪些差异？",
  "采购这类服务需要多少预算？",
  "企业选型时应该重点看哪些参数？",
  "签订合同前应该确认哪些交付条款？",
  "不同价格档位的性价比如何判断？",
  "新手适合使用哪一类方案？",
  "大型企业应用场景需要哪些能力？",
  "专业人士日常使用时关注什么？",
  "本地市场和全国市场的需求有什么不同？",
  "行业品牌知名度应该怎么判断？",
  "服务公司实力怎么样才算可靠？",
  "供应商品牌形象会影响用户选择吗？",
  "机构的行业地位应该依据什么评价？",
  "购买服务时有哪些常见避坑点？",
  "使用这类产品会有哪些安全风险？",
  "如何识别隐形收费和虚假承诺？",
  "选择供应商前应该核验哪些资质？",
]

const balancedQuality = buildPenetrationSampleQuality(balancedQuestions, {
  modelCount: 5,
  plannedSlots: 140,
  completedSlots: 140,
})
assert.equal(balancedQuality.categoryCoverageCount, PENETRATION_QUESTION_CATEGORIES.length)
assert.equal(balancedQuality.minCategoryCount, 4)
assert.equal(balancedQuality.confidence, "high")

const quotas = buildPenetrationCategoryQuotas(28)
assert.deepEqual(quotas.map(item => item.count), [4, 4, 4, 4, 4, 4, 4])

const focusedQuotas = buildPenetrationCategoryQuotas(
  10,
  ["comparison", "purchase_decision", "risk_concern"],
)
assert.deepEqual(focusedQuotas, [
  { category: "comparison", count: 4 },
  { category: "purchase_decision", count: 3 },
  { category: "risk_concern", count: 3 },
])

const customSettings = normalizePenetrationQuestionGenerationSettings({
  count: 10,
  keywords: "预算 合同",
  allocationMode: "custom",
  categories: ["purchase_decision", "risk_concern"],
  categoryCounts: {
    purchase_decision: 6,
    risk_concern: 4,
  },
})
assert.equal(customSettings.count, 10)
assert.deepEqual(
  buildPenetrationCategoryQuotas(
    customSettings.count,
    customSettings.categories,
    customSettings.categoryCounts,
  ),
  [
    { category: "purchase_decision", count: 6 },
    { category: "risk_concern", count: 4 },
  ],
)

const hintedQuestion = "这个行业通常需要了解哪些情况？"
const hintedSamples = buildPenetrationQuestionSamples(
  [hintedQuestion],
  [{ question: hintedQuestion, category: "risk_concern" }],
)
assert.equal(hintedSamples[0].category, "risk_concern", "AI 生成时的明确意图应优先于关键词推断")
const focusedQuality = buildPenetrationSampleQuality([hintedQuestion], {
  questionIntents: [{ question: hintedQuestion, category: "risk_concern" }],
  intendedCategories: ["risk_concern"],
})
assert.equal(focusedQuality.scopeMode, "focused")
assert.deepEqual(focusedQuality.scopeCategories, ["risk_concern"])
assert.ok(focusedQuality.warnings.some(message => message.includes("专项意图样本")))

const repeatedUrl = "https://example.com/article/one"
const byModel: PenetrationByModel = {
  doubao: [
    {
      question: "问题一",
      answer: "回答一",
      mentionedBrands: [],
      topRecommended: null,
      hitOur: false,
      searchSources: [
        { title: "同一文章", snippet: "摘要", url: repeatedUrl, domain: "example.com", query: "问题一" },
        { title: "同一文章", snippet: "摘要", url: repeatedUrl, domain: "example.com", query: "问题一" },
      ],
    },
    {
      question: "问题二",
      answer: "回答二",
      mentionedBrands: [],
      topRecommended: null,
      hitOur: false,
      searchSources: [
        { title: "同一文章", snippet: "摘要", url: repeatedUrl, domain: "example.com", query: "问题二" },
      ],
    },
  ],
  qwen: [{
    question: "问题三",
    answer: "回答三",
    mentionedBrands: [],
    topRecommended: null,
    hitOur: false,
    searchSources: [
      { title: "同一文章", snippet: "摘要", url: repeatedUrl, domain: "example.com", query: "问题三" },
      { title: "另一文章", snippet: "摘要", url: "https://example.org/article/two", domain: "example.org", query: "问题三" },
    ],
  }],
}

const sourceDiversity = computePenetrationSourceDiversity(byModel)
assert.equal(sourceDiversity.citationEvents, 4)
assert.equal(sourceDiversity.uniqueUrlCount, 2)
assert.equal(sourceDiversity.uniqueDomainCount, 2)
assert.equal(sourceDiversity.maxUrlReuse, 3)
assert.equal(sourceDiversity.duplicateCitationRate, 0.5)

console.log("Penetration sample design and quality contracts passed.")
