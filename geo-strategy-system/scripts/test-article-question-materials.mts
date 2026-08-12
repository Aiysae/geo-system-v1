import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import type * as StoreModule from "../src/lib/article-question-materials"

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "geo-article-materials-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(directory, "kv.json")

const require = createRequire(import.meta.url)
const {
  deleteArticleQuestionMaterials,
  getArticleQuestionMaterialsByIds,
  importArticleQuestionMaterials,
  listArticleQuestionMaterials,
} = require("../src/lib/article-question-materials.ts") as typeof StoreModule

const ownerUserId = "user_owner"
const clientId = "client_one"
const first = await importArticleQuestionMaterials({
  ownerUserId,
  clientId,
  actorUserId: ownerUserId,
  importBatchId: "aqi_1234567890abcdef",
  sourceFileName: "疑问句.xlsx",
  existingQuestionMaterials: [
    { question: "系统已有问题？", matchedAdvantage: "既有优势" },
  ],
  rows: [
    { rowNumber: 2, question: "系统已有问题", matchedAdvantage: "既有优势" },
    { rowNumber: 3, question: "系统已有问题", matchedAdvantage: "新优势" },
    { rowNumber: 4, question: "问题 A？", matchedAdvantage: "优势 A", keyword: "关键词 A" },
    { rowNumber: 5, question: "问题 B？" },
    { rowNumber: 6, question: "问题A", matchedAdvantage: "优势 B" },
    { rowNumber: 7, question: " 问题 A ", matchedAdvantage: " 优势 A " },
  ],
})

assert.equal(first.createdCount, 4)
assert.equal(first.skippedCount, 2)
assert.equal(first.warningCount, 1)
assert.deepEqual(first.created.map(item => item.matchedAdvantage), ["新优势", "优势 A", undefined, "优势 B"])
assert.equal(new Set(first.created.map(item => item.id)).size, 4)

const idempotent = await importArticleQuestionMaterials({
  ownerUserId,
  clientId,
  actorUserId: ownerUserId,
  importBatchId: "aqi_1234567890abcdef",
  sourceFileName: "疑问句.xlsx",
  rows: [{ rowNumber: 2, question: "不会覆盖原结果" }],
})
assert.deepEqual(idempotent, first)

const listed = await listArticleQuestionMaterials(ownerUserId, clientId)
assert.equal(listed.length, 4)
const selected = await getArticleQuestionMaterialsByIds({
  ownerUserId,
  clientId,
  ids: [listed[0].id],
})
assert.equal(selected.length, 1)
const isolated = await getArticleQuestionMaterialsByIds({
  ownerUserId: "user_other",
  clientId,
  ids: [listed[0].id],
})
assert.equal(isolated.length, 0)

assert.equal(await deleteArticleQuestionMaterials({
  ownerUserId,
  clientId,
  ids: [listed[0].id],
}), 1)
assert.equal((await listArticleQuestionMaterials(ownerUserId, clientId)).length, 3)
assert.equal(await deleteArticleQuestionMaterials({
  ownerUserId,
  clientId,
  importBatchId: first.importBatchId,
}), 3)
assert.equal((await listArticleQuestionMaterials(ownerUserId, clientId)).length, 0)

const pairClientId = "client_pair_dedup"
await importArticleQuestionMaterials({
  ownerUserId,
  clientId: pairClientId,
  actorUserId: ownerUserId,
  importBatchId: "aqi_pair_batch_one",
  sourceFileName: "第一批.xlsx",
  rows: [{ rowNumber: 2, question: "同一问题？", matchedAdvantage: "优势一" }],
})
const secondPairBatch = await importArticleQuestionMaterials({
  ownerUserId,
  clientId: pairClientId,
  actorUserId: ownerUserId,
  importBatchId: "aqi_pair_batch_two",
  sourceFileName: "第二批.xlsx",
  rows: [
    { rowNumber: 2, question: "同一问题", matchedAdvantage: "优势一" },
    { rowNumber: 3, question: "同一问题", matchedAdvantage: "优势二" },
  ],
})
assert.equal(secondPairBatch.createdCount, 1)
assert.equal(secondPairBatch.skippedCount, 1)
assert.equal(secondPairBatch.created[0].matchedAdvantage, "优势二")
assert.equal((await listArticleQuestionMaterials(ownerUserId, pairClientId)).length, 2)

await fs.rm(directory, { recursive: true, force: true })
console.log("article question material store tests passed")
