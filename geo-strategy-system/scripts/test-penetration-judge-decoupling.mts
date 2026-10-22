import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { ModelKey, PenetrationItem, PenetrationJobRecord } from "../src/types"

// Slow judging must not hold up sampling: on a Qwen-only re-run, waiting for
// each wave's judges left sampling idle for most of the job.

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-penetration-judge-decoupling-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(tempDir, "kv.json")
process.env.PENETRATION_HISTORY_STORE = "file"
process.env.PENETRATION_HISTORY_FILE = path.join(tempDir, "penetration-history.json")
process.env.WORKSPACE_STORE = "file"
process.env.WORKSPACE_FILE = path.join(tempDir, "workspace.json")
process.env.AI_CONFIG_ENCRYPTION_KEY = "test-judge-decoupling-encryption-key"
process.env.PENETRATION_SCHEDULER_V3 = "true"
process.env.PENETRATION_SCHEDULER_V2 = "true"
// One question per batch and a two-slot first wave: the old two-times refill
// cap stopped after six questions and waited for the judges.
process.env.PENETRATION_V3_QWEN_QUESTION_BATCH_SIZE = "1"
process.env.PENETRATION_JOB_WAVE_SLOT_LIMIT = "2"
process.env.PENETRATION_V3_WAVE_SLOT_LIMIT = "2"
process.env.PORT = "3000"

const originalFetch = globalThis.fetch
const runId = "penetration_judge_decoupling_123456"
const questions = Array.from({ length: 12 }, (_, index) => `解耦测试问题 ${index + 1}`)
const sampleStarts: number[] = []
const judgeFinishes: number[] = []

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
    await new Promise(resolve => setTimeout(resolve, 1_200))
    judgeFinishes.push(Date.now())
    return new Response(JSON.stringify({
      byModel: body.sampledByModel,
      generatedAt: new Date().toISOString(),
      modelErrors: {},
      pipelineStage: "judge",
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  }
  sampleStarts.push(Date.now())
  await new Promise(resolve => setTimeout(resolve, 30))
  return new Response(JSON.stringify({
    byModel: { qwen: body.questions.map((question, offset) => item(question, body.sampleStart + offset)) },
    generatedAt: new Date().toISOString(),
    modelErrors: {},
    pipelineStage: "sample",
  }), { status: 200, headers: { "Content-Type": "application/json" } })
}

const { createPenetrationJob, getPenetrationJob } = await import("../src/lib/penetration/jobs")
const { saveAiCredential, setAiCredentialEnabled, updateAiCredentialHealth } = await import("../src/lib/ai-credential-store")
const { orderJudgesByHealth, recordJudgeOutcome } = await import("../src/lib/penetration/judge-health")

async function waitForTerminal(): Promise<PenetrationJobRecord> {
  const started = Date.now()
  while (Date.now() - started < 30_000) {
    const job = await getPenetrationJob("pjob_judge_decoupling", "decoupling-user")
    if (job && ["succeeded", "blocked", "failed"].includes(job.status)) return job
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error("Timed out waiting for decoupled job")
}

try {
  // Judges are ranked by how they have done lately; a failing one sits out.
  for (let index = 0; index < 3; index++) await recordJudgeOutcome("hunyuan", false, 60_000)
  await recordJudgeOutcome("qwen", true, 8_000)
  await recordJudgeOutcome("doubao", true, 20_000)
  assert.deepEqual(
    await orderJudgesByHealth(["hunyuan", "doubao", "qwen"]),
    ["qwen", "doubao", "hunyuan"],
    "faster judges first, a judge failing in a row last",
  )

  for (let index = 1; index <= 2; index++) {
    const credential = await saveAiCredential({
      vendor: "qwen",
      name: `千问解耦测试 ${index}`,
      accountLabel: `${index}号账号`,
      quotaGroup: `qwen-decoupling-${index}`,
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      chatPath: "/chat/completions",
      apiKey: `sk-decoupling-test-${index}`,
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
    id: "pjob_judge_decoupling",
    request: {
      clientId: "client-decoupling",
      clientName: "解耦测试客户",
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
    ownerUserId: "decoupling-user",
    reservation: {
      userId: "decoupling-user",
      amount: 0,
      balanceAfterReserve: 0,
      ledgerContext: { featureKey: "penetrationSlot", source: "test", description: "test" },
    },
    skipped: [],
  })

  const terminal = await waitForTerminal()
  assert.equal(terminal.status, "succeeded")
  assert.equal(terminal.completedSlots, 12)
  assert.equal(sampleStarts.length, 12)
  const lastSampleStart = Math.max(...sampleStarts)
  const firstJudgeFinish = Math.min(...judgeFinishes)
  assert.ok(
    lastSampleStart < firstJudgeFinish,
    `every question must be asked before the first judge returns (last ask ${lastSampleStart - firstJudgeFinish}ms after it)`,
  )

  console.log("Penetration sampling runs ahead of judging, judges ranked by health.")
} finally {
  globalThis.fetch = originalFetch
  fs.rmSync(tempDir, { recursive: true, force: true })
}
