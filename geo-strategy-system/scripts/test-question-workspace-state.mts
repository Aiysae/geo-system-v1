import assert from "node:assert/strict"
import type { QuestionItem } from "../src/types/geo-strategy"

const imported = await import("../src/lib/geo-strategy/question-workspace-state") as {
  applyQuestionJobToKeywordStrategy?: typeof import("../src/lib/geo-strategy/question-workspace-state").applyQuestionJobToKeywordStrategy
  default?: typeof import("../src/lib/geo-strategy/question-workspace-state")
}
const applyQuestionJobToKeywordStrategy = imported.applyQuestionJobToKeywordStrategy
  || imported.default?.applyQuestionJobToKeywordStrategy

assert.ok(applyQuestionJobToKeywordStrategy)

const question = (id: string, value: string): QuestionItem => ({
  id,
  category: "\u6838\u5fc3\u8bcd",
  difficulty: "\u4e2d",
  keyword: "\u6d4b\u8bd5",
  question: value,
  intent: "\u4e86\u89e3",
  content_angle: "\u5ba2\u89c2\u89e3\u7b54",
})

const state = {
  id: "keyword-client-1",
  name: "\u5ba2\u6237 A",
  step: "questions",
  completedSteps: ["input", "strategy"],
  projectName: "\u9879\u76ee A",
  industry: "\u6d4b\u8bd5",
  audience: "",
  locationTerms: "",
  productDesc: "",
  coreAdvantages: "",
  painPointsRaw: "",
  competitorsRaw: "",
  geoGoals: "",
  uploadedFiles: [],
  extracting: false,
  extractionError: "",
  extractedProfile: null,
  advantageStatus: "done",
  advantageError: "",
  strategyStatus: "done",
  strategyError: "",
  strategyPlan: null,
  questionStatus: "idle",
  questionError: "",
  questionCount: 10,
  customQuestionCount: 10,
  questionModelProvider: "doubao",
  questionModel: "doubao-test",
  questionCustomKeywords: "",
  questionCustomPainScenarios: "",
  layer2Ratio: 0,
  categoryConfig: {
    weaknessesPerWeakness: 10,
    coreRatio: 0.3,
    secondaryRatio: 0.35,
  },
  questions: [question("old", "\u65e7\u95ee\u9898")],
} as Parameters<typeof applyQuestionJobToKeywordStrategy>[0]

const baseJob = {
  id: "job-1",
  clientId: "client-1",
  status: "queued",
  completedBatches: 0,
  completedCount: 0,
  totalCount: 10,
  currentBatch: 0,
  totalBatches: 1,
  questions: [],
  warnings: [],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
} as Parameters<typeof applyQuestionJobToKeywordStrategy>[1]

const active = applyQuestionJobToKeywordStrategy(state, baseJob, "active")
assert.equal(active?.questionJobId, "job-1")
assert.equal(active?.questionStatus, "generating")
assert.equal(active?.questions[0]?.question, "\u65e7\u95ee\u9898")

const completed = applyQuestionJobToKeywordStrategy(active!, {
  ...baseJob,
  status: "succeeded",
  completedCount: 1,
  questions: [question("1", "\u65b0\u95ee\u9898")],
  warnings: ["\u8d28\u91cf\u68c0\u67e5\u901a\u8fc7", "\u67d0\u6279\u6b21\u8d85\u65f6\uff0c\u5df2\u8865\u9f50"],
  finishedAt: "2026-08-01T00:01:00.000Z",
}, "succeeded")
assert.equal(completed?.questionJobId, undefined)
assert.equal(completed?.questionResultJobId, "job-1")
assert.equal(completed?.questions[0]?.question, "\u65b0\u95ee\u9898")
assert.equal(completed?.questionError, "\u67d0\u6279\u6b21\u8d85\u65f6\uff0c\u5df2\u8865\u9f50")
assert.ok(completed?.completedSteps.includes("questions"))

const newer = { ...active!, questionJobId: "job-2" }
assert.equal(
  applyQuestionJobToKeywordStrategy(newer, { ...baseJob, status: "succeeded" }, "succeeded"),
  null,
)

console.log("question workspace state tests passed")
