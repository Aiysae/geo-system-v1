import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type {
  PenetrationHistoryRequestSnapshot,
  PenetrationResult,
} from "../src/types"

const testDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "geo-penetration-history-"))
process.env.PENETRATION_HISTORY_STORE = "file"
process.env.PENETRATION_HISTORY_FILE = path.join(testDirectory, "history.json")

const {
  buildPenetrationHistoryRecord,
  deletePenetrationHistoryRecord,
  getPenetrationHistoryRecord,
  listPenetrationHistoryRecords,
  savePenetrationHistoryRecord,
} = await import("../src/lib/penetration/history-store")

const request: PenetrationHistoryRequestSnapshot = {
  clientId: "client-history-test",
  clientName: "历史记录测试客户",
  ourBrand: "势途",
  brandAliases: ["SHITU"],
  industry: "GEO 服务",
  website: "https://shitugeo.top",
  questions: ["GEO 服务哪家好？", "如何选择 GEO 服务商？"],
  competitors: ["测试竞品"],
  models: ["doubao", "qwen"],
  activeModels: ["doubao", "qwen"],
  skippedModels: [],
  operation: "replace",
}

const result: PenetrationResult = {
  byModel: {
    doubao: [{
      sampleId: "sample-doubao-1",
      sampledAt: "2026-07-17T01:00:00.000Z",
      question: request.questions[0],
      answer: "可以考虑势途，也可以比较测试竞品。",
      mentionedBrands: ["势途", "测试竞品"],
      topRecommended: "势途",
      hitOur: true,
      webVerified: true,
      searchSources: [{
        title: "测试文章",
        url: "https://example.com/article",
        domain: "example.com",
        snippet: "测试",
        query: request.questions[0],
      }],
    }],
    qwen: [{
      sampleId: "sample-qwen-1",
      sampledAt: "2026-07-17T01:00:01.000Z",
      question: request.questions[1],
      answer: "建议比较服务经验和可验证案例。",
      mentionedBrands: [],
      topRecommended: null,
      hitOur: false,
      webVerified: true,
      searchSources: [{
        title: "另一篇文章",
        url: "https://example.org/article",
        domain: "example.org",
        snippet: "测试",
        query: request.questions[1],
      }],
    }],
  },
  aggregated: {
    penetrationRate: 0.5,
    ourMentions: 1,
    totalSlots: 2,
    industryShare: [
      { brand: "势途", count: 1, ratio: 0.5, penetrationRate: 0.5 },
      { brand: "测试竞品", count: 1, ratio: 0.5, penetrationRate: 0.5 },
    ],
    ourRanking: 1,
    perModelRate: [
      { model: "doubao", rate: 1, mentions: 1, total: 1 },
      { model: "qwen", rate: 0, mentions: 0, total: 1 },
    ],
    missedQuestions: [request.questions[1]],
    topCompetitors: ["测试竞品"],
  },
  generatedAt: "2026-07-17T01:00:02.000Z",
}

try {
  const owner = "history-owner"
  const record = buildPenetrationHistoryRecord({
    id: "pjob_history_main",
    request,
    status: "succeeded",
    result,
    completedSlots: 2,
    totalSlots: 2,
    createdAt: "2026-07-17T00:59:00.000Z",
    completedAt: result.generatedAt,
  })

  await savePenetrationHistoryRecord(owner, record)
  await savePenetrationHistoryRecord(owner, {
    ...record,
    updatedAt: "2026-07-17T01:00:03.000Z",
  })

  const firstPage = await listPenetrationHistoryRecords(owner)
  assert.equal(firstPage.total, 1, "same job id must upsert instead of duplicating")
  assert.equal(firstPage.items[0]?.summary.sourceCount, 2)
  assert.equal("result" in firstPage.items[0]!, false, "list endpoint must omit full result")
  assert.equal((await listPenetrationHistoryRecords("different-owner")).total, 0)
  assert.equal(await getPenetrationHistoryRecord("different-owner", record.id), null)

  const detail = await getPenetrationHistoryRecord(owner, record.id)
  assert.equal(detail?.result?.byModel.doubao?.[0]?.answer, result.byModel.doubao?.[0]?.answer)
  assert.equal(detail?.dashboard.brandVoice[0]?.brand, "势途")
  assert.equal(detail?.dashboard.keywordCompetition.length, 1)

  const failed = buildPenetrationHistoryRecord({
    id: "pjob_history_failed",
    request: { ...request, clientId: "client-failed", operation: "append" },
    status: "failed",
    error: "provider unavailable",
    completedSlots: 0,
    totalSlots: 2,
    createdAt: "2026-07-16T00:00:00.000Z",
    completedAt: "2026-07-16T00:01:00.000Z",
  })
  await savePenetrationHistoryRecord(owner, failed)

  const failedOnly = await listPenetrationHistoryRecords(owner, { status: "failed" })
  assert.equal(failedOnly.total, 1)
  assert.equal(failedOnly.items[0]?.id, failed.id)
  const appendOnly = await listPenetrationHistoryRecords(owner, { operation: "append" })
  assert.equal(appendOnly.total, 1)
  const clientOnly = await listPenetrationHistoryRecords(owner, { clientId: request.clientId })
  assert.equal(clientOnly.total, 1)

  for (let index = 0; index < 3; index++) {
    await savePenetrationHistoryRecord(owner, {
      ...record,
      id: `pjob_history_page_${index}`,
      createdAt: `2026-07-17T02:0${index}:00.000Z`,
      completedAt: `2026-07-17T02:0${index}:01.000Z`,
      updatedAt: `2026-07-17T02:0${index}:01.000Z`,
    })
  }
  const paged = await listPenetrationHistoryRecords(owner, { page: 1, pageSize: 2 })
  assert.equal(paged.items.length, 2)
  assert.equal(paged.total, 5)
  assert.equal(paged.hasMore, true)

  assert.equal(await deletePenetrationHistoryRecord("different-owner", record.id), false)
  assert.equal(await deletePenetrationHistoryRecord(owner, record.id), true)
  assert.equal(await getPenetrationHistoryRecord(owner, record.id), null)
  assert.equal(await deletePenetrationHistoryRecord(owner, record.id), false)

  console.log("penetration history: idempotency, isolation, filters, pagination and deletion passed")
} finally {
  await fs.rm(testDirectory, { recursive: true, force: true })
}
