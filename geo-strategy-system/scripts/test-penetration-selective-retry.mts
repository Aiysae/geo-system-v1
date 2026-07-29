import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type {
  ModelKey,
  PenetrationItem,
  PenetrationJobRecord,
} from "../src/types"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-penetration-selective-retry-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(tempDir, "kv.json")
process.env.PENETRATION_HISTORY_STORE = "file"
process.env.PENETRATION_HISTORY_FILE = path.join(tempDir, "penetration-history.json")
process.env.PORT = "3000"
process.env.PENETRATION_SCHEDULER_V3 = "false"
process.env.PENETRATION_SCHEDULER_V2 = "false"

const originalFetch = globalThis.fetch
const runId = "penetration_selective_retry_test"
const questions = ["问题一", "问题二"]
const requestedSlots: string[] = []

function item(model: ModelKey, question: string, questionIndex: number): PenetrationItem {
  return {
    sampleId: `${runId}_${model}_${questionIndex + 1}`,
    sampledAt: new Date().toISOString(),
    question,
    answer: `${model} 对 ${question} 的独立联网回答`,
    mentionedBrands: [],
    topRecommended: null,
    searchSources: [{
      title: `${model} 公开来源`,
      snippet: "用于验证稀疏重试只执行指定的模型问题组合。",
      url: `https://example.com/news/${model}-${questionIndex + 1}`,
      domain: "example.com",
      query: question,
    }],
    sourceCount: 1,
    searchMode: "native_web",
    promptPurity: "raw_question_only",
    requestAuditVerified: true,
    webAttempted: true,
    webExecutionVerified: true,
    providerRequestIds: [`${model}-request-${questionIndex + 1}`],
    webVerified: true,
    hitOur: false,
  }
}

globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body || "{}")) as {
    questions: string[]
    models: ModelKey[]
    sampleStart: number
  }
  const byModel: Partial<Record<ModelKey, PenetrationItem[]>> = {}
  for (const model of body.models) {
    byModel[model] = body.questions.map((question, offset) => {
      const questionIndex = body.sampleStart + offset
      requestedSlots.push(`${model}:${questionIndex}`)
      return item(model, question, questionIndex)
    })
  }
  return new Response(JSON.stringify({
    byModel,
    generatedAt: new Date().toISOString(),
    modelErrors: {},
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

const { createPenetrationJob, getPenetrationJob } = await import("../src/lib/penetration/jobs")

async function waitForTerminal(timeoutMs: number): Promise<PenetrationJobRecord> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const job = await getPenetrationJob("pjob_selective_retry_test", "test-user")
    if (job && ["succeeded", "blocked", "failed"].includes(job.status)) return job
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error("Timed out waiting for selective retry job")
}

try {
  const created = await createPenetrationJob({
    id: "pjob_selective_retry_test",
    request: {
      clientId: "client-test",
      clientName: "测试客户",
      runId,
      operation: "append",
      subjectType: "brand",
      ourBrand: "测试品牌",
      brandAliases: [],
      industry: "测试行业",
      website: "https://example.com",
      questions,
      competitors: [],
      selectedModels: ["doubao", "qwen"],
      models: ["doubao", "qwen"],
      slotSelection: [
        { model: "doubao", questionIndex: 0 },
        { model: "qwen", questionIndex: 1 },
      ],
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

  assert.equal(created.totalSlots, 2)
  assert.equal(created.queuedSlots, 2)

  const completed = await waitForTerminal(5_000)
  assert.equal(completed.status, "succeeded")
  assert.equal(completed.completedSlots, 2)
  assert.equal(completed.totalAttempts, 2)
  assert.deepEqual(requestedSlots.sort(), ["doubao:0", "qwen:1"])
  assert.deepEqual(
    completed.result?.byModel.doubao?.map(entry => entry.question),
    [questions[0]],
  )
  assert.deepEqual(
    completed.result?.byModel.qwen?.map(entry => entry.question),
    [questions[1]],
  )

  console.log("Penetration selective failed-slot retry passed.")
} finally {
  globalThis.fetch = originalFetch
  fs.rmSync(tempDir, { recursive: true, force: true })
}
