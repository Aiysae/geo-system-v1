import assert from "node:assert/strict"
import type { PenetrationItem } from "../src/types"

const {
  PENETRATION_AUDIT_RETRY_DELAYS_MS,
  PENETRATION_SLOT_RETRY_DELAYS_MS,
  getPenetrationSlotValidationError,
  isCompletePenetrationItem,
  nextPenetrationRetryAt,
  nextPenetrationRetryAtForError,
} = await import("../src/lib/penetration/slot-policy")

function validItem(overrides: Partial<PenetrationItem> = {}): PenetrationItem {
  return {
    sampleId: "sample-1",
    sampledAt: new Date().toISOString(),
    question: "今天有哪些最新行业动态？",
    answer: "这是一次独立联网回答。",
    mentionedBrands: [],
    topRecommended: null,
    searchSources: [{
      title: "可读取的行业文章",
      snippet: "这是一段足以说明页面内容的公开文章摘要。",
      url: "https://example.com/news/industry-update-2026",
      domain: "example.com",
      query: "今天有哪些最新行业动态？",
    }],
    sourceCount: 1,
    searchMode: "native_web",
    promptPurity: "raw_question_only",
    requestAuditVerified: true,
    requestAudits: [{
      schemaVersion: 1,
      endpointHost: "example.com",
      model: "test-model",
      modelProvider: "test-provider",
      searchProvider: "test-provider",
      searchMode: "native_web",
      messageRoles: ["user"],
      systemMessageCount: 0,
      userMessageCount: 1,
      additionalPromptTextDetected: false,
      exactQuestionMatch: true,
      questionSha256: "question-hash",
      promptSha256: "prompt-hash",
      toolNames: ["web_search"],
      verified: true,
      verifiedAt: new Date().toISOString(),
    }],
    webAttempted: true,
    webExecutionVerified: true,
    providerRequestIds: ["provider-request-1"],
    webVerified: true,
    hitOur: false,
    ...overrides,
  }
}

const complete = validItem()
assert.equal(isCompletePenetrationItem(complete), true)
assert.equal(getPenetrationSlotValidationError(complete), null)

const emptyAnswer = validItem({ answer: "" })
assert.equal(isCompletePenetrationItem(emptyAnswer), false)
assert.match(getPenetrationSlotValidationError(emptyAnswer) || "", /原始回答/)

const executionWithoutSources = validItem({
  searchSources: [],
  sourceCount: 0,
  webExecutionVerified: true,
  webVerified: true,
})
assert.equal(isCompletePenetrationItem(executionWithoutSources), false)
assert.match(getPenetrationSlotValidationError(executionWithoutSources) || "", /有效信源/)

const imageOnlySource = validItem({
  searchSources: [{
    title: "新闻配图",
    snippet: "这只是图片资源，不是可以阅读全文的文章页面。",
    url: "https://example.com/assets/news-cover.png",
    domain: "example.com",
    query: "今天有哪些最新行业动态？",
  }],
})
assert.equal(isCompletePenetrationItem(imageOnlySource), false)

const missingRequestId = validItem({ providerRequestIds: [] })
assert.equal(isCompletePenetrationItem(missingRequestId), false)
assert.match(getPenetrationSlotValidationError(missingRequestId) || "", /请求编号/)

const impurePrompt = validItem({ promptPurity: "search_context_augmented" })
assert.equal(isCompletePenetrationItem(impurePrompt), false)
assert.match(getPenetrationSlotValidationError(impurePrompt) || "", /原始问题/)

const missingOutboundProof = validItem({
  requestAuditVerified: false,
  requestAudits: [],
})
assert.equal(isCompletePenetrationItem(missingOutboundProof), false)
assert.match(getPenetrationSlotValidationError(missingOutboundProof) || "", /出站请求/)

assert.equal(
  isCompletePenetrationItem(validItem({ searchMode: "provider_hosted_web" })),
  true,
)
assert.equal(
  isCompletePenetrationItem(validItem({ searchMode: "external_tool_web" })),
  true,
)

assert.deepEqual(PENETRATION_SLOT_RETRY_DELAYS_MS, [3_000, 10_000, 30_000, 90_000, 180_000, 300_000])
const base = Date.parse("2026-07-16T00:00:00.000Z")
assert.equal(nextPenetrationRetryAt(1, base), "2026-07-16T00:00:03.000Z")
assert.equal(nextPenetrationRetryAt(6, base), "2026-07-16T00:05:00.000Z")
assert.equal(nextPenetrationRetryAt(7, base), null)
const jittered = Date.parse(nextPenetrationRetryAt(1, base, "job:model:1") || "")
assert.ok(jittered >= base + 3_300)
assert.ok(jittered <= base + 3_900)

assert.deepEqual(PENETRATION_AUDIT_RETRY_DELAYS_MS, [5_000, 30_000])
const auditError = "通义千问 百炼联网未返回可审计来源（search_results=0）"
assert.equal(
  nextPenetrationRetryAtForError(auditError, 1, base),
  "2026-07-16T00:00:05.000Z",
)
assert.equal(
  nextPenetrationRetryAtForError(auditError, 2, base),
  "2026-07-16T00:00:30.000Z",
)
assert.equal(nextPenetrationRetryAtForError(auditError, 3, base), null)
assert.equal(
  nextPenetrationRetryAtForError("普通网络失败", 1, base),
  "2026-07-16T00:00:03.000Z",
)

console.log("Penetration strict completion policy passed.")
