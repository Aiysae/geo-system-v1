import assert from "node:assert/strict"

import type { PenetrationByModel } from "../src/types"

const { aggregatePenetration } = await import("../src/lib/score-utils")
const { computeBrandVoice, computeKeywordCompetition } = await import("../src/lib/dashboard-aggregations")
const {
  buildJudgeEntryBatches,
  buildPenetrationExtractionSummary,
  orderJudgeCandidates,
  validateJudgeBatchItems,
} = await import("../src/lib/penetration/entity-extraction")

assert.deepEqual(
  orderJudgeCandidates(["qwen", "doubao", "hunyuan"], ["qwen"]),
  ["doubao", "hunyuan", "qwen"],
  "an independent healthy judge should be preferred before the answer model",
)

const entries = [
  { id: "one", answer: "欧派、索菲亚和好莱客均提供全屋定制服务。" },
  { id: "two", answer: "木里木外与博洛尼定位偏高端。" },
  { id: "three", answer: "源木匠心 RERA 强调透明报价。" },
  { id: "four", answer: "宽左 KUANZUO 注重设计和收纳。" },
]

const batches = buildJudgeEntryBatches(entries, {
  maxItems: 3,
  maxCharacters: 36,
})
assert.equal(batches.flat().length, entries.length)
assert.ok(batches.every(batch => batch.length <= 3))
assert.ok(batches.length >= 2, "long answers must be split into smaller judge batches")

const incomplete = validateJudgeBatchItems(entries.slice(0, 2), [{
  id: "one",
  mentionedBrands: ["欧派"],
  mentionedEntities: [{ name: "欧派", kind: "brand", evidence: "欧派" }],
  topRecommended: null,
}])
assert.equal(incomplete.ok, false)
assert.deepEqual(incomplete.missingIds, ["two"])

const complete = validateJudgeBatchItems(entries.slice(0, 2), [
  {
    id: "one",
    mentionedBrands: ["欧派"],
    mentionedEntities: [{ name: "欧派", kind: "brand", evidence: "欧派" }],
    topRecommended: null,
  },
  {
    id: "two",
    mentionedBrands: ["木里木外", "博洛尼"],
    mentionedEntities: [
      { name: "木里木外", kind: "brand", evidence: "木里木外" },
      { name: "博洛尼", kind: "brand", evidence: "博洛尼" },
    ],
    topRecommended: null,
  },
])
assert.equal(complete.ok, true)

const byModel: PenetrationByModel = {
  qwen: [
    {
      sampleId: "pending",
      question: "哪家好？",
      answer: "目标品牌、欧派和索菲亚都可以比较。",
      mentionedBrands: ["目标品牌"],
      topRecommended: null,
      hitOur: true,
      extraction: { status: "pending", attempts: 0, version: 2 },
    },
    {
      sampleId: "complete",
      question: "有哪些品牌？",
      answer: "欧派和索菲亚。",
      mentionedBrands: ["欧派", "索菲亚"],
      topRecommended: null,
      hitOur: false,
      extraction: {
        status: "succeeded",
        attempts: 1,
        version: 2,
        model: "qwen",
        extractedAt: "2026-08-17T00:00:00.000Z",
      },
    },
  ],
}

const summary = buildPenetrationExtractionSummary(byModel)
assert.deepEqual(summary, {
  status: "pending",
  total: 2,
  succeeded: 1,
  failed: 0,
  pending: 1,
  version: 2,
})

const aggregate = aggregatePenetration(byModel, "目标品牌")
assert.deepEqual(
  aggregate.industryShare.map(item => item.brand).sort(),
  ["欧派", "索菲亚"],
  "pending extraction fallbacks must not create a misleading target-only ranking",
)
assert.deepEqual(
  computeBrandVoice(byModel, "目标品牌").map(item => item.brand).sort(),
  ["欧派", "索菲亚"],
  "share-of-voice must use the same completed extraction set as the ranking",
)
assert.deepEqual(
  computeKeywordCompetition(byModel, "目标品牌").map(item => item.question),
  ["有哪些品牌？"],
  "keyword competition must not count pending target-only fallbacks",
)

console.log("penetration entity extraction batching, completeness and aggregation guards passed")
