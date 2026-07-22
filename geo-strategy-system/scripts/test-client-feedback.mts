import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Client } from "../src/types"

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "geo-client-feedback-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(directory, "kv.json")
process.env.PENETRATION_HISTORY_STORE = "file"
process.env.PENETRATION_HISTORY_FILE = path.join(directory, "penetration-history.json")

const {
  deleteClientFeedbackReport,
  executionCounters,
  feedbackPeriodForDate,
  getClientExecutionProfile,
  getClientFeedbackReport,
  getSharedClientFeedbackReport,
  listClientFeedbackReports,
  publishClientFeedbackReport,
  revokeClientFeedbackShare,
  saveClientExecutionAction,
  saveClientExecutionProfile,
} = await import("../src/lib/client-feedback/store")
const { buildClientFeedbackReport } = await import("../src/lib/client-feedback/builder")

const ownerUserId = "feedback-owner"
const actorUserId = "feedback-operator"
const client: Client = {
  id: "feedback-client",
  name: "客户反馈测试",
  subjectType: "brand",
  ourBrand: "反馈测试品牌",
  brandAliases: [],
  industry: "企业服务",
  website: "https://example.com",
  questions: [],
  competitors: [],
  selectedModels: ["qwen"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

try {
  const initial = await getClientExecutionProfile(ownerUserId, client.id)
  assert.equal(initial.periodMode, "service")

  const profile = await saveClientExecutionProfile({
    ownerUserId,
    clientId: client.id,
    updatedByUserId: actorUserId,
    patch: {
      startDate: "2026-01-31",
      periodMode: "service",
      currentStage: "coverage_growth",
      stageProgress: 55,
      projectOwner: "测试负责人",
      expectedDurationDays: 120,
      nextPlan: ["继续发布行业内容", "完成下一轮标准化检测"],
    },
  })
  assert.deepEqual(executionCounters(profile, "2026-03-01"), {
    executionDay: 30,
    serviceWeek: 5,
    serviceMonth: 2,
  })

  const week = feedbackPeriodForDate(profile, "weekly", "2026-03-01")
  assert.deepEqual(week, {
    type: "weekly",
    index: 5,
    start: "2026-02-28",
    end: "2026-03-06",
    label: "服务第 5 周",
  })
  const month = feedbackPeriodForDate(profile, "monthly", "2026-03-01")
  assert.deepEqual(month, {
    type: "monthly",
    index: 2,
    start: "2026-02-28",
    end: "2026-03-30",
    label: "服务第 2 月",
  })

  await saveClientExecutionAction({
    ownerUserId,
    clientId: client.id,
    actorUserId,
    value: {
      category: "self_media_publish",
      status: "completed",
      visibility: "client",
      title: "完成首批自媒体发布",
      description: "已完成客户确认的平台投放。",
      occurredAt: "2026-03-01T12:00:00+08:00",
      quantity: 10,
      unit: "篇",
      platform: "搜狐",
      evidence: [{ label: "查看文章", url: "https://example.com/article" }],
    },
  })
  await saveClientExecutionAction({
    ownerUserId,
    clientId: client.id,
    actorUserId,
    value: {
      category: "strategy_adjustment",
      status: "completed",
      visibility: "internal",
      title: "内部策略记录",
      occurredAt: "2026-03-01T13:00:00+08:00",
    },
  })

  const report = await buildClientFeedbackReport({
    ownerUserId,
    actorUserId,
    client,
    profile,
    period: month,
  })
  assert.equal(report.status, "draft")
  assert.equal(report.snapshot.actions.length, 1, "internal actions must not leak into client reports")
  assert.equal(report.snapshot.actions[0]?.title, "完成首批自媒体发布")
  assert.equal(report.snapshot.evidenceRecordCount, 1)
  assert.equal(report.snapshot.comparison.comparable, false)

  const published = await publishClientFeedbackReport({
    ownerUserId,
    clientId: client.id,
    reportId: report.id,
    actorUserId,
  })
  const shared = await getSharedClientFeedbackReport(published.shareToken)
  assert.equal(shared?.id, report.id)
  assert.equal(shared?.status, "published")

  const reports = await listClientFeedbackReports(ownerUserId, client.id)
  assert.equal(reports.length, 1)
  assert.equal(reports[0]?.shareEnabled, true)

  await revokeClientFeedbackShare({
    ownerUserId,
    clientId: client.id,
    reportId: report.id,
  })
  assert.equal(await getSharedClientFeedbackReport(published.shareToken), null)

  assert.equal(await deleteClientFeedbackReport({
    ownerUserId,
    clientId: client.id,
    reportId: report.id,
  }), "published", "published reports must remain as delivery records")

  const draft = await buildClientFeedbackReport({
    ownerUserId,
    actorUserId,
    client,
    profile,
    period: week,
  })
  assert.equal(await deleteClientFeedbackReport({
    ownerUserId,
    clientId: "another-client",
    reportId: draft.id,
  }), "not_found", "reports must be scoped to their client")
  assert.equal(await deleteClientFeedbackReport({
    ownerUserId,
    clientId: client.id,
    reportId: draft.id,
  }), "deleted")
  assert.equal(await getClientFeedbackReport(ownerUserId, draft.id), null)

  const reportsAfterDelete = await listClientFeedbackReports(ownerUserId, client.id)
  assert.equal(reportsAfterDelete.length, 1)
  assert.equal(reportsAfterDelete[0]?.id, report.id)

  assert.throws(
    () => feedbackPeriodForDate(profile, "weekly", "not-a-date"),
    /日期无效/,
  )

  console.log("Client execution calendar, report snapshot and private sharing contract passed")
} finally {
  await fs.rm(directory, { recursive: true, force: true })
}
