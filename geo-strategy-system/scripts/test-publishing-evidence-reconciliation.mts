import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "geo-publishing-evidence-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(directory, "kv.json")
process.env.PUBLISHING_PLAN_STORE = "file"
process.env.PUBLISHING_PLAN_FILE = path.join(directory, "publishing-plans.json")

const publishingStore = await import("../src/lib/publishing-plan/store")
const feedbackStore = await import("../src/lib/client-feedback/store")
const reconciliation = await import("../src/lib/publishing-plan/evidence-reconciliation")
const registry = await import("../src/lib/source-platform-registry")
const { closeKvConnection } = await import("../src/lib/kv")

const ownerUserId = "publishing-evidence-owner"
const actorUserId = "publishing-evidence-operator"
const clientId = "publishing-evidence-client"

try {
  assert.equal(registry.resolveSourcePlatformByUrl("https://mp.weixin.qq.com/s/demo")?.key, "wechat")
  assert.equal(registry.resolveSourcePlatformByUrl("https://news.sohu.com/a/123")?.key, "sohu")
  assert.equal(registry.resolveSourcePlatformByUrl("https://www.to8to.com/yezhu/v1")?.key, "tubatu")

  const draft = await publishingStore.createPublishingPlanDraft({
    ownerUserId,
    clientId,
    clientName: "发布核销测试客户",
    createdByUserId: actorUserId,
    input: {
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
        id: "sohu",
        platformKey: "sohu",
        platformName: "搜狐",
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
    questionMaterials: [{
      id: "question-1",
      question: "测试品牌应该如何选择服务？",
      matchedAdvantage: "流程透明且结果可核验",
    }],
  })
  await publishingStore.activatePublishingPlan(ownerUserId, draft.id)
  const plan = await publishingStore.getPublishingPlan(ownerUserId, draft.id, true)
  assert.ok(plan)
  const tasksByDate = new Map<string, typeof plan.calculation.tasks>()
  for (const task of plan.calculation.tasks) {
    if (task.platformKey !== "sohu") continue
    tasksByDate.set(task.plannedDate, [...(tasksByDate.get(task.plannedDate) || []), task])
  }
  const selected = [...tasksByDate.entries()].sort((left, right) => left[0].localeCompare(right[0]))[0]
  assert.ok(selected, "测试规划应至少生成一个搜狐任务")
  const [plannedDate, dateTasks] = selected
  const rowCount = dateTasks.length + 1
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    title: `搜狐发布证据 ${index + 1}`,
    url: `https://www.sohu.com/a/test-${index + 1}?utm_source=agent`,
  }))

  const preview = await reconciliation.previewPublishingEvidenceImport({
    ownerUserId,
    clientId,
    occurredDate: plannedDate,
    rows,
  })
  assert.equal(preview.summary.matchedCount, dateTasks.length)
  assert.equal(preview.summary.overQuotaCount, 1)
  assert.equal(preview.rows[0]?.platformKey, "sohu")

  const actions = await Promise.all(rows.map((row, index) => feedbackStore.saveClientExecutionAction({
    ownerUserId,
    clientId,
    actorUserId,
    value: {
      id: `evidence-action-${index + 1}`,
      category: "self_media_publish",
      source: "manual",
      status: "completed",
      visibility: "client",
      title: row.title,
      occurredAt: `${plannedDate}T12:00:00+08:00`,
      evidence: [{ label: row.title, url: row.url }],
    },
  })))

  const result = await reconciliation.reconcilePublishingEvidenceActions({
    ownerUserId,
    clientId,
    actorUserId,
    actions,
  })
  assert.equal(result.summary.matchedCount, dateTasks.length)
  assert.equal(result.summary.overQuotaCount, 1)
  assert.equal(new Set(
    result.actions
      .map(action => action.publicationReconciliation?.taskId)
      .filter(Boolean),
  ).size, dateTasks.length, "并发核销不能重复占用同一个任务")

  const actionsOnDate = await feedbackStore.listClientExecutionActionsOnDate(
    ownerUserId,
    clientId,
    plannedDate,
  )
  const refreshedPlan = await publishingStore.getPublishingPlan(ownerUserId, plan.id, true)
  assert.ok(refreshedPlan)
  const progress = reconciliation.buildClientPublicationProgress({
    date: plannedDate,
    plan: refreshedPlan,
    actions: actionsOnDate,
  })
  assert.equal(progress.plannedCount, dateTasks.length)
  assert.equal(progress.matchedCount, dateTasks.length)
  assert.equal(progress.actualCount, rowCount)
  assert.equal(progress.remainingCount, 0)
  assert.equal(progress.overageCount, 1)

  const firstMatched = result.actions.find(action => action.publicationReconciliation?.status === "matched")
  assert.ok(firstMatched)
  const repeated = await reconciliation.reconcilePublishingEvidenceActions({
    ownerUserId,
    clientId,
    actorUserId,
    actions: [firstMatched],
  })
  assert.equal(
    repeated.actions[0]?.publicationReconciliation?.taskId,
    firstMatched.publicationReconciliation?.taskId,
    "相同动作重试必须复用原任务",
  )

  assert.equal(await feedbackStore.deleteClientExecutionAction(ownerUserId, clientId, firstMatched.id), true)
  assert.equal(await publishingStore.reopenPublishingTaskByExecutionAction({
    ownerUserId,
    clientId,
    executionActionId: firstMatched.id,
  }), 1)
  const reopened = await publishingStore.getPublishingTask(
    ownerUserId,
    firstMatched.publicationReconciliation?.taskId || "",
  )
  assert.equal(reopened?.status, "planned")
  assert.equal(reopened?.executionActionId, undefined)

  console.log("Publishing evidence platform detection, quota reconciliation, idempotency and rollback passed")
} finally {
  await Promise.allSettled([
    publishingStore.closePublishingPlanStoreConnection(),
    closeKvConnection(),
  ])
  await fs.rm(directory, { recursive: true, force: true })
}
