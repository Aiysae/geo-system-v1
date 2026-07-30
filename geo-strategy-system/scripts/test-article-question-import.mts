import assert from "node:assert/strict"
import { createRequire } from "node:module"
import type * as ImportModule from "../src/lib/article-question-import"
import type * as PlanningModule from "../src/lib/article-batches/planning"

const require = createRequire(import.meta.url)
const {
  ARTICLE_QUESTION_TEMPLATE_HEADERS,
  MAX_ARTICLE_QUESTION_IMPORT_ROWS,
  normalizeArticleQuestionKey,
  parseArticleQuestionMatrix,
} = require("../src/lib/article-question-import.ts") as typeof ImportModule
const { planArticleBatch } = require(
  "../src/lib/article-batches/planning.ts",
) as typeof PlanningModule

function matrixOf(count: number): unknown[][] {
  return [
    [...ARTICLE_QUESTION_TEMPLATE_HEADERS],
    ...Array.from({ length: count }, (_, index) => [
      index + 1,
      `关键词 ${index + 1}`,
      index % 2 === 0 ? "选择型问题" : "风险型问题",
      "决策标准",
      `第 ${index + 1} 个用户疑问是什么？`,
      "解释判断标准",
      "结论前置并覆盖长尾词",
      index % 7 === 0 ? "" : `第 ${index + 1} 条匹配优势`,
    ]),
  ]
}

for (const size of [10, 300, 600, 1_000]) {
  const result = parseArticleQuestionMatrix(matrixOf(size))
  assert.equal(result.rows.length, size)
  assert.equal(result.totalDataRows, size)
  assert.equal(result.warningCount, Math.ceil(size / 7))
}

assert.throws(
  () => parseArticleQuestionMatrix(matrixOf(MAX_ARTICLE_QUESTION_IMPORT_ROWS + 1)),
  /单次最多导入/,
)

const aliases = parseArticleQuestionMatrix([
  ["问题", "优势", "关键词", "问题意图"],
  ["装修合同哪些地方容易增项？", "逐项列明材料与工艺", "装修避坑", "风险型问题"],
  [" 装修合同哪些地方容易增项 ？ ", "重复内容", "装修避坑", "风险型问题"],
  ["", "没有问题", "", ""],
])
assert.equal(aliases.rows.length, 1)
assert.equal(aliases.rows[0].matchedAdvantage, "逐项列明材料与工艺")
assert.equal(aliases.rows[0].category, undefined)
assert.equal(aliases.rows[0].intent, "风险型问题")
assert.equal(aliases.skipped.length, 2)
assert.equal(aliases.skipped[0].reason, "duplicate_batch")
assert.equal(aliases.skipped[1].reason, "invalid")

assert.equal(
  normalizeArticleQuestionKey(" 第一次装修，怎么选？ "),
  normalizeArticleQuestionKey("第一次装修怎么选"),
)

const planned = planArticleBatch({
  count: 2,
  topicMode: "questions",
  coreQuestion: "",
  keywords: "",
  questionTasks: [
    {
      materialId: "aqm_one",
      questionSource: "excel",
      question: "问题一？",
      matchedAdvantage: "优势一",
      decisionDimension: "服务",
      geoOptimizationText: "结论前置",
    },
    {
      materialId: "aqm_two",
      questionSource: "excel",
      question: "问题二？",
      matchedAdvantage: "优势二",
    },
  ],
})
assert.equal(planned[0].materialId, "aqm_one")
assert.equal(planned[0].matchedAdvantage, "优势一")
assert.match(planned[0].brief, /决策维度：服务/)
assert.match(planned[0].brief, /GEO 收录要点：结论前置/)
assert.equal(planned[1].matchedAdvantage, "优势二")

console.log("article question import tests passed")
