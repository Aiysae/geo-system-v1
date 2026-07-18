import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { PenetrationItem, PenetrationJobRecord } from "../src/types"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-penetration-job-recovery-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(tempDir, "kv.json")
process.env.PENETRATION_HISTORY_STORE = "file"
process.env.PENETRATION_HISTORY_FILE = path.join(tempDir, "penetration-history.json")
process.env.PORT = "3000"

const originalFetch = globalThis.fetch
let attempts = 0
const runId = "penetration_recovery_test_123456"
const question = "同一个槽位首次缺少信源时会自动补采吗？"

function item(valid: boolean): PenetrationItem & { error?: string } {
  return {
    sampleId: `${runId}_doubao_1`,
    sampledAt: new Date().toISOString(),
    question,
    answer: valid ? "第二次独立联网回答" : "第一次回答没有返回信源",
    mentionedBrands: [],
    topRecommended: null,
    searchSources: valid ? [{
      title: "补采成功的公开文章",
      snippet: "第二次请求返回了可点击、可读取的公开文章网址。",
      url: "https://example.com/news/recovered-slot",
      domain: "example.com",
      query: question,
    }] : [],
    sourceCount: valid ? 1 : 0,
    searchMode: "native_web",
    promptPurity: "raw_question_only",
    webAttempted: true,
    webExecutionVerified: true,
    providerRequestIds: valid ? ["provider-request-2"] : ["provider-request-1"],
    webVerified: valid,
    hitOur: false,
    ...(valid ? {} : { error: "豆包官方联网没有返回可点击信源" }),
  }
}

globalThis.fetch = async () => {
  attempts++
  const valid = attempts >= 2
  return new Response(JSON.stringify({
    byModel: { doubao: [item(valid)] },
    generatedAt: new Date().toISOString(),
    modelErrors: valid ? {} : { doubao: "豆包官方联网没有返回可点击信源" },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

const { createPenetrationJob, getPenetrationJob } = await import("../src/lib/penetration/jobs")
const { getPenetrationHistoryRecord } = await import("../src/lib/penetration/history-store")

async function waitFor(
  predicate: (job: PenetrationJobRecord) => boolean,
  timeoutMs: number,
): Promise<PenetrationJobRecord> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const job = await getPenetrationJob("pjob_recovery_test", "test-user")
    if (job && predicate(job)) return job
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error("Timed out waiting for penetration recovery job")
}

try {
  await createPenetrationJob({
    id: "pjob_recovery_test",
    request: {
      clientId: "client-test",
      clientName: "测试客户",
      runId,
      operation: "replace",
      subjectType: "brand",
      ourBrand: "测试品牌",
      brandAliases: [],
      industry: "测试行业",
      website: "https://example.com",
      questions: [question],
      competitors: [],
      selectedModels: ["doubao"],
      models: ["doubao"],
    },
    ownerUserId: "test-user",
    reservation: {
      userId: "test-user",
      amount: 0,
      balanceAfterReserve: 0,
      ledgerContext: {
        featureKey: "penetrationSlot",
        source: "test",
        description: "test",
      },
    },
    skipped: [],
  })

  const retrying = await waitFor(job => (job.totalAttempts || 0) >= 1, 3_000)
  assert.equal(retrying.status, "running")
  assert.equal(retrying.completedSlots, 0)
  assert.equal(retrying.result, undefined)
  assert.equal(retrying.retryingSlots, 1)
  assert.equal(retrying.modelProgress?.doubao?.succeeded, 0)

  const succeeded = await waitFor(job => job.status === "succeeded", 10_000)
  assert.equal(succeeded.completedSlots, 1)
  assert.equal(succeeded.totalAttempts, 2)
  assert.equal(succeeded.modelErrors.doubao, undefined)
  assert.equal(succeeded.result?.byModel.doubao?.length, 1)
  assert.equal(succeeded.result?.byModel.doubao?.[0].answer, "第二次独立联网回答")
  assert.deepEqual(succeeded.result?.byModel.doubao?.[0].providerRequestIds, ["provider-request-2"])
  assert.equal(succeeded.historyRecordId, "pjob_recovery_test")
  assert.ok(succeeded.historySavedAt)
  assert.equal(succeeded.historySavePending, false)
  const history = await getPenetrationHistoryRecord("test-user", "pjob_recovery_test")
  assert.equal(history?.status, "succeeded")
  assert.equal(history?.result?.byModel.doubao?.[0].answer, "第二次独立联网回答")
  assert.equal(attempts, 2)

  console.log("Penetration background slot recovery passed.")
} finally {
  globalThis.fetch = originalFetch
  fs.rmSync(tempDir, { recursive: true, force: true })
}
