import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type {
  ModelKey,
  PenetrationItem,
  PenetrationJobRecord,
} from "../src/types"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-penetration-capacity-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(tempDir, "kv.json")
process.env.PENETRATION_HISTORY_STORE = "file"
process.env.PENETRATION_HISTORY_FILE = path.join(tempDir, "penetration-history.json")
process.env.PENETRATION_SCHEDULER_V2 = "true"
process.env.PENETRATION_JOB_WAVE_BATCH_LIMIT = "1"
process.env.PENETRATION_JOB_WAVE_SLOT_LIMIT = "1"
process.env.PORT = "3000"

const originalFetch = globalThis.fetch
const runId = "penetration_capacity_test_123456"
const question = "账号繁忙后是否会继续独立联网检测？"
let fetchAttempts = 0

function validItem(model: ModelKey): PenetrationItem {
  return {
    sampleId: `${runId}_${model}_1`,
    sampledAt: new Date().toISOString(),
    question,
    answer: `${model} 第三次请求得到的独立联网回答`,
    mentionedBrands: [],
    topRecommended: null,
    searchSources: [{
      title: "公开信源",
      snippet: "用于验证并发延后不消耗采样次数。",
      url: "https://example.com/capacity-recovery",
      domain: "example.com",
      query: question,
    }],
    sourceCount: 1,
    searchMode: "native_web",
    promptPurity: "raw_question_only",
    webAttempted: true,
    webExecutionVerified: true,
    providerRequestIds: ["provider-capacity-recovery"],
    webVerified: true,
    hitOur: false,
  }
}

globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body || "{}")) as {
    models: ModelKey[]
  }
  const model = body.models[0]
  fetchAttempts++
  if (fetchAttempts <= 2) {
    return new Response(JSON.stringify({
      byModel: {},
      generatedAt: new Date().toISOString(),
      modelErrors: {
        [model]: `${model} 当前账号任务较多，排队等待超时，请稍后重试`,
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  return new Response(JSON.stringify({
    byModel: { [model]: [validItem(model)] },
    generatedAt: new Date().toISOString(),
    modelErrors: {},
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

const { createPenetrationJob, getPenetrationJob } = await import(
  "../src/lib/penetration/jobs"
)

async function waitFor(
  predicate: (job: PenetrationJobRecord) => boolean,
  timeoutMs = 15_000,
): Promise<PenetrationJobRecord> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const job = await getPenetrationJob("pjob_capacity_test", "capacity-user")
    if (job && predicate(job)) return job
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error("Timed out waiting for capacity-deferral penetration job")
}

try {
  await createPenetrationJob({
    id: "pjob_capacity_test",
    request: {
      clientId: "client-capacity",
      clientName: "并发恢复客户",
      runId,
      operation: "replace",
      subjectType: "brand",
      ourBrand: "测试品牌",
      brandAliases: [],
      industry: "测试行业",
      website: "https://example.com",
      questions: [question],
      competitors: [],
      selectedModels: ["qwen"],
      models: ["qwen"],
    },
    ownerUserId: "capacity-user",
    reservation: {
      userId: "capacity-user",
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

  const deferred = await waitFor(job => job.phase === "retrying")
  assert.equal(deferred.status, "running")
  assert.equal(deferred.totalAttempts, 0, "capacity deferral must not consume a sample attempt")

  const terminal = await waitFor(job => job.status === "succeeded")
  assert.equal(terminal.totalAttempts, 1)
  assert.equal(terminal.completedSlots, 1)
  assert.equal(terminal.result?.byModel.qwen?.length, 1)
  assert.equal(fetchAttempts, 3)

  console.log("Penetration capacity deferral recovery passed.")
} finally {
  globalThis.fetch = originalFetch
  fs.rmSync(tempDir, { recursive: true, force: true })
}
