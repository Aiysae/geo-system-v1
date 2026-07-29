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
process.env.WORKSPACE_STORE = "file"
process.env.WORKSPACE_FILE = path.join(directory, "workspaces.json")

const {
  inferEvidencePlatform,
  normalizeExecutionEvidenceUrl,
  parseEvidenceImportText,
} = await import("../src/lib/client-feedback/evidence-import")
const {
  deleteClientExecutionActionBatch,
  deleteClientFeedbackReport,
  executionCounters,
  feedbackPeriodForDate,
  getClientExecutionProfile,
  getClientFeedbackReport,
  getSharedClientFeedbackReport,
  listClientExecutionActions,
  listClientFeedbackReports,
  publishClientFeedbackReport,
  revokeClientFeedbackShare,
  saveClientExecutionAction,
  saveClientExecutionActionBatch,
  saveClientExecutionProfile,
} = await import("../src/lib/client-feedback/store")
const { buildClientFeedbackReport } = await import("../src/lib/client-feedback/builder")
const {
  recordArticleGenerationAttribution,
} = await import("../src/lib/geo-methodology/attribution")
const {
  getClientExecutionActionDetail,
} = await import("../src/lib/client-feedback/action-detail")
const {
  groupClientExecutionActions,
} = await import("../src/lib/client-feedback/action-groups")
const {
  saveClientAccountLink,
} = await import("../src/lib/client-accounts")
const {
  createWorkspaceClient,
} = await import("../src/lib/workspace-store")
const {
  getClientExecutionPublicationPolicy,
  penetrationHistoryActionId,
  penetrationHistoryPublication,
  sanitizeFeedbackReportForClient,
  setActionPublications,
  setDefaultPenetrationPublication,
} = await import("../src/lib/client-feedback/publication")

const ownerUserId = "feedback-owner"
const actorUserId = "feedback-operator"
const clientViewerUserId = "feedback-client-viewer"
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
  await createWorkspaceClient(ownerUserId, client)
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

  const parsedRows = parseEvidenceImportText([
    "搜狐行业文章\thttps://www.sohu.com/a/123456?utm_source=test#section",
    "https://blog.csdn.net/test/article/details/9\tCSDN 技术文章",
  ].join("\n"))
  assert.equal(parsedRows.length, 2)
  assert.equal(parsedRows.every(row => !row.error), true)
  assert.equal(parsedRows[0]?.platform, "搜狐")
  assert.equal(parsedRows[1]?.title, "CSDN 技术文章")
  assert.equal(
    normalizeExecutionEvidenceUrl("https://www.sohu.com/a/123456?utm_source=test#section"),
    "https://www.sohu.com/a/123456",
  )
  assert.equal(inferEvidencePlatform("https://www.to8to.com/yezhu/z12345.html"), "土巴兔")
  assert.equal(
    parseEvidenceImportText(
      Array.from(
        { length: 205 },
        (_, index) => `标题 ${index + 1}\thttps://example.com/${index + 1}`,
      ).join("\n"),
    ).length,
    201,
    "超出单批上限时只保留前 200 条和一条溢出提示",
  )

  const batch = await saveClientExecutionActionBatch({
    ownerUserId,
    clientId: client.id,
    actorUserId,
    importId: "cimp_feedback_batch_001",
    defaults: {
      category: "self_media_publish",
      status: "completed",
      visibility: "client",
      occurredDate: "2026-03-01",
      description: "批量导入公开发布证据。",
    },
    rows: [
      {
        title: "搜狐行业文章",
        url: "https://www.sohu.com/a/123456?utm_source=test",
        platform: "搜狐",
      },
      {
        title: "CSDN 技术文章",
        url: "https://blog.csdn.net/test/article/details/9",
      },
      {
        title: "同批次重复网址",
        url: "https://www.sohu.com/a/123456#duplicate",
      },
    ],
  })
  assert.equal(batch.createdCount, 2)
  assert.equal(batch.skippedCount, 1)
  assert.equal(batch.skipped[0]?.reason, "duplicate_batch")
  assert.equal(batch.created[0]?.importedFrom, "url_batch")
  assert.equal(batch.created[0]?.evidence[0]?.label, "搜狐行业文章")
  const batchGroup = groupClientExecutionActions(batch.created)
  assert.equal(batchGroup.length, 1)
  assert.equal(batchGroup[0]?.isBatch, true)
  assert.equal(batchGroup[0]?.itemCount, 2)
  assert.equal(batchGroup[0]?.actionIds.length, 2)

  const ownerBatchDetail = await getClientExecutionActionDetail({
    userId: ownerUserId,
    clientId: client.id,
    actionId: batch.created[0]!.id,
  })
  assert.equal(ownerBatchDetail.kind, "publication")
  assert.equal(ownerBatchDetail.itemCount, 2)
  assert.equal(ownerBatchDetail.evidence.length, 2)
  assert.deepEqual(
    ownerBatchDetail.evidence.map(item => item.label).sort(),
    ["CSDN 技术文章", "搜狐行业文章"].sort(),
  )

  await saveClientAccountLink({
    userId: clientViewerUserId,
    parentUserId: ownerUserId,
    dataOwnerUserId: ownerUserId,
    sourceType: "personal",
    ownerUserId,
    clientId: client.id,
    clientName: client.name,
    provisioning: "owner",
    operatorUserId: ownerUserId,
  })
  await assert.rejects(
    getClientExecutionActionDetail({
      userId: clientViewerUserId,
      clientId: client.id,
      actionId: batch.created[0]!.id,
    }),
    /详细内容尚未向当前客户开放/,
  )
  await setActionPublications({
    ownerUserId,
    clientId: client.id,
    actionIds: batch.created.map(action => action.id),
    publication: "full",
    operatorUserId: ownerUserId,
  })
  const clientBatchDetail = await getClientExecutionActionDetail({
    userId: clientViewerUserId,
    clientId: client.id,
    actionId: batch.created[0]!.id,
  })
  assert.equal(clientBatchDetail.accessMode, "client")
  assert.equal(clientBatchDetail.evidence.length, 2)

  const batchRetry = await saveClientExecutionActionBatch({
    ownerUserId,
    clientId: client.id,
    actorUserId,
    importId: "cimp_feedback_batch_001",
    defaults: {
      category: "self_media_publish",
      status: "completed",
      visibility: "client",
      occurredDate: "2026-03-01",
    },
    rows: [{ title: "重试不应改变结果", url: "https://example.com/new" }],
  })
  assert.deepEqual(batchRetry, batch, "相同导入编号重试必须保持幂等")

  const duplicateExisting = await saveClientExecutionActionBatch({
    ownerUserId,
    clientId: client.id,
    actorUserId,
    importId: "cimp_feedback_batch_002",
    defaults: {
      category: "self_media_publish",
      status: "completed",
      visibility: "client",
      occurredDate: "2026-03-01",
    },
    rows: [{
      title: "历史记录中的同一网址",
      url: "https://www.sohu.com/a/123456?utm_campaign=again",
    }],
  })
  assert.equal(duplicateExisting.createdCount, 0)
  assert.equal(duplicateExisting.skipped[0]?.reason, "duplicate_existing")
  assert.equal((await listClientExecutionActions(ownerUserId, client.id)).length, 4)
  await assert.rejects(
    saveClientExecutionActionBatch({
      ownerUserId,
      clientId: client.id,
      actorUserId,
      importId: "cimp_feedback_batch_invalid",
      defaults: {
        category: "self_media_publish",
        status: "completed",
        visibility: "client",
        occurredDate: "2026-03-01",
      },
      rows: [{ title: "内网地址", url: "http://127.0.0.1/private" }],
    }),
    /客户可访问的 http\/https 公网网址/,
  )

  await recordArticleGenerationAttribution({
    ownerUserId,
    clientId: client.id,
    actorUserId,
    markdown: "# 企业内容服务怎么选\n\n正文",
    lineage: {
      generationId: "gart_feedback_article_001",
      promptKey: "thirdPartyObservation",
      primarySubject: client.ourBrand,
      comparisonSubjects: [],
      questionId: "question-001",
      coreQuestion: "企业内容服务怎么选？",
      questionIntent: "采购决策",
      questionSubIntent: "建立选择标准",
      questionCategory: "采购决策型",
      questionKeyword: "企业内容服务",
      matchedAdvantage: "统一资料管理",
      modelProvider: "deepseek",
      model: "deepseek-chat",
      methodologyTrace: {
        version: "shitu-geo-2026.07.1",
        methodKey: "problemSolution",
        articleFormat: "directAnswerGuide",
        targetPlatform: "universal",
        brandLayout: "singlePrimary",
        titleStrategy: "directAnswer",
        knowledgeAssetIds: ["asset-001"],
        compiledAt: "2026-03-01T05:30:00.000Z",
      },
      generatedAt: "2026-03-01T05:30:00.000Z",
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
  assert.equal(report.snapshot.actions.length, 4, "internal actions must not leak into client reports")
  assert.equal(report.snapshot.actions.some(action => action.title === "完成首批自媒体发布"), true)
  assert.equal(report.snapshot.actions.some(action => action.title === "搜狐行业文章"), true)
  assert.equal(report.snapshot.evidenceRecordCount, 4)
  assert.equal(report.snapshot.comparison.comparable, false)
  assert.deepEqual(report.snapshot.contentAttribution, {
    generatedArticleCount: 1,
    coveredQuestionCount: 1,
    evidenceLinkedArticleCount: 1,
    knowledgeAssetUseCount: 1,
    platformCounts: [{ platform: "通用内容", count: 1 }],
  })
  const reportAction = report.snapshot.actions[0]
  assert.ok(reportAction)
  const reportWithResult = {
    ...report,
    snapshot: {
      ...report.snapshot,
      actions: [{
        ...reportAction,
        publication: "summary" as const,
        sourceRecordId: "history-summary-only",
        resultRef: {
          module: "penetration" as const,
          resourceType: "history" as const,
          resourceId: "history-summary-only",
        },
      }],
    },
  }
  const initialPolicy = await getClientExecutionPublicationPolicy(ownerUserId, client.id)
  const summaryOnly = sanitizeFeedbackReportForClient(reportWithResult, initialPolicy)
  assert.equal(summaryOnly.snapshot.actions[0]?.resultRef, undefined)
  assert.equal(summaryOnly.snapshot.actions[0]?.sourceRecordId, undefined)
  const reportWithFullResult = {
    ...reportWithResult,
    snapshot: {
      ...reportWithResult.snapshot,
      actions: reportWithResult.snapshot.actions.map(action => ({
        ...action,
        publication: "full" as const,
      })),
    },
  }
  const resultPermissionDenied = sanitizeFeedbackReportForClient(
    reportWithFullResult,
    initialPolicy,
    { allowPenetrationResults: false },
  )
  assert.equal(resultPermissionDenied.snapshot.actions[0]?.resultRef, undefined)
  assert.equal(resultPermissionDenied.snapshot.actions[0]?.sourceRecordId, undefined)

  const defaultHidden = await setDefaultPenetrationPublication({
    ownerUserId,
    clientId: client.id,
    publication: "internal",
    operatorUserId: actorUserId,
  })
  assert.equal(
    penetrationHistoryPublication(defaultHidden, {
      historyId: "history-owned-by-client",
      actorUserId: "client-viewer",
      viewerUserId: "client-viewer",
    }),
    "full",
    "a client's own detection remains visible unless the owner explicitly overrides it",
  )
  const explicitlyHidden = await setActionPublications({
    ownerUserId,
    clientId: client.id,
    actionIds: [penetrationHistoryActionId("history-owned-by-client")],
    publication: "internal",
    operatorUserId: actorUserId,
  })
  assert.equal(
    penetrationHistoryPublication(explicitlyHidden, {
      historyId: "history-owned-by-client",
      actorUserId: "client-viewer",
      viewerUserId: "client-viewer",
    }),
    "internal",
    "an explicit per-action rule must override the own-detection fallback",
  )

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
  assert.equal(
    await deleteClientExecutionActionBatch(
      ownerUserId,
      client.id,
      "cimp_feedback_batch_001",
    ),
    2,
    "a publication batch must be removed in one scoped server operation",
  )
  assert.equal(
    (await listClientExecutionActions(ownerUserId, client.id))
      .some(action => action.importBatchId === "cimp_feedback_batch_001"),
    false,
  )

  console.log("Client execution calendar, report snapshot and private sharing contract passed")
} finally {
  await fs.rm(directory, { recursive: true, force: true })
}
