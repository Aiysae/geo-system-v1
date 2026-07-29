import assert from "node:assert/strict"
import { createRequire } from "node:module"
import type * as RoutingModule from "../src/lib/article-strategy-routing"

const require = createRequire(import.meta.url)
const {
  articleStrategyPromptCandidates,
  fallbackArticleStrategyRoute,
} = require("../src/lib/article-strategy-routing.ts") as typeof RoutingModule

assert.equal(
  articleStrategyPromptCandidates({
    question: "采购时如何避坑？",
    category: "采购决策型",
    comparisonBrandCount: 0,
  })[0],
  "selectionPitfallGuide",
)

assert.equal(
  articleStrategyPromptCandidates({
    question: "哪些品牌值得推荐？",
    category: "榜单推荐型",
    comparisonBrandCount: 2,
  })[0],
  "topBrandRanking",
)

const fallback = fallbackArticleStrategyRoute({
  task: {
    questionId: "q1",
    question: "A 与 B 怎么选？",
    category: "竞品对比型",
    matchedAdvantage: "提供完整交付流程",
  },
  comparisonBrandCount: 1,
})
assert.equal(fallback.promptKey, "thirdPartyObservation")
assert.equal(fallback.articleFormat, "recommendationRoundup")
assert.ok(fallback.promptTitle)

assert.equal(
  articleStrategyPromptCandidates({
    question: "A 与 B 的实测样本和参数对比结果如何？",
    category: "竞品对比型",
    matchedAdvantage: "已有横评评分记录",
    comparisonBrandCount: 1,
  })[0],
  "handsOnComparisonReport",
)

console.log("article strategy routing tests passed")
