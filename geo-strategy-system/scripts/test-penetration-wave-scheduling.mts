import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type {
  Client,
  ModelKey,
  PenetrationItem,
  PenetrationJobRecord,
} from "../src/types"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-penetration-wave-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(tempDir, "kv.json")
process.env.PENETRATION_HISTORY_STORE = "file"
process.env.PENETRATION_HISTORY_FILE = path.join(tempDir, "penetration-history.json")
process.env.WORKSPACE_STORE = "file"
process.env.WORKSPACE_FILE = path.join(tempDir, "workspace.json")
process.env.AI_CONFIG_ENCRYPTION_KEY = "test-wave-credential-encryption-key"
process.env.PENETRATION_SCHEDULER_V3 = "true"
process.env.PENETRATION_SCHEDULER_V2 = "true"
process.env.PENETRATION_JOB_WAVE_BATCH_LIMIT = "4"
process.env.PENETRATION_JOB_WAVE_SLOT_LIMIT = "8"
process.env.PORT = "3000"

const originalFetch = globalThis.fetch
const runId = "penetration_wave_test_123456"
const questions = Array.from({ length: 6 }, (_, index) => `并行检测问题 ${index + 1}`)
let activeRequests = 0
let maxActiveRequests = 0
let sawMultiModelBatch = false
const requestWindows: Array<{
  model: ModelKey
  sampleStart: number
  startedAt: number
  finishedAt?: number
}> = []
const judgeWindows: Array<{
  model: ModelKey
  startedAt: number
  finishedAt?: number
}> = []

function validItem(args: {
  model: ModelKey
  question: string
  sampleIndex: number
}): PenetrationItem {
  return {
    sampleId: `${runId}_${args.model}_${args.sampleIndex + 1}`,
    sampledAt: new Date().toISOString(),
    question: args.question,
    answer: `${args.model} 对 ${args.question} 的独立联网回答`,
    mentionedBrands: [],
    topRecommended: null,
    searchSources: [{
      title: `${args.model} 公开信源`,
      snippet: "用于验证并行波次调度。",
      url: `https://example.com/${args.model}/${args.sampleIndex + 1}`,
      domain: "example.com",
      query: args.question,
    }],
    sourceCount: 1,
    searchMode: "native_web",
    promptPurity: "raw_question_only",
    requestAuditVerified: true,
    webAttempted: true,
    webExecutionVerified: true,
    providerRequestIds: [`provider-${args.model}-${args.sampleIndex + 1}`],
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
    const judgeWindow = {
      model: body.models[0],
      startedAt: Date.now(),
      finishedAt: undefined as number | undefined,
    }
    judgeWindows.push(judgeWindow)
    await new Promise(resolve => setTimeout(resolve, 300))
    judgeWindow.finishedAt = Date.now()
    return new Response(JSON.stringify({
      byModel: body.sampledByModel,
      generatedAt: new Date().toISOString(),
      modelErrors: {},
      pipelineStage: "judge",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }
  if (body.models.length > 1) sawMultiModelBatch = true
  activeRequests++
  maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
  const model = body.models[0]
  const requestWindow = {
    model,
    sampleStart: body.sampleStart,
    startedAt: Date.now(),
    finishedAt: undefined as number | undefined,
  }
  requestWindows.push(requestWindow)
  await new Promise(resolve => setTimeout(resolve, model === "qwen" ? 40 : 500))
  requestWindow.finishedAt = Date.now()
  activeRequests--

  return new Response(JSON.stringify({
    byModel: {
      [model]: body.questions.map((question, offset) => validItem({
        model,
        question,
        sampleIndex: body.sampleStart + offset,
      })),
    },
    generatedAt: new Date().toISOString(),
    modelErrors: {},
    pipelineStage: "sample",
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

const { createPenetrationJob, getPenetrationJob } = await import(
  "../src/lib/penetration/jobs"
)
const { createWorkspaceClient, listWorkspaceClients } = await import(
  "../src/lib/workspace-store"
)
const {
  saveAiCredential,
  setAiCredentialEnabled,
  updateAiCredentialHealth,
} = await import("../src/lib/ai-credential-store")


async function waitFor(
  predicate: (job: PenetrationJobRecord) => boolean,
  timeoutMs = 10_000,
): Promise<PenetrationJobRecord> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const job = await getPenetrationJob("pjob_wave_test", "wave-user")
    if (job && predicate(job)) return job
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error("Timed out waiting for penetration wave job")
}

async function waitForWorkspace(
  predicate: (client: Client) => boolean,
  timeoutMs = 5_000,
): Promise<Client> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const client = (await listWorkspaceClients("wave-user"))[0]?.client
    if (client && predicate(client)) return client
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error("Timed out waiting for partial workspace persistence")
}

try {
  for (let index = 1; index <= 4; index++) {
    const credential = await saveAiCredential({
      vendor: "qwen",
      name: `千问测试账号 ${index}`,
      accountLabel: `${index}号账号`,
      quotaGroup: `qwen-wave-account-${index}`,
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      chatPath: "/chat/completions",
      apiKey: `sk-wave-test-${index}`,
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
      latencyMs: 20 + index,
    })
    await setAiCredentialEnabled(credential.id, true, "admin-test")
  }

  const now = new Date().toISOString()
  const workspaceClient: Client = {
    id: "client-wave",
    name: "并行波次客户",
    subjectType: "brand",
    ourBrand: "测试品牌",
    brandAliases: [],
    industry: "测试行业",
    website: "https://example.com",
    questions,
    competitors: [],
    selectedModels: ["qwen", "doubao"],
    penetrationJobId: "pjob_wave_test",
    createdAt: now,
    updatedAt: now,
  }
  await createWorkspaceClient("wave-user", workspaceClient)
  await createPenetrationJob({
    id: "pjob_wave_test",
    request: {
      clientId: "client-wave",
      clientName: "并行波次客户",
      runId,
      operation: "replace",
      subjectType: "brand",
      ourBrand: "测试品牌",
      brandAliases: [],
      industry: "测试行业",
      website: "https://example.com",
      questions,
      competitors: [],
      selectedModels: ["qwen", "doubao"],
      models: ["qwen", "doubao"],
    },
    ownerUserId: "wave-user",
    reservation: {
      userId: "wave-user",
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

  const partial = await waitFor(job =>
    job.status === "running"
    && (job.result?.byModel.qwen?.length || 0) > 0
    && (job.result?.byModel.doubao?.length || 0) === 0
  )
  assert.ok((partial.completedSlots || 0) > 0, "fast model results must persist immediately")
  const partialWorkspace = await waitForWorkspace(client =>
    (client.penetration?.byModel.qwen?.length || 0) > 0
  )
  assert.equal(
    partialWorkspace.penetrationJobId,
    "pjob_wave_test",
    "partial persistence must keep the running job attached",
  )

  const terminal = await waitFor(job => job.status === "succeeded")
  assert.equal(terminal.completedSlots, 12)
  assert.equal(terminal.result?.byModel.qwen?.length, 6)
  assert.equal(terminal.result?.byModel.doubao?.length, 6)
  assert.equal(sawMultiModelBatch, false, "slow providers must not block fast providers in one batch")
  assert.ok(maxActiveRequests >= 2, "independent providers must run concurrently")
  const firstSlowRequest = requestWindows.find(item => item.model === "doubao")
  const qwenRefill = requestWindows.find(item =>
    item.model === "qwen" && item.sampleStart >= 4
  )
  assert.ok(firstSlowRequest?.finishedAt)
  assert.ok(qwenRefill)
  assert.ok(
    qwenRefill.startedAt < firstSlowRequest.finishedAt,
    "a released fast lane must accept the next question before a slow lane finishes",
  )
  const firstQwenJudge = judgeWindows.find(item => item.model === "qwen")
  assert.ok(firstQwenJudge?.finishedAt)
  assert.ok(
    qwenRefill.startedAt < firstQwenJudge.finishedAt,
    "web sampling must continue while the independent judge pipeline is running",
  )
  const terminalWorkspace = await waitForWorkspace(client => !client.penetrationJobId)
  assert.equal(terminalWorkspace.penetration?.byModel.qwen?.length, 6)
  assert.equal(terminalWorkspace.penetration?.byModel.doubao?.length, 6)

  console.log("Penetration model-isolated wave scheduling passed.")
} finally {
  globalThis.fetch = originalFetch
  fs.rmSync(tempDir, { recursive: true, force: true })
}
