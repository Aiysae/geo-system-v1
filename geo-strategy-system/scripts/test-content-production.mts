import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { ContentProductionRun } from "../src/types/content-production"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-content-production-"))
process.env.CONTENT_PRODUCTION_STORE = "file"
process.env.CONTENT_PRODUCTION_FILE = path.join(tempDir, "runs.json")

const profiles = await import("../src/lib/publishing-plan/platform-profiles")
const store = await import("../src/lib/content-production/store")

const sohu = profiles.resolvePublishingPlatformProfile({
  platformKey: "source:sohu.com",
  platformName: "搜狐号",
  contentType: "article",
})
assert.equal(sohu.geoPlatform, "sohu")
assert.equal(sohu.defaultReuseMode, "master_reuse")

const csdn = profiles.resolvePublishingPlatformProfile({
  platformKey: "csdn",
  platformName: "CSDN",
  contentType: "article",
})
assert.equal(csdn.supportsMarkdown, true)
assert.equal(csdn.geoPlatform, "universal")

const customVideo = profiles.resolvePublishingPlatformProfile({
  platformKey: "custom-video",
  platformName: "本地视频号",
  contentType: "video",
})
assert.equal(customVideo.geoPlatform, "douyin")

const now = "2026-08-18T00:00:00.000Z"
const run: ContentProductionRun = {
  id: "cprod-test",
  ownerUserId: "owner-a",
  clientId: "client-a",
  clientName: "测试客户",
  planId: "plan-a",
  planVersion: 1,
  requestId: "content_production_test_001",
  createdByUserId: "user-a",
  articleOwnerUserId: "user-a",
  billingUserId: "billing-a",
  dateFrom: "2026-08-18",
  dateTo: "2026-08-18",
  selectedPlatformKeys: ["sohu", "toutiao"],
  modelProvider: "doubao",
  model: "test-model",
  status: "preparing",
  stage: "准备中",
  requestedPublicationCount: 2,
  requestedAssetCount: 1,
  completedCount: 0,
  passedCount: 0,
  reviewRequiredCount: 0,
  failedCount: 0,
  cancelledCount: 0,
  childBatches: [],
  items: [{
    id: "cpitem-a",
    assetId: "asset-a",
    contentType: "article",
    plannedDate: "2026-08-18",
    question: "测试问题",
    matchedAdvantage: "测试优势",
    reuseMode: "master_reuse",
    targetPlatform: "universal",
    deliveries: [
      { publishingTaskId: "task-a", plannedDate: "2026-08-18", platformKey: "sohu", platformName: "搜狐", accountSlot: 1 },
      { publishingTaskId: "task-b", plannedDate: "2026-08-18", platformKey: "toutiao", platformName: "今日头条", accountSlot: 1 },
    ],
    status: "planned",
    createdAt: now,
    updatedAt: now,
  }],
  createdAt: now,
  updatedAt: now,
}

const created = await store.createContentProductionRun(run)
assert.equal(created.reused, false)
const duplicate = await store.createContentProductionRun({ ...run, id: "cprod-duplicate" })
assert.equal(duplicate.reused, true)
assert.equal(duplicate.run.id, run.id)

const mutated = await store.mutateContentProductionRun("owner-a", run.id, current => {
  current.status = "queued"
  current.stage = "排队中"
})
assert.equal(mutated?.run.status, "queued")
assert.equal((await store.listContentProductionRuns("owner-a", "client-a")).length, 1)
assert.equal((await store.getContentProductionRun("owner-a", run.id))?.items[0].deliveries.length, 2)
assert.equal((await store.getContentProductionRunById(run.id))?.billingUserId, "billing-a")
assert.deepEqual(
  (await store.listPendingContentProductionRuns()).map(item => item.id),
  [run.id],
)

await store.closeContentProductionStoreConnection()
fs.rmSync(tempDir, { recursive: true, force: true })
console.log("Content production platform profiles, idempotency and storage passed")
