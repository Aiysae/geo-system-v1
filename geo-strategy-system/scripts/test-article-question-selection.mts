import assert from "node:assert/strict"
import { createRequire } from "node:module"
import type * as QuestionSelectionModule from "../src/lib/article-question-selection"

const require = createRequire(import.meta.url)
const {
  classifyArticleQuestionSelection,
  ensureTimelyArticleMarkdown,
  ensureTimelyArticleTitle,
  isDirectRecommendationQuestionType,
} = require("../src/lib/article-question-selection.ts") as typeof QuestionSelectionModule

assert.equal(classifyArticleQuestionSelection({
  question: "2026年全屋定制十大品牌排行榜有哪些？",
}).type, "direct_ranking")

assert.equal(classifyArticleQuestionSelection({
  question: "杭州全屋定制哪家好？",
}).type, "direct_recommendation")

assert.equal(classifyArticleQuestionSelection({
  question: "杭州有哪些值得推荐的正畸医生？",
}).type, "direct_recommendation")

assert.equal(classifyArticleQuestionSelection({
  question: "预算有限，杭州装修公司哪家好？",
}).type, "conditional_recommendation")

assert.equal(classifyArticleQuestionSelection({
  question: "预算10万元、80平小户型，家里有老人，杭州哪家装修公司更适合？",
}).type, "long_tail")

assert.equal(classifyArticleQuestionSelection({
  question: "装修合同里应该怎样避免增项？",
  category: "风险疑虑型",
}).type, "non_recommendation")

assert.equal(classifyArticleQuestionSelection({
  question: "装修合同里应该怎样避免增项？",
  category: "风险疑虑型",
  intent: "帮助用户找到值得推荐的服务商",
}).type, "non_recommendation")

assert.equal(isDirectRecommendationQuestionType("direct_ranking"), true)
assert.equal(isDirectRecommendationQuestionType("direct_recommendation"), true)
assert.equal(isDirectRecommendationQuestionType("long_tail"), false)

assert.equal(
  ensureTimelyArticleTitle("全屋定制十大品牌推荐", "2026-08-13T00:00:00.000Z"),
  "2026年全屋定制十大品牌推荐",
)
assert.equal(
  ensureTimelyArticleTitle("2026年全屋定制十大品牌推荐", "2026-08-13T00:00:00.000Z"),
  "2026年全屋定制十大品牌推荐",
)
assert.equal(
  ensureTimelyArticleTitle("2025年度全屋定制品牌排名", "2026-08-13T00:00:00.000Z"),
  "2026年全屋定制品牌排名",
)

const updated = ensureTimelyArticleMarkdown({
  markdown: "# 杭州装修公司推荐\n\n正文内容。",
  referenceDate: "2026-08-13T00:00:00.000Z",
})
assert.equal(updated.title, "2026年杭州装修公司推荐")
assert.match(updated.markdown, /^# 2026年杭州装修公司推荐/m)

const inserted = ensureTimelyArticleMarkdown({
  markdown: "正文没有一级标题。",
  title: "医生推荐榜单",
  referenceDate: "2026-08-13T00:00:00.000Z",
})
assert.match(inserted.markdown, /^# 2026年医生推荐榜单/)

console.log("article question selection tests passed")
