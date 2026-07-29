import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { PenetrationItem, PenetrationJobRecord } from "../src/types"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-penetration-batch-isolation-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(tempDir, "kv.json")
process.env.PENETRATION_HISTORY_STORE = "file"
process.env.PENETRATION_HISTORY_FILE = path.join(tempDir, "penetration-history.json")
process.env.PORT = "3000"
process.env.PENETRATION_SCHEDULER_V3 = "false"
process.env.PENETRATION_SCHEDULER_V2 = "false"

const originalFetch = globalThis.fetch
const runId = "penetration_batch_isolation_test"
const questions = [
  "同批次里已经成功的问题会保持成功吗？",
  "同批次里失败的问题会被单独补采吗？",
]
const requestedQuestionBatches: string[][] = []

function completeItem(question: string, sampleIndex: number): PenetrationItem {
  return {
    sampleId: `${runId}_doubao_${sampleIndex + 1}`,
    sampledAt: new Date().toISOString(),
    question,
    answer: `独立联网回答：${question}`,
    mentionedBrands: [],
    topRecommended: null,
    searchSources: [{
      title: `公开来源 ${sampleIndex + 1}`,
      snippet: "这是可点击、可读取的公开文章网址。",
      url: `https://example.com/article/${sampleIndex + 1}`,
      domain: "example.com",
      query: question,
    }],
    sourceCount: 1,
    searchMode: "native_web",
    promptPurity: "raw_question_only",
    requestAuditVerified: true,
    webAttempted: true,
    webExecutionVerified: true,
    providerRequestIds: [`provider-request-${sampleIndex + 1}`],
    webVerified: true,
    hitOur: false,
  }
}

function failedItem(question: string, sampleIndex: number): PenetrationItem & { error: string } {
  return {
    ...completeItem(question, sampleIndex),
    answer: "",
    searchSources: [],
    sourceCount: 0,
    requestAuditVerified: false,
    webExecutionVerified: false,
    providerRequestIds: [],
    webVerified: false,
    error: "豆包官方联网没有返回可点击信源",
  }
}

globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body || "{}")) as {
    questions?: string[]
    sampleStart?: number
  }
  const requestedQuestions = body.questions || []
  requestedQuestionBatches.push(requestedQuestions)
  const sampleStart = body.sampleStart || 0
  const firstBatch = requestedQuestionBatches.length === 1
  const items = requestedQuestions.map((question, offset) => {
    const sampleIndex = sampleStart + offset
    if (firstBatch && question === questions[1]) return failedItem(question, sampleIndex)
    return completeItem(question, sampleIndex)
  })

  return new Response(JSON.stringify({
    byModel: { doubao: items },
    generatedAt: new Date().toISOString(),
    modelErrors: firstBatch
      ? { doubao: "部分请求失败（1/2）：豆包官方联网没有返回可点击信源" }
      : {},
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

const { createPenetrationJob, getPenetrationJob } = await import("../src/lib/penetration/jobs")

async function waitForTerminal(timeoutMs: number): Promise<PenetrationJobRecord> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const job = await getPenetrationJob("pjob_batch_isolation_test", "test-user")
    if (job && ["succeeded", "partial", "failed"].includes(job.status)) return job
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error("Timed out waiting for penetration batch isolation job")
}

try {
  await createPenetrationJob({
    id: "pjob_batch_isolation_test",
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
      questions,
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

  const completed = await waitForTerminal(12_000)
  assert.equal(completed.status, "succeeded")
  assert.equal(completed.completedSlots, 2)
  assert.equal(completed.totalAttempts, 3)
  assert.deepEqual(requestedQuestionBatches[0], questions)
  assert.deepEqual(
    requestedQuestionBatches.slice(1),
    [[questions[1]]],
    "成功题不得因同模型另一题失败而被重新请求",
  )
  assert.equal(completed.result?.byModel.doubao?.length, 2)
  assert.deepEqual(
    completed.result?.byModel.doubao?.map(item => item.question),
    questions,
  )

  console.log("Penetration batch item isolation passed.")
} finally {
  globalThis.fetch = originalFetch
  fs.rmSync(tempDir, { recursive: true, force: true })
}
