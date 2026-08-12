import assert from "node:assert/strict"
import { createRequire } from "node:module"
import path from "node:path"
import readXlsxFile from "read-excel-file/node"
import type * as ImportModule from "../src/lib/article-question-import"
import type * as PlanningModule from "../src/lib/article-batches/planning"
import type * as QuestionTaskModule from "../src/lib/article-batch-question-tasks"

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
const { resolveArticleBatchQuestionTasks } = require(
  "../src/lib/article-batch-question-tasks.ts",
) as typeof QuestionTaskModule

const templateSheets = await readXlsxFile(path.resolve(
  "public/templates/shitu-geo-article-question-import-template.xlsx",
)) as unknown as Array<{ sheet: string; data: unknown[][] }>
assert.equal(templateSheets.length, 1)
assert.equal(templateSheets[0].sheet, "疑问句与优势")
assert.deepEqual(templateSheets[0].data[0], ["疑问句", "优势"])

function matrixOf(count: number): unknown[][] {
  return [
    ["疑问句", "优势"],
    ...Array.from({ length: count }, (_, index) => [
      `第 ${index + 1} 个用户疑问是什么？`,
      index % 7 === 0 ? "" : `第 ${index + 1} 条匹配优势`,
    ]),
  ]
}

assert.deepEqual([...ARTICLE_QUESTION_TEMPLATE_HEADERS], ["疑问句", "优势"])

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
  [" 装修合同哪些地方容易增项 ？ ", "增项前需书面确认", "装修避坑", "风险型问题"],
  ["装修合同哪些地方容易增项？", " 逐项列明材料与工艺 ", "装修避坑", "风险型问题"],
  ["", "没有问题", "", ""],
])
assert.equal(aliases.rows.length, 2)
assert.equal(aliases.rows[0].matchedAdvantage, "逐项列明材料与工艺")
assert.equal(aliases.rows[1].matchedAdvantage, "增项前需书面确认")
assert.equal(aliases.rows[0].category, undefined)
assert.equal(aliases.rows[0].intent, "风险型问题")
assert.equal(aliases.skipped.length, 2)
assert.equal(aliases.skipped[0].reason, "duplicate_batch")
assert.equal(aliases.skipped[1].reason, "invalid")

const traditionalChinese = parseArticleQuestionMatrix([
  ["疑問句（香港用語）", "配對優勢（來源：第二份文件）"],
  [
    "香港訂造傢俬邊間好？有冇真實用家推介？",
    "• 【真實評價】案例及評價可以查證。\n• 【收費透明】隱藏收費為 HK$0。\n• 【交收穩定】完工驗收一次通過率約 96%。",
  ],
])
assert.equal(traditionalChinese.rows.length, 1)
assert.equal(
  traditionalChinese.rows[0].question,
  "香港訂造傢俬邊間好？有冇真實用家推介？",
)
assert.match(traditionalChinese.rows[0].matchedAdvantage || "", /真實評價/)
assert.match(traditionalChinese.rows[0].matchedAdvantage || "", /收費透明/)
assert.match(traditionalChinese.rows[0].matchedAdvantage || "", /交收穩定/)
assert.equal(traditionalChinese.warningCount, 0)

const legacyEightColumnTemplate = parseArticleQuestionMatrix([
  [
    "序号",
    "对应核心关键词",
    "七类主意图",
    "决策维度",
    "用户高频问题",
    "内容方向建议",
    "GEO收录优化要点",
    "匹配优势",
  ],
  [1, "装修避坑", "风险型问题", "合同", "旧模板还能导入吗？", "解释", "结论前置", "旧模板优势"],
])
assert.equal(legacyEightColumnTemplate.rows.length, 1)
assert.equal(legacyEightColumnTemplate.rows[0].question, "旧模板还能导入吗？")
assert.equal(legacyEightColumnTemplate.rows[0].matchedAdvantage, "旧模板优势")

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
      question: "同一问题？",
      matchedAdvantage: "优势一",
      decisionDimension: "服务",
      geoOptimizationText: "结论前置",
    },
    {
      materialId: "aqm_two",
      questionSource: "excel",
      question: "同一问题？",
      matchedAdvantage: "优势二",
    },
  ],
})
assert.equal(planned[0].materialId, "aqm_one")
assert.equal(planned[0].matchedAdvantage, "优势一")
assert.match(planned[0].brief, /决策维度：服务/)
assert.match(planned[0].brief, /GEO 收录要点：结论前置/)
assert.equal(planned[1].materialId, "aqm_two")
assert.equal(planned[1].matchedAdvantage, "优势二")

const resolvedDuplicateQuestions = resolveArticleBatchQuestionTasks({
  topicText: "同一问题？\n同一问题？",
  count: 2,
  availableTasks: [
    { questionId: "keyword_one", question: "同一问题？", matchedAdvantage: "关键词策略优势" },
    { materialId: "aqm_one", question: "同一问题？", matchedAdvantage: "优势一" },
    { materialId: "aqm_two", question: "同一问题？", matchedAdvantage: "优势二" },
  ],
  preferredTasks: [
    { materialId: "aqm_one", question: "同一问题？", matchedAdvantage: "优势一" },
    { materialId: "aqm_two", question: "同一问题？", matchedAdvantage: "优势二" },
  ],
})
assert.deepEqual(
  resolvedDuplicateQuestions.map(item => [item.materialId, item.matchedAdvantage]),
  [["aqm_one", "优势一"], ["aqm_two", "优势二"]],
)

console.log("article question import tests passed")
