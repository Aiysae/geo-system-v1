import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { SystemOutputRecord } from "../src/types/system-output"

const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "geo-system-outputs-"))
const outputFile = path.join(temporaryDirectory, "outputs.json")
process.env.SYSTEM_OUTPUT_STORE = "file"
process.env.SYSTEM_OUTPUT_FILE = outputFile

const {
  getSystemOutputRecord,
  getSystemOutputRecordScope,
  listSystemOutputRecords,
  saveSystemOutputRecord,
  systemOutputRecordId,
} = await import("../src/lib/system-output/store")

const ownerUserId = "owner_system_output_test"
const base: SystemOutputRecord = {
  id: systemOutputRecordId(ownerUserId, "research", "bgjob_test_1"),
  taskId: "bgjob_test_1",
  actorUserId: "actor_test",
  clientId: "client_test",
  clientName: "测试客户",
  module: "research",
  kind: "independent_research",
  status: "succeeded",
  source: "job",
  summary: {
    title: "测试客户 · 独立调研",
    subjectName: "测试品牌",
    primaryMetricLabel: "调研维度",
    primaryMetricValue: "6 项",
  },
  request: { ourBrand: "测试品牌", industry: "测试行业" },
  result: { generatedAt: "2026-07-30T01:00:00.000Z", executiveSummary: "第一版结果" },
  schemaVersion: 1,
  createdAt: "2026-07-30T00:59:00.000Z",
  completedAt: "2026-07-30T01:00:00.000Z",
  updatedAt: "2026-07-30T01:00:00.000Z",
}

try {
  const first = await saveSystemOutputRecord(ownerUserId, base)
  assert.equal(first.created, true)

  const duplicate = await saveSystemOutputRecord(ownerUserId, {
    ...base,
    result: { generatedAt: "2026-07-30T02:00:00.000Z", executiveSummary: "不应覆盖" },
  })
  assert.equal(duplicate.created, false)
  assert.deepEqual(duplicate.record.result, base.result)

  const difficulty: SystemOutputRecord = {
    ...base,
    id: systemOutputRecordId(ownerUserId, "difficulty", "djob_test_1"),
    taskId: "djob_test_1",
    module: "difficulty",
    kind: "difficulty_assessment",
    summary: {
      title: "测试客户 · GEO 难度测评",
      subjectName: "测试品牌",
      primaryMetricLabel: "难度总分",
      primaryMetricValue: "68/100",
    },
    request: { targetBrand: "测试品牌" },
    result: { totalScore: 68, level: "困难" },
    completedAt: "2026-07-30T02:00:00.000Z",
    updatedAt: "2026-07-30T02:00:00.000Z",
  }
  await saveSystemOutputRecord(ownerUserId, difficulty)

  const researchPage = await listSystemOutputRecords(ownerUserId, {
    clientId: "client_test",
    module: "research",
    page: 1,
    pageSize: 20,
  })
  assert.equal(researchPage.total, 1)
  assert.equal(researchPage.items[0].hasRequest, true)
  assert.equal(researchPage.items[0].hasResult, true)
  assert.equal("request" in researchPage.items[0], false)
  assert.equal("result" in researchPage.items[0], false)

  const detail = await getSystemOutputRecord(ownerUserId, base.id)
  assert.deepEqual(detail?.result, base.result)

  const scope = await getSystemOutputRecordScope(difficulty.id)
  assert.deepEqual(scope, {
    ownerUserId,
    clientId: "client_test",
    module: "difficulty",
  })

  const firstPage = await listSystemOutputRecords(ownerUserId, {
    clientId: "client_test",
    module: "difficulty",
    page: 1,
    pageSize: 1,
  })
  assert.equal(firstPage.items.length, 1)
  assert.equal(firstPage.hasMore, false)

  console.log("System output store tests passed")
} finally {
  await fs.rm(temporaryDirectory, { recursive: true, force: true })
}
