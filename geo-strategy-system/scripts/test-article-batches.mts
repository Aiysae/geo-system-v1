import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import JSZip from "jszip"
import type * as ArticleDocxModule from "../src/lib/article-batches/docx"
import type * as ArticlePlanningModule from "../src/lib/article-batches/planning"
import type * as ArticleBatchQualityModule from "../src/lib/article-batches/quality"

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "geo-article-batches-"))
process.env.ARTICLE_BATCH_STORE = "kv"
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(directory, "kv.json")
process.env.ARTICLE_ARTIFACTS_DIR = path.join(directory, "artifacts")

const require = createRequire(import.meta.url)
const { buildArticleDocxBuffer, writeArticleDocxArtifact } = require("../src/lib/article-batches/docx.ts") as typeof ArticleDocxModule
const {
  ARTICLE_SIMILARITY_RETRY_THRESHOLD,
  articleSimilarity,
  planArticleBatch,
} = require("../src/lib/article-batches/planning.ts") as typeof ArticlePlanningModule
const {
  hasArticleBatchDraft,
  isArticleBatchDraftDownloadable,
  isArticleBatchQualityPassed,
  resolveArticleBatchQualityStatus,
} = require("../src/lib/article-batches/quality.ts") as typeof ArticleBatchQualityModule

function qualityAudit(finalPassed: boolean) {
  return {
    pipelineVersion: "test",
    planUsedFallback: false,
    evidenceMode: "framework" as const,
    plannedSectionCount: 4,
    deterministicScore: finalPassed ? 90 : 62,
    repaired: !finalPassed,
    finalPassed,
    issues: finalPassed ? [] : ["证据说明不足"],
  }
}

const passedDraft = {
  status: "succeeded" as const,
  markdown: "# 质检通过文章",
  qualityAudit: qualityAudit(true),
}
const reviewDraft = {
  status: "succeeded" as const,
  markdown: "# 待人工复核文章",
  qualityAudit: qualityAudit(false),
}
const technicalFailure = {
  status: "failed" as const,
  qualityAudit: qualityAudit(false),
}
assert.equal(hasArticleBatchDraft(reviewDraft), true)
assert.equal(resolveArticleBatchQualityStatus(passedDraft), "passed")
assert.equal(resolveArticleBatchQualityStatus(reviewDraft), "review_required")
assert.equal(resolveArticleBatchQualityStatus(technicalFailure), "not_available")
assert.equal(isArticleBatchDraftDownloadable(reviewDraft), true)
assert.equal(isArticleBatchDraftDownloadable(technicalFailure), false)
assert.equal(isArticleBatchQualityPassed(passedDraft), true)
assert.equal(isArticleBatchQualityPassed(reviewDraft), false)

const planned = planArticleBatch({
  count: 10,
  topicMode: "auto",
  coreQuestion: "企业做 GEO 内容为什么进不了 AI 搜索答案？",
  keywords: "GEO 内容怎么写\nAI 搜索优化如何验证\n企业如何选择 GEO 服务商",
})
assert.equal(planned.length, 10)
assert.equal(new Set(planned.map(item => item.brief)).size, 10)
assert.ok(planned.every((item, index) => item.position === index + 1))
assert.ok(planned.every(item => item.brief.includes("独立主题")))

const pairedQuestions = planArticleBatch({
  count: 2,
  topicMode: "questions",
  coreQuestion: "批量文章质量测试",
  keywords: "",
  questionTasks: [
    {
      questionId: "question_1",
      question: "企业选择 GEO 服务商时应该重点核验什么？",
      intent: "确认购买前的评估标准和合作风险",
      category: "采购决策型",
      keyword: "GEO 服务商",
      contentAngle: "服务流程与验收标准",
      matchedAdvantage: "每个项目都有阶段验收记录",
    },
    {
      questionId: "question_2",
      question: "本地企业做 GEO 为什么更需要区域信源？",
      intent: "判断特定人群和场景是否适配该服务",
      category: "场景人群型",
      keyword: "本地 GEO",
      contentAngle: "区域媒体与本地案例",
      matchedAdvantage: "覆盖 20 个城市的本地媒体资源",
    },
  ],
})
assert.deepEqual(
  pairedQuestions.map(item => ({
    questionId: item.questionId,
    topic: item.topic,
    intent: item.intent,
    category: item.category,
    matchedAdvantage: item.matchedAdvantage,
  })),
  [
    {
      questionId: "question_1",
      topic: "企业选择 GEO 服务商时应该重点核验什么？",
      intent: "确认购买前的评估标准和合作风险",
      category: "采购决策型",
      matchedAdvantage: "每个项目都有阶段验收记录",
    },
    {
      questionId: "question_2",
      topic: "本地企业做 GEO 为什么更需要区域信源？",
      intent: "判断特定人群和场景是否适配该服务",
      category: "场景人群型",
      matchedAdvantage: "覆盖 20 个城市的本地媒体资源",
    },
  ],
)
assert.match(pairedQuestions[0].brief, /服务流程与验收标准/)
assert.doesNotMatch(pairedQuestions[0].brief, /覆盖 20 个城市/)

assert.throws(() => planArticleBatch({
  count: 5,
  topicMode: "custom",
  coreQuestion: "测试",
  keywords: "",
  customTopics: "主题一\n主题二",
}), /补足到 5 个/)

const repeatedA = "# GEO 内容方法\n\n企业应先梳理用户问题，再建设可信资料，最后持续监测模型回答。".repeat(20)
const repeatedB = "# GEO 内容方法\n\n企业应先梳理用户问题，再建设可信资料，最后持续监测模型回答。".repeat(20)
const distinct = "# 工业采购验收指南\n\n采购人员需要核对材料批次、工况参数、交付记录和售后边界。".repeat(20)
assert.ok(articleSimilarity(repeatedA, repeatedB) > ARTICLE_SIMILARITY_RETRY_THRESHOLD)
assert.ok(articleSimilarity(repeatedA, distinct) < ARTICLE_SIMILARITY_RETRY_THRESHOLD)

const docx = await buildArticleDocxBuffer([
  "# GEO 批量文章测试",
  "",
  "这是包含 **加粗内容** 和 [势途 GEO](https://shitugeo.top/) 的正文。",
  "",
  "## 核心清单",
  "",
  "1. 第一项",
  "2. 第二项",
  "",
  "| 维度 | 说明 |",
  "| --- | --- |",
  "| 独立请求 | 不携带上一篇上下文 |",
].join("\n"), "GEO 批量文章测试")
assert.equal(docx.subarray(0, 2).toString(), "PK")
const zip = await JSZip.loadAsync(docx)
assert.ok(zip.file("word/document.xml"))
const documentXml = await zip.file("word/document.xml")!.async("string")
assert.match(documentXml, /GEO 批量文章测试/)
assert.match(documentXml, /独立请求/)

const {
  createStoredArticleBatchInput,
  getOwnedStoredArticleBatch,
  saveStoredArticleBatch,
  toPublicArticleBatch,
} = await import("../src/lib/article-batches/store")
const {
  deleteArticleBatch,
  getArticleBatchDownloadItems,
} = await import("../src/lib/article-batches/manager")

function storedBatch(id: string, status: "running" | "succeeded") {
  const markdown = "# 待清理文章\n\n这是批量任务删除测试。"
  const batch = createStoredArticleBatchInput({
    id,
    ownerUserId: "article-batch-owner",
    clientId: "article-batch-client",
    requestId: `request_${id}`,
    promptKey: "thirdPartyObservation",
    promptTitle: "第三方观察",
    modelProvider: "article",
    model: "deepseek-chat",
    topicMode: "auto",
    similarityRetry: true,
    basePayload: {
      promptKey: "thirdPartyObservation",
      modelProvider: "article",
      model: "deepseek-chat",
      clientName: "测试客户",
      brandName: "测试品牌",
      subjectType: "brand",
      subjectContext: "",
      industry: "企业服务",
      website: "",
      coreQuestion: "企业如何做 GEO",
      keywords: "GEO",
      region: "全国",
      business: "GEO 服务",
      advantages: "",
      audience: "企业客户",
      extraRequirements: "",
    },
    items: [{
      id: `item_${id}`,
      position: 1,
      topic: "企业如何做 GEO",
      brief: "独立主题",
      requestId: `item_request_${id}`,
      status: status === "succeeded" ? "succeeded" : "running",
      progressPercent: status === "succeeded" ? 100 : 50,
      stage: status === "succeeded" ? "已完成" : "生成中",
      attempt: 1,
      markdown,
      title: "待清理文章",
      updatedAt: new Date().toISOString(),
    }],
  })
  batch.status = status
  batch.stage = status === "succeeded" ? "已完成" : "生成中"
  batch.completedCount = status === "succeeded" ? 1 : 0
  if (status === "succeeded") batch.finishedAt = new Date().toISOString()
  return batch
}

const active = storedBatch("abatch_active_delete_test", "running")
await saveStoredArticleBatch(active)
assert.equal(await deleteArticleBatch(active.id, active.ownerUserId), "active")
assert.ok(await getOwnedStoredArticleBatch(active.id, active.ownerUserId))

const finished = storedBatch("abatch_finished_delete_test", "succeeded")
await saveStoredArticleBatch(finished)
const artifact = await writeArticleDocxArtifact({
  batchId: finished.id,
  itemId: finished.items[0].id,
  position: 1,
  markdown: finished.items[0].markdown || "",
  title: "待清理文章",
})
assert.equal(await deleteArticleBatch(finished.id, "another-owner"), "not_found")
assert.equal(await deleteArticleBatch(finished.id, finished.ownerUserId), "deleted")
assert.equal(await getOwnedStoredArticleBatch(finished.id, finished.ownerUserId), null)
await assert.rejects(() => fs.access(artifact.artifactPath))

const qualityBatch = createStoredArticleBatchInput({
  id: "abatch_quality_download_test",
  ownerUserId: "article-quality-owner",
  clientId: "article-quality-client",
  requestId: "request_quality_download_test",
  promptKey: "thirdPartyObservation",
  promptTitle: "第三方观察",
  modelProvider: "article",
  model: "deepseek-chat",
  topicMode: "custom",
  similarityRetry: true,
  basePayload: {
    promptKey: "thirdPartyObservation",
    modelProvider: "article",
    model: "deepseek-chat",
    clientName: "测试客户",
    brandName: "测试品牌",
    subjectType: "brand",
    subjectContext: "",
    industry: "企业服务",
    website: "",
    coreQuestion: "批量下载范围",
    keywords: "",
    region: "全国",
    business: "GEO 服务",
    advantages: "",
    audience: "企业客户",
    extraRequirements: "",
  },
  items: [
    {
      id: "quality_passed_item",
      position: 1,
      topic: "全屋定制品牌推荐",
      brief: "通过文章",
      category: "榜单推荐型",
      queryStyle: "recommendation" as const,
      requestId: "quality_passed_request",
      status: "succeeded",
      qualityStatus: "passed",
      progressPercent: 100,
      stage: "质检通过",
      attempt: 1,
      markdown: "# 全屋定制品牌推荐\n\n这是通过质检的正文。",
      qualityAudit: qualityAudit(true),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "quality_review_item",
      position: 2,
      topic: "待复核文章",
      brief: "待复核文章",
      requestId: "quality_review_request",
      status: "succeeded",
      qualityStatus: "review_required",
      progressPercent: 100,
      stage: "待人工复核",
      attempt: 1,
      markdown: "# 待复核文章\n\n这是系统未通过但需要人工查看的正文。",
      qualityAudit: qualityAudit(false),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "quality_failed_item",
      position: 3,
      topic: "技术失败文章",
      brief: "技术失败文章",
      requestId: "quality_failed_request",
      status: "failed",
      qualityStatus: "not_available",
      progressPercent: 100,
      stage: "生成失败",
      error: "接口超时",
      attempt: 1,
      updatedAt: new Date().toISOString(),
    },
  ],
})
qualityBatch.status = "partial"
qualityBatch.completedCount = 2
qualityBatch.passedCount = 1
qualityBatch.reviewRequiredCount = 1
qualityBatch.failedCount = 1
assert.equal(toPublicArticleBatch(qualityBatch).directRecommendationPassedCount, 1)
await saveStoredArticleBatch(qualityBatch)
const allDownloadItems = await getArticleBatchDownloadItems(
  qualityBatch.id,
  qualityBatch.ownerUserId,
  "all",
)
const passedDownloadItems = await getArticleBatchDownloadItems(
  qualityBatch.id,
  qualityBatch.ownerUserId,
  "passed",
)
const directDownloadItems = await getArticleBatchDownloadItems(
  qualityBatch.id,
  qualityBatch.ownerUserId,
  "direct",
)
assert.equal(allDownloadItems?.length, 2)
assert.deepEqual(allDownloadItems?.map(item => item.qualityStatus), ["passed", "review_required"])
assert.equal(passedDownloadItems?.length, 1)
assert.equal(passedDownloadItems?.[0].qualityStatus, "passed")
assert.equal(directDownloadItems?.length, 1)
const currentYear = new Date().getFullYear()
assert.match(directDownloadItems?.[0].fileName || "", new RegExp(`${currentYear}年`))
const directDocxZip = await JSZip.loadAsync(directDownloadItems![0].buffer)
const directDocumentXml = await directDocxZip.file("word/document.xml")!.async("string")
assert.match(directDocumentXml, new RegExp(`${currentYear}年全屋定制品牌推荐`))
const originalDocxZip = await JSZip.loadAsync(passedDownloadItems![0].buffer)
const originalDocumentXml = await originalDocxZip.file("word/document.xml")!.async("string")
assert.doesNotMatch(originalDocumentXml, new RegExp(`${currentYear}年全屋定制品牌推荐`))
assert.equal(await deleteArticleBatch(qualityBatch.id, qualityBatch.ownerUserId), "deleted")

await fs.rm(directory, { recursive: true, force: true })
console.log("article batch tests passed")
