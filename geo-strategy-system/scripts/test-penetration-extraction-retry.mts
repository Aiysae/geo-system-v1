import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { ModelKey, PenetrationItem, PenetrationJobRecord } from "../src/types"

// An answer no judge could read gets one more pass before the run closes,
// and only unread answers go back to the judge.

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-penetration-extraction-retry-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(tempDir, "kv.json")
process.env.PENETRATION_HISTORY_STORE = "file"
process.env.PENETRATION_HISTORY_FILE = path.join(tempDir, "penetration-history.json")
process.env.WORKSPACE_STORE = "file"
process.env.WORKSPACE_FILE = path.join(tempDir, "workspace.json")
process.env.AI_CONFIG_ENCRYPTION_KEY = "test-extraction-retry-encryption-key"
process.env.PENETRATION_SCHEDULER_V3 = "true"
process.env.PENETRATION_SCHEDULER_V2 = "true"
process.env.PORT = "3000"

const originalFetch = globalThis.fetch
const runId = "penetration_extraction_retry_123456"
const questions = Array.from({ length: 3 }, (_, index) => `补识别测试问题 ${index + 1}`)
const judgedSampleIds: string[][] = []

function item(question: string, index: number): PenetrationItem {
  return {
    sampleId: `${runId}_qwen_${index + 1}`,
    sampledAt: new Date().toISOString(),
    question,
    answer: `qwen 对 ${question} 的独立联网回答`,
    mentionedBrands: [],
    topRecommended: null,
    searchSources: [{
      title: "公开信源",
      snippet: "用于验证采样不等待裁判。",
      url: `https://example.com/qwen/${index + 1}`,
      domain: "example.com",
      query: question,
    }],
    sourceCount: 1,
    searchMode: "native_web",
    promptPurity: "raw_question_only",
    requestAuditVerified: true,
    webAttempted: true,
    webExecutionVerified: true,
    providerRequestIds: [`provider-qwen-${index + 1}`],
    webVerified: true,
    hitOur: false,
  }
}

globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body || "{}")) as {
    models: ModelKey[]
    questions: string[]
    sampleStart: number
    pipelineStage?: "sample" | "judge"
    sampledByModel?: Record<ModelKey, PenetrationItem[]>
  }
  if (body.pipelineStage === "judge") {
    const items = Object.values(body.sampledByModel || {}).flat()
    judgedSampleIds.push(items.map(entry => entry.sampleId || ""))
    const firstPass = judgedSampleIds.length === 1
    const byModel = Object.fromEntries(Object.entries(body.sampledByModel || {}).map(([model, entries]) => [
      model,
      entries.map(entry => ({
        ...entry,
        mentionedBrands: firstPass && entry.sampleId?.endsWith("_2") ? [] : ["读到的品牌"],
        extraction: firstPass && entry.sampleId?.endsWith("_2")
          ? { status: "failed", attempts: 3, version: 2, error: "裁判超时" }
          : { status: "succeeded", attempts: 1, version: 2 },
      })),
    ]))
    return new Response(JSON.stringify({
      byModel,
      generatedAt: new Date().toISOString(),
      modelErrors: {},
      pipelineStage: "judge",
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  }

  return new Response(JSON.stringify({
    byModel: { qwen: body.questions.map((question, offset) => item(question, body.sampleStart + offset)) },
    generatedAt: new Date().toISOString(),
    modelErrors: {},
    pipelineStage: "sample",
  }), { status: 200, headers: { "Content-Type": "application/json" } })
}

const { createPenetrationJob, getPenetrationJob } = await import("../src/lib/penetration/jobs")
const { saveAiCredential, setAiCredentialEnabled, updateAiCredentialHealth } = await import("../src/lib/ai-credential-store")
const { failedExtractionAnswers, mergeReextractedAnswers } = await import("../src/lib/penetration/result-merge")

async function waitForTerminal(): Promise<PenetrationJobRecord> {
  const started = Date.now()
  while (Date.now() - started < 30_000) {
    const job = await getPenetrationJob("pjob_extraction_retry", "retry-user")
    if (job && ["succeeded", "blocked", "failed"].includes(job.status)) return job
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error("Timed out waiting for decoupled job")
}

try {
  for (let index = 1; index <= 2; index++) {
    const credential = await saveAiCredential({
      vendor: "qwen",
      name: `千问补识别测试 ${index}`,
      accountLabel: `${index}号账号`,
      quotaGroup: `qwen-retry-${index}`,
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      chatPath: "/chat/completions",
      apiKey: `sk-retry-test-${index}`,
      enabled: false,
      priority: 1,
      maxConcurrency: 1,
      quotaGroupMaxConcurrency: 1,
      allowedModels: ["qwen-plus"],
      allowedModules: ["penetration"],
      declaredCapabilities: ["chat", "native_web", "auditable_sources"],
    }, "admin-test")
    await updateAiCredentialHealth(credential.id, {
      status: "healthy",
      verifiedCapabilities: ["chat", "native_web", "auditable_sources"],
      verifiedWebModels: ["qwen-plus"],
      latencyMs: 20,
    })
    await setAiCredentialEnabled(credential.id, true, "admin-test")
  }

  await createPenetrationJob({
    id: "pjob_extraction_retry",
    request: {
      clientId: "client-retry",
      clientName: "补识别测试客户",
      runId,
      operation: "replace",
      subjectType: "brand",
      ourBrand: "测试品牌",
      brandAliases: [],
      industry: "测试行业",
      website: "https://example.com",
      questions,
      competitors: [],
      selectedModels: ["qwen"],
      models: ["qwen"],
    },
    ownerUserId: "retry-user",
    reservation: {
      userId: "retry-user",
      amount: 0,
      balanceAfterReserve: 0,
      ledgerContext: { featureKey: "penetrationSlot", source: "test", description: "test" },
    },
    skipped: [],
  })

  const terminal = await waitForTerminal()
  assert.equal(terminal.status, "succeeded")
  const items = terminal.result?.byModel.qwen || []
  assert.equal(items.length, 3)
  assert.ok(items.every(entry => entry.extraction?.status === "succeeded"), "the closing pass reads the answer the judge missed")
  assert.deepEqual(items.find(entry => entry.sampleId?.endsWith("_2"))?.mentionedBrands, ["读到的品牌"])
  assert.deepEqual(judgedSampleIds.at(-1), [`${runId}_qwen_2`], "only the unread answer goes back to the judge")

  // Merging re-read answers replaces only those the judge now read.
  const base = terminal.result!
  const reread = {
    qwen: [{ ...items[0], mentionedBrands: ["新读到"], extraction: { status: "succeeded" as const, attempts: 1, version: 2 as const } },
      { ...items[1], mentionedBrands: [], extraction: { status: "failed" as const, attempts: 1, version: 2 as const } }],
  }
  const merged = mergeReextractedAnswers({ base, incoming: reread, ourBrand: "测试品牌", brandAliases: [], competitors: [], generatedAt: new Date().toISOString() })
  assert.deepEqual(merged.byModel.qwen?.map(entry => entry.mentionedBrands[0]), ["新读到", "读到的品牌", "读到的品牌"])
  assert.deepEqual(failedExtractionAnswers(merged.byModel), {})

  // A page holding an older report cannot save it over a newer one.
  const { isOlderDetectionResult } = await import("../src/lib/workspace-sync")
  assert.equal(isOlderDetectionResult("2026-10-22T13:00:00.000Z", "2026-10-22T13:22:07.511Z"), true)
  assert.equal(isOlderDetectionResult("2026-10-22T13:22:07.511Z", "2026-10-22T13:22:07.511Z"), false, "the same report saves again")
  assert.equal(isOlderDetectionResult("2026-10-22T14:00:00.000Z", "2026-10-22T13:22:07.511Z"), false)
  assert.equal(isOlderDetectionResult("2026-10-22T13:00:00.000Z", undefined), false, "nothing saved yet")

  console.log("Penetration unread answers get a closing judge pass, and only they are re-read.")
} finally {
  globalThis.fetch = originalFetch
  fs.rmSync(tempDir, { recursive: true, force: true })
}
