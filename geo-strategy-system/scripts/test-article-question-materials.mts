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
  existingQuestionTexts: ["系统已有问题？"],
  rows: [
    { rowNumber: 2, question: "系统已有问题", matchedAdvantage: "不会导入" },
    { rowNumber: 3, question: "问题 A？", matchedAdvantage: "优势 A", keyword: "关键词 A" },
    { rowNumber: 4, question: "问题 B？" },
    { rowNumber: 5, question: "问题A", matchedAdvantage: "重复优势" },
  ],
})

assert.equal(first.createdCount, 2)
assert.equal(first.skippedCount, 2)
assert.equal(first.warningCount, 1)
assert.deepEqual(first.created.map(item => item.question), ["问题 A？", "问题 B？"])

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
assert.equal(listed.length, 2)
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
assert.equal((await listArticleQuestionMaterials(ownerUserId, clientId)).length, 1)
assert.equal(await deleteArticleQuestionMaterials({
  ownerUserId,
  clientId,
  importBatchId: first.importBatchId,
}), 1)
assert.equal((await listArticleQuestionMaterials(ownerUserId, clientId)).length, 0)

await fs.rm(directory, { recursive: true, force: true })
console.log("article question material store tests passed")
