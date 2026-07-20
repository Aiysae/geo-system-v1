import assert from "node:assert/strict"
import type {
  ModelKey,
  PenetrationByModel,
  PenetrationItem,
  PenetrationSource,
} from "../src/types"

const { aggregatePenetration } = await import("../src/lib/score-utils")

function source(url: string, title: string): PenetrationSource {
  return {
    title,
    snippet: `${title} 的正文摘要，可用于审计。`,
    url,
    domain: new URL(url).hostname,
    query: "测试问题",
  }
}

function answer(args: {
  sampleId: string
  question: string
  hit: boolean
  sources?: PenetrationSource[]
}): PenetrationItem {
  return {
    sampleId: args.sampleId,
    sampledAt: new Date().toISOString(),
    question: args.question,
    answer: args.hit ? "目标品牌在本次独立联网回答中被明确提及。" : "本次回答没有提到目标品牌。",
    mentionedBrands: args.hit ? ["目标品牌"] : [],
    topRecommended: args.hit ? "目标品牌" : null,
    hitOur: args.hit,
    webVerified: true,
    webExecutionVerified: true,
    searchSources: args.sources || [],
  }
}

const repeatedRecommendation = "这个行业有哪些值得推荐的服务商？"
const riskQuestion = "选择供应商前应该核验哪些资质？"
const narrowItems: PenetrationItem[] = [
  ...Array.from({ length: 5 }, (_, index) => answer({
    sampleId: `run-qwen-${index + 1}`,
    question: repeatedRecommendation,
    hit: true,
    sources: [
      source("https://example.com/article/shared", "重复采信文章"),
      source("https://example.com/logo.png", "站点 Logo"),
    ],
  })),
  answer({
    sampleId: "run-qwen-6",
    question: riskQuestion,
    hit: false,
    sources: [source("https://example.org/article/risk", "风险核验文章")],
  }),
]

const narrowByModel: PenetrationByModel = { qwen: narrowItems }
const narrow = aggregatePenetration(
  narrowByModel,
  "目标品牌",
  [],
  [],
  "brand",
  {
    plannedQuestions: narrowItems.map(item => item.question),
    plannedSlots: narrowItems.length,
    modelCount: 1,
  },
)

assert.equal(narrow.penetrationRate, 5 / 6, "原始槽位率必须保留每次独立采样")
assert.equal(narrow.questionLevelRate, 0.5, "重复的同一问题不能取得五倍问题权重")
assert.equal(narrow.intentBalancedRate, 0.5, "相同语义意图必须先聚合再等权")
assert.equal(narrow.categoryBalancedRate, 0.5, "推荐与风险两类必须等权计算")
assert.equal(narrow.sampleQuality?.semanticIntentCount, 2)
assert.equal(narrow.sampleQuality?.confidence, "low")
assert.equal(narrow.sampleQuality?.sourceDiversity?.citationEvents, 6)
assert.equal(narrow.sampleQuality?.sourceDiversity?.uniqueUrlCount, 2)
assert.equal(
  narrow.sampleQuality?.sourceDiversity?.uniqueDomainCount,
  2,
  "图片资源不能进入可审计信源多样性",
)

const partial = aggregatePenetration(
  { qwen: narrowItems.slice(0, 3) },
  "目标品牌",
  [],
  [],
  "brand",
  {
    plannedQuestions: narrowItems.map(item => item.question),
    plannedSlots: 10,
    modelCount: 2,
  },
)
assert.equal(partial.totalSlots, 3)
assert.equal(partial.plannedSlots, 10)
assert.equal(partial.completionRate, 0.3)
assert.ok(partial.sampleQuality?.warnings.some(message => message.includes("完成率")))

const categoryQuestions = [
  "这个行业有哪些值得推荐的服务商？",
  "系统运行不稳定应该如何解决？",
  "方案 A 和方案 B 有什么区别？",
  "采购服务前应该确认哪些交付参数？",
  "大型企业适合使用什么方案？",
  "行业品牌实力应该依据什么评价？",
  "签合同前有哪些常见风险？",
]
const balancedByModel: PenetrationByModel = {}
for (const model of ["qwen", "doubao"] as ModelKey[]) {
  balancedByModel[model] = categoryQuestions.map((question, index) => answer({
    sampleId: `balanced-${model}-${index + 1}`,
    question,
    hit: index % 2 === 0,
  }))
}
const balanced = aggregatePenetration(
  balancedByModel,
  "目标品牌",
  [],
  [],
  "brand",
  {
    plannedQuestions: categoryQuestions,
    plannedSlots: 14,
    modelCount: 2,
  },
)
assert.equal(balanced.sampleQuality?.categoryCoverageCount, 7)
assert.equal(balanced.penetrationRate, balanced.categoryBalancedRate)
assert.equal(balanced.completionRate, 1)

console.log("Penetration balanced scoring, completion and source diversity contracts passed.")
