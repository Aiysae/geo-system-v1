import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import sharp from "sharp"
import type * as ImportModule from "../../../src/lib/local-publishing/production-import"
import type * as WorkspaceModule from "../../../src/lib/workspace-store"
import type * as BatchModule from "../../../src/lib/article-batches/store"
import type * as MediaModule from "../../../src/lib/article-media/assets"
import type * as ServiceModule from "../../../src/lib/local-publishing/service"
import type * as TeamModule from "../../../src/lib/team-store"
import type * as RunModule from "../../../src/lib/content-production/store"
import type { ContentProductionRun } from "../../../src/types/content-production"

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "geo-production-import-"))
process.env.WORKSPACE_STORE = "file"
process.env.WORKSPACE_FILE_PATH = path.join(directory, "workspaces.json")
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(directory, "kv.json")
process.env.ARTICLE_BATCH_STORE = "kv"
process.env.ARTICLE_MEDIA_STORE = "kv"
process.env.ARTICLE_MEDIA_ASSETS_DIR = path.join(directory, "media")
process.env.TASK_CENTER_STORE = "kv"
process.env.SYSTEM_OUTPUT_STORE = "file"
process.env.SYSTEM_OUTPUT_FILE = path.join(directory, "outputs.json")
process.env.TEAM_STORE = "file"
process.env.TEAM_FILE = path.join(directory, "teams.json")
process.env.CONTENT_PRODUCTION_STORE = "file"
process.env.CONTENT_PRODUCTION_FILE = path.join(directory, "production-runs.json")
process.env.LOCAL_PUBLISHER_DATA_DIR = path.join(directory, "publishing")
process.env.GEO_LOCAL_PUBLISHING = "1"
const require = createRequire(import.meta.url)
const { importProductionArticles, listProductionImportSources } = require("../../../src/lib/local-publishing/production-import.ts") as typeof ImportModule
const { createWorkspaceClient } = require("../../../src/lib/workspace-store.ts") as typeof WorkspaceModule
const { createStoredArticleBatchInput, saveStoredArticleBatch } = require("../../../src/lib/article-batches/store.ts") as typeof BatchModule
const { createArticleMediaAsset } = require("../../../src/lib/article-media/assets.ts") as typeof MediaModule
const { publishingService } = require("../../../src/lib/local-publishing/service.ts") as typeof ServiceModule
const { createTeam, saveTeamMember, saveTeamClientShare } = require("../../../src/lib/team-store.ts") as typeof TeamModule
const { createContentProductionRun } = require("../../../src/lib/content-production/store.ts") as typeof RunModule
const now = new Date().toISOString()
try {
  for (const owner of ["import-one", "import-other"]) await createWorkspaceClient(owner, {
    id: `client-${owner}`, name: "导入验收客户", subjectType: "brand", ourBrand: "验收品牌", industry: "测试",
    website: "https://example.com", questions: [], competitors: [], selectedModels: [], createdAt: now, updatedAt: now,
  })
  const current = { kind: "current", clientId: "client-import-one", title: "单篇测试", markdown: "# 单篇测试\n\n正文内容。", metadata: { summary: "保留摘要", tags: ["测试标签"], original: true } }
  await assert.rejects(() => importProductionArticles("import-other", current), /无权|不存在/)
  const first = await importProductionArticles("import-one", current)
  assert.equal(first.articles.length, 1)
  assert.equal(first.articles[0].metadata?.digest, "保留摘要")
  assert.deepEqual(first.articles[0].metadata?.tags, ["测试标签"])
  assert.equal(first.results[0].status, "created")
  assert.equal((await importProductionArticles("import-one", current)).reused, 1)
  const updated = await importProductionArticles("import-one", { ...current, markdown: "# 单篇测试\n\n生成稿第二版正文。" })
  assert.equal(updated.results[0].status, "new_version")
  assert.notEqual(updated.articleIds[0], first.articleIds[0])
  const image = await createArticleMediaAsset({ ownerUserId: "import-one", clientId: current.clientId, batchId: "batch-import-test", originalName: "图片.png", buffer: await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).png().toBuffer() })
  const batch = createStoredArticleBatchInput({ id: "batch-import-test", ownerUserId: "import-one", clientId: current.clientId, requestId: "import-test-batch-0001", promptKey: "thirdPartyObservation", promptTitle: "导入测试", modelProvider: "deepseek", model: "test", topicMode: "custom", similarityRetry: false,
    basePayload: { clientName: "导入验收客户", brandName: "验收品牌", subjectType: "brand", subjectContext: "", industry: "测试", website: "https://example.com" } as BatchModule.ArticleBatchBasePayload,
    items: [1, 2].map(index => ({ id: `item-${index}`, position: index, topic: `批量测试${index}`, brief: "测试", requestId: `request-${index}`, status: "succeeded", title: `批量测试${index}`, markdown: "正文。", progressPercent: 100, stage: "完成", attempt: 1, updatedAt: now, mediaRevision: { id: `revision-${index}`, version: 1, sourceHash: "source", markdown: `配图正文。\n\n![测试图片](/api/article-generation/assets/${image.id}/content)`, template: "opening", mappingMode: "same_set", assetIds: [image.id], placements: [{ assetId: image.id, alt: "测试图片", anchor: "opening", blockIndex: 1 }], createdAt: now, updatedAt: now } })),
  })
  batch.status = "succeeded"
  await saveStoredArticleBatch(batch)
  const browse = await listProductionImportSources("import-one", { clientId: current.clientId })
  assert.equal("batches" in browse && browse.batches?.[0].items.length, 2)
  const otherBrowse = await listProductionImportSources("import-other", { clientId: "client-import-other" })
  assert.equal("batches" in otherBrowse && otherBrowse.batches?.length, 0)
  await assert.rejects(() => importProductionArticles("import-other", { kind: "batch", batchId: batch.id }), /不存在|无权/)
  await assert.rejects(() => importProductionArticles("import-one", { kind: "batch", batchId: batch.id, itemIds: ["not-in-batch"] }), /不属于/)
  const imported = await importProductionArticles("import-one", { kind: "batch", batchId: batch.id, variant: "media" })
  assert.equal(imported.articleIds.length, 2)
  for (const article of imported.articles) {
    assert.match(article.markdown!, /local-asset:lpa_/)
    assert.equal(article.markdown?.includes("/api/article-generation/assets/"), false)
    assert.equal(article.metadata?.source?.batchId, batch.id)
  }
  const state = await publishingService().request("import-one", "state") as { tasks: unknown[]; assets: unknown[] }
  assert.equal(state.tasks.length, 0, "import must not submit or schedule platform tasks")
  const duplicate = await importProductionArticles("import-one", { kind: "batch", batchId: batch.id, variant: "media" })
  assert.equal(duplicate.reused, 2)
  const after = await publishingService().request("import-one", "state") as { assets: unknown[] }
  assert.equal(after.assets.length, state.assets.length, "repeat import must not copy image assets again")

  const team = await createTeam({ ownerUserId: "import-team-owner", name: "共享客户导入测试" })
  for (const [userId, permissionKeys] of [
    ["import-team-writer", ["article.view", "article.execute", "article.export"]],
    ["import-team-exporter", ["article.view", "article.export"]],
    ["import-team-viewer", ["article.view"]],
  ] as const) {
    await saveTeamMember({ teamId: team.id, userId, role: "member", permissionKeys: [...permissionKeys], operatorUserId: team.ownerUserId })
  }
  await saveTeamClientShare({ teamId: team.id, clientOwnerUserId: "import-one", clientId: current.clientId, clientName: "导入验收客户", operatorUserId: "import-one" })
  const runBatch = createStoredArticleBatchInput({
    id: "batch-production-shared", ownerUserId: "import-team-writer", clientId: current.clientId, teamId: team.id,
    requestId: "shared-production-batch-0001", promptKey: "thirdPartyObservation", promptTitle: "共享生产导入测试", modelProvider: "deepseek", model: "test", topicMode: "custom", similarityRetry: false,
    basePayload: { clientName: "导入验收客户", brandName: "验收品牌", subjectType: "brand", subjectContext: "", industry: "测试", website: "https://example.com" } as BatchModule.ArticleBatchBasePayload,
    items: [{ id: "shared-article", position: 1, topic: "共享文章", brief: "测试", requestId: "shared-article-request", status: "succeeded", title: "共享生产文章", markdown: "# 共享生产文章\n\n真实正文。", progressPercent: 100, stage: "完成", attempt: 1, updatedAt: now }],
  })
  runBatch.status = "succeeded"
  await saveStoredArticleBatch(runBatch)
  const run: ContentProductionRun = {
    id: "production-shared-run", ownerUserId: "import-one", clientId: current.clientId, clientName: "导入验收客户", planId: "shared-plan", planVersion: 1,
    requestId: "shared-production-run-0001", createdByUserId: "import-team-writer", articleOwnerUserId: "import-team-writer", billingUserId: "import-team-writer", teamId: team.id,
    dateFrom: "2026-10-20", dateTo: "2026-10-20", selectedPlatformKeys: [], modelProvider: "deepseek", model: "test", status: "succeeded", stage: "完成",
    requestedPublicationCount: 1, requestedAssetCount: 1, completedCount: 1, passedCount: 1, reviewRequiredCount: 0, failedCount: 0, cancelledCount: 0,
    childBatches: [{ id: runBatch.id, requestId: runBatch.requestId, itemIds: ["production-item"], createdAt: now }],
    items: [{ id: "production-item", assetId: "asset-shared", contentType: "article", plannedDate: "2026-10-20", question: "共享文章问题", reuseMode: "master_reuse", targetPlatform: "universal", deliveries: [], articleBatchId: runBatch.id, articleItemId: "shared-article", status: "ready", createdAt: now, updatedAt: now }],
    createdAt: now, updatedAt: now,
  }
  await createContentProductionRun(run)
  const sharedSources = await listProductionImportSources("import-team-exporter", { clientId: current.clientId, teamId: team.id })
  assert.equal("runs" in sharedSources && sharedSources.runs?.[0].items[0].hasDraft, true)
  const preview = await listProductionImportSources("import-team-exporter", { clientId: current.clientId, teamId: team.id, runId: run.id, itemId: "production-item" })
  assert.ok("preview" in preview && preview.preview)
  assert.match(preview.preview.markdown, /真实正文/)
  await assert.rejects(() => importProductionArticles("import-team-exporter", { kind: "batch", batchId: runBatch.id, itemIds: ["shared-article"] }), /不存在|无权/)
  await assert.rejects(() => importProductionArticles("import-team-viewer", { kind: "production_run", runId: run.id, clientId: current.clientId, teamId: team.id, itemIds: ["production-item"] }), /权限|导出/)
  await assert.rejects(() => importProductionArticles("import-team-outsider", { kind: "production_run", runId: run.id, clientId: current.clientId, teamId: team.id, itemIds: ["production-item"] }), /无权|共享/)
  await assert.rejects(() => importProductionArticles("import-team-exporter", { kind: "production_run", runId: run.id, clientId: current.clientId, teamId: team.id, itemIds: ["not-in-run"] }), /不属于|尚未完成/)
  const sharedImport = await importProductionArticles("import-team-exporter", { kind: "production_run", runId: run.id, clientId: current.clientId, teamId: team.id, itemIds: ["production-item"] })
  assert.equal(sharedImport.articles.length, 1)
  assert.equal(sharedImport.articles[0].metadata?.source?.batchId, runBatch.id)
  assert.equal((await importProductionArticles("import-team-exporter", { kind: "production_run", runId: run.id, clientId: current.clientId, teamId: team.id, itemIds: ["production-item"] })).reused, 1)
  const sharedState = await publishingService().request("import-team-exporter", "state") as { tasks: unknown[] }
  assert.equal(sharedState.tasks.length, 0, "shared import must not submit platform tasks")
  console.log("Production import tests passed: ownership, current/batch/shared-run imports, source versions, private image copies, deduplication, no publishing tasks.")
} finally {
  const service = publishingService()
  if (service.watchdog) clearInterval(service.watchdog)
  service.child?.kill()
  await new Promise(resolve => setTimeout(resolve, 100))
  fs.rmSync(directory, { recursive: true, force: true })
}
