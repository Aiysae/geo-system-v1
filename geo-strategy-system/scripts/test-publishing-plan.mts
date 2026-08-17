import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-publishing-plan-"))
process.env.PUBLISHING_PLAN_STORE = "file"
process.env.PUBLISHING_PLAN_FILE = path.join(tempDir, "plans.json")

const calculator = await import("../src/lib/publishing-plan/calculator")
const store = await import("../src/lib/publishing-plan/store")
const taskService = await import("../src/lib/publishing-plan/task-service")

const input = {
  totalServiceFeeCents: 1_000_000,
  executionCostRateBps: 3_250,
  startDate: "2026-09-01",
  endDate: "2026-11-30",
  periodMode: "service" as const,
  customerStage: "new_launch" as const,
  firstMonthBudgetBps: 5_000,
  firstSevenDaysBudgetBps: 5_000,
  contentCreationCostsCents: {
    article: 1_000,
    authority_article: 2_000,
    video: 3_000,
  },
  platformConfigs: [
    {
      id: "sohu",
      platformKey: "sohu",
      platformName: "搜狐",
      category: "self_media" as const,
      contentType: "article" as const,
      enabled: true,
      weightBps: 4_000,
      dailyLimitPerAccount: 3,
      safeUtilizationBps: 8_000,
      existingAccountCount: 1,
      publishUnitCostCents: 300,
      maxReusePlatforms: 4,
    },
    {
      id: "zhihu",
      platformKey: "zhihu",
      platformName: "知乎",
      category: "self_media" as const,
      contentType: "article" as const,
      enabled: true,
      weightBps: 3_000,
      dailyLimitPerAccount: 2,
      safeUtilizationBps: 8_000,
      existingAccountCount: 1,
      publishUnitCostCents: 300,
      maxReusePlatforms: 4,
    },
    {
      id: "authority",
      platformKey: "xinhua",
      platformName: "新华网",
      category: "authority_media" as const,
      contentType: "authority_article" as const,
      enabled: true,
      weightBps: 2_000,
      dailyLimitPerAccount: 1,
      safeUtilizationBps: 8_000,
      existingAccountCount: 0,
      publishUnitCostCents: 5_000,
      maxReusePlatforms: 2,
    },
    {
      id: "douyin",
      platformKey: "douyin",
      platformName: "抖音",
      category: "self_media" as const,
      contentType: "video" as const,
      enabled: true,
      weightBps: 1_000,
      dailyLimitPerAccount: 2,
      safeUtilizationBps: 8_000,
      existingAccountCount: 1,
      publishUnitCostCents: 1_000,
      maxReusePlatforms: 2,
    },
  ],
}

const calculated = calculator.calculatePublishingPlan(input, {
  ownerUserId: "owner-a",
  clientId: "client-a",
  planId: "plan-test",
  planVersion: 1,
  now: "2026-08-17T00:00:00.000Z",
  questionMaterials: [
    { id: "q1", question: "哪个品牌值得选择？", matchedAdvantage: "可核验案例" },
    { id: "q2", question: "如何判断服务是否专业？", matchedAdvantage: "标准服务流程" },
  ],
})

assert.equal(calculated.summary.executionBudgetCents, 325_000)
assert.equal(calculated.windows.reduce((sum, window) => sum + window.budgetCents, 0), 325_000)
assert.equal(calculated.windows[0].label, "首月前 7 天冲刺")
assert.equal(calculated.windows[0].budgetCents, 81_250)
assert.ok(calculated.summary.plannedCostCents <= calculated.summary.executionBudgetCents)
assert.equal(calculated.summary.totalPublicationCount, calculated.tasks.length)
assert.equal(calculated.summary.uniqueContentCount, calculated.assets.length)
assert.ok(calculated.summary.reusedPublicationCount > 0)
assert.ok(calculated.platformQuotas.some(item => item.accountGap > 0))

assert.throws(() => calculator.calculatePublishingPlan({
  ...input,
  platformConfigs: [input.platformConfigs[0], { ...input.platformConfigs[1], platformKey: "sohu" }],
}, {
  ownerUserId: "owner-a",
  clientId: "client-a",
  planId: "plan-duplicate-platform",
  planVersion: 1,
}), /平台标识重复/)

assert.throws(() => calculator.calculatePublishingPlan({
  ...input,
  contentCreationCostsCents: { article: 0, authority_article: 0, video: 0 },
  platformConfigs: [{ ...input.platformConfigs[0], publishUnitCostCents: 0 }],
}, {
  ownerUserId: "owner-a",
  clientId: "client-a",
  planId: "plan-zero-cost",
  planVersion: 1,
}), /不能同时为 0/)

const uniquePairs = new Set(calculated.tasks.map(task => `${task.assetId}\u0000${task.platformKey}`))
assert.equal(uniquePairs.size, calculated.tasks.length, "同一内容不能在相同平台重复")
for (const task of calculated.tasks) {
  const quota = calculated.platformQuotas.find(item => item.platformKey === task.platformKey)
  assert.ok(quota)
  assert.ok(task.accountSlot <= quota.requiredAccountCount)
}

const plan = await store.createPublishingPlanDraft({
  ownerUserId: "owner-a",
  clientId: "client-a",
  clientName: "测试客户",
  createdByUserId: "owner-a",
  input,
  questionMaterials: [{ id: "q1", question: "哪个品牌值得选择？", matchedAdvantage: "可核验案例" }],
})
assert.equal(plan.version, 1)
assert.equal(plan.status, "draft")

const second = await store.createPublishingPlanDraft({
  ownerUserId: "owner-a",
  clientId: "client-a",
  clientName: "测试客户",
  createdByUserId: "owner-a",
  input,
})
assert.equal(second.version, 2)
await store.activatePublishingPlan("owner-a", second.id)
assert.equal((await store.getCurrentPublishingPlan("owner-a", "client-a", false))?.id, second.id)

const claimed = await store.claimPublishingTasks({
  ownerUserId: "owner-a",
  clientId: "client-a",
  planId: second.id,
  agentId: "agent-a",
  limit: 2,
})
assert.equal(claimed.length, 2)
assert.ok(claimed[0].claimToken)
const hydrated = await store.getPublishingPlan("owner-a", second.id, true)
assert.ok(hydrated)
const packages = taskService.buildPublishingTaskPackages(hydrated, claimed)
assert.equal(packages.length, claimed.length)
assert.equal(packages[0].task.id, claimed[0].id)
assert.ok(packages[0].asset)
assert.ok(packages[0].platform)
const completed = await store.completePublishingTask({
  ownerUserId: "owner-a",
  taskId: claimed[0].id,
  actorUserId: "agent-a",
  claimToken: claimed[0].claimToken,
  publishedUrl: "https://example.com/article-1",
})
assert.equal(completed.status, "completed")
assert.equal(completed.evidence[0].url, "https://example.com/article-1")

await store.closePublishingPlanStoreConnection()
fs.rmSync(tempDir, { recursive: true, force: true })
console.log("Publishing plan calculation, deduplication, versioning and task claims passed")
