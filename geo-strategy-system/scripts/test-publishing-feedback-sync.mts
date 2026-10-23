import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Client } from "../src/types"

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "geo-publishing-feedback-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(directory, "kv.json")
process.env.PUBLISHING_PLAN_STORE = "file"
process.env.PUBLISHING_PLAN_FILE = path.join(directory, "publishing-plans.json")
process.env.WORKSPACE_STORE = "file"
process.env.WORKSPACE_FILE = path.join(directory, "workspaces.json")
process.env.WORKSPACE_FILE_PATH = path.join(directory, "workspaces.json")
process.env.TEAM_FILE = path.join(directory, "teams.json")

const { createWorkspaceClient } = await import("../src/lib/workspace-store")
const publishingStore = await import("../src/lib/publishing-plan/store")
const feedbackStore = await import("../src/lib/client-feedback/store")
const { writeFeedback, feedbackActionId } = await import("../src/lib/local-publishing/feedback-sync")
const { closeKvConnection } = await import("../src/lib/kv")

const owner = "publishing-feedback-owner"
const client: Client = {
  id: "publishing-feedback-client",
  name: "分发回写测试客户",
  subjectType: "brand",
  ourBrand: "回写测试品牌",
  brandAliases: [],
  industry: "企业服务",
  website: "https://example.com",
  questions: [],
  competitors: [],
  selectedModels: ["qwen"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

// Noon in Shanghai on the given date, which is how reconciliation buckets a publication.
const shanghaiNoon = (date: string) => Date.parse(`${date}T12:00:00+08:00`)
const task = (id: string, publishedAt: number, url: string) => ({
  id,
  owner,
  client_id: client.id,
  team_id: null,
  remote_url: url,
  published_at: publishedAt,
  updated_at: publishedAt,
  title: `回写测试 ${id}`,
  content_type: "article" as const,
  platform: "CSDN",
  platform_name: "CSDN",
  account_name: "测试账号",
})

try {
  await createWorkspaceClient(owner, client)
  const draft = await publishingStore.createPublishingPlanDraft({
    ownerUserId: owner,
    clientId: client.id,
    clientName: client.name,
    createdByUserId: owner,
    input: {
      capacityMode: "existing_accounts",
      totalServiceFeeCents: 100_000,
      executionCostRateBps: 3_000,
      startDate: "2026-09-01",
      endDate: "2026-09-07",
      periodMode: "service",
      customerStage: "new_launch",
      firstMonthBudgetBps: 5_000,
      firstSevenDaysBudgetBps: 5_000,
      contentCreationCostsCents: { article: 0, authority_article: 0, video: 0 },
      platformConfigs: [{
        id: "csdn",
        platformKey: "csdn",
        platformName: "CSDN",
        category: "self_media",
        contentType: "article",
        enabled: true,
        weightBps: 10_000,
        dailyLimitPerAccount: 10,
        safeUtilizationBps: 10_000,
        existingAccountCount: 1,
        publishUnitCostCents: 300,
        maxReusePlatforms: 1,
      }],
    },
    questionMaterials: [{ id: "question-1", question: "如何选择服务？", matchedAdvantage: "流程透明" }],
  })
  await publishingStore.activatePublishingPlan(owner, draft.id)
  const plan = await publishingStore.getPublishingPlan(owner, draft.id, true)
  assert.ok(plan)
  const plannedDate = plan.calculation.tasks.filter(item => item.platformKey === "csdn")
    .map(item => item.plannedDate).sort()[0]
  assert.ok(plannedDate, "the test plan should schedule a CSDN task")
  const completedOn = async (date: string) => (await publishingStore.listPublishingTasks(owner, plan.id, { date }))
    .filter(item => item.status === "completed")

  // A published article on a planned day completes that day's CSDN task.
  const matched = task("lp-matched", shanghaiNoon(plannedDate), "https://blog.csdn.net/demo/article/details/101")
  assert.deepEqual(await writeFeedback(matched), { state: "matched", message: "已计入发布计划" })
  const done = await completedOn(plannedDate)
  assert.equal(done.length, 1)
  assert.equal(done[0].publishedUrl, "https://blog.csdn.net/demo/article/details/101")
  const action = await feedbackStore.getClientExecutionAction(owner, client.id, feedbackActionId(matched.id))
  assert.ok(action, "the publication is recorded in execution feedback")
  assert.equal(action.source, "system")
  assert.equal(action.category, "self_media_publish")
  assert.equal(action.publicationReconciliation?.status, "matched")

  // A repeated pass (for example after a crash before the outcome was saved) does not count twice.
  assert.equal((await writeFeedback(matched)).state, "matched")
  assert.equal((await completedOn(plannedDate)).length, 1)
  const actions = (await feedbackStore.listClientExecutionActions(owner, client.id))
    .filter(item => item.id === feedbackActionId(matched.id))
  assert.equal(actions.length, 1)

  // Outside the plan's dates the publication is still recorded, as unplanned.
  const unplanned = task("lp-unplanned", shanghaiNoon("2026-12-01"), "https://blog.csdn.net/demo/article/details/102")
  assert.equal((await writeFeedback(unplanned)).state, "unplanned")
  assert.ok(await feedbackStore.getClientExecutionAction(owner, client.id, feedbackActionId(unplanned.id)))

  // Neither the link nor the platform is recognized: recorded for review, not matched.
  const unknown = {
    ...task("lp-unknown", shanghaiNoon(plannedDate), "https://unknown-platform.example/post/1"),
    platform: "NewPlatform",
    platform_name: "新平台",
  }
  assert.equal((await writeFeedback(unknown)).state, "needs_review")
  assert.equal((await completedOn(plannedDate)).length, 1)

  // An unrecognized link still matches through the platform the publisher posted to.
  const declared = task("lp-declared", shanghaiNoon(plannedDate), "https://unknown-platform.example/post/2")
  assert.equal((await writeFeedback(declared)).state, "matched")
  assert.equal((await completedOn(plannedDate)).length, 2)

  // Someone without access to the client cannot write into its feedback.
  const stranger = { ...task("lp-denied", shanghaiNoon(plannedDate), "https://blog.csdn.net/demo/article/details/103"), owner: "someone-else" }
  assert.equal((await writeFeedback(stranger)).state, "denied")
  assert.equal(await feedbackStore.getClientExecutionAction(owner, client.id, feedbackActionId(stranger.id)), null)

  console.log("PASS publishing feedback sync: matched, idempotent, unplanned, needs review, denied")
} finally {
  await closeKvConnection?.()
  await fs.rm(directory, { recursive: true, force: true })
}
