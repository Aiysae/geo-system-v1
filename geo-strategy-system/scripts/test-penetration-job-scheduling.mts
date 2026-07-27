import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type {
  ModelKey,
  PenetrationItem,
  PenetrationJobRecord,
} from "../src/types"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-penetration-scheduling-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(tempDir, "kv.json")
process.env.PENETRATION_HISTORY_STORE = "file"
process.env.PENETRATION_HISTORY_FILE = path.join(tempDir, "penetration-history.json")
process.env.PENETRATION_JOB_CONCURRENCY = "2"
process.env.PENETRATION_JOB_PER_USER_CONCURRENCY = "1"
process.env.PORT = "3000"

const originalFetch = globalThis.fetch
let activeRequests = 0
let maxActiveRequests = 0
const startedJobs: string[] = []
const activeOwners = new Set<string>()
let sameOwnerOverlap = false

function validItem(args: {
  runId: string
  model: ModelKey
  question: string
}): PenetrationItem {
  return {
    sampleId: `${args.runId}_${args.model}_1`,
    sampledAt: new Date().toISOString(),
    question: args.question,
    answer: `${args.runId} 的独立联网回答`,
    mentionedBrands: [],
    topRecommended: null,
    searchSources: [{
      title: `${args.runId} 的公开信源`,
      snippet: "用于验证并发调度的可点击文章来源。",
      url: `https://example.com/article/${args.runId}`,
      domain: "example.com",
      query: args.question,
    }],
    sourceCount: 1,
    searchMode: "native_web",
    promptPurity: "raw_question_only",
    requestAuditVerified: true,
    webAttempted: true,
    webExecutionVerified: true,
    providerRequestIds: [`provider-${args.runId}`],
    webVerified: true,
    hitOur: false,
  }
}

const ownerByRunId: Record<string, string> = {
  run_a1_1234567890: "owner-a",
  run_a2_1234567890: "owner-a",
  run_b1_1234567890: "owner-b",
}

globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body || "{}")) as {
    runId: string
    questions: string[]
    models: ModelKey[]
  }
  const owner = ownerByRunId[body.runId]
  startedJobs.push(body.runId)
  if (activeOwners.has(owner)) sameOwnerOverlap = true
  activeOwners.add(owner)
  activeRequests++
  maxActiveRequests = Math.max(maxActiveRequests, activeRequests)

  await new Promise(resolve => setTimeout(resolve, 120))

  activeRequests--
  activeOwners.delete(owner)
  const byModel = Object.fromEntries(body.models.map(model => [
    model,
    [validItem({
      runId: body.runId,
      model,
      question: body.questions[0],
    })],
  ]))
  return new Response(JSON.stringify({
    byModel,
    generatedAt: new Date().toISOString(),
    modelErrors: {},
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

const {
  createPenetrationJob,
  getPenetrationJob,
} = await import("../src/lib/penetration/jobs")

function reservation(userId: string) {
  return {
    userId,
    amount: 0,
    balanceAfterReserve: 0,
    ledgerContext: {
      featureKey: "penetrationSlot" as const,
      source: "test",
      description: "test",
    },
  }
}

async function createJob(args: {
  id: string
  runId: string
  ownerUserId: string
  question: string
}) {
  return createPenetrationJob({
    id: args.id,
    request: {
      clientId: `client-${args.id}`,
      clientName: args.id,
      runId: args.runId,
      operation: "replace",
      subjectType: "brand",
      ourBrand: "测试品牌",
      brandAliases: [],
      industry: "测试行业",
      website: "https://example.com",
      questions: [args.question],
      competitors: [],
      selectedModels: ["qwen"],
      models: ["qwen"],
    },
    ownerUserId: args.ownerUserId,
    reservation: reservation(args.ownerUserId),
    skipped: [],
  })
}

async function waitForTerminal(
  id: string,
  ownerUserId: string,
  timeoutMs = 5_000,
): Promise<PenetrationJobRecord> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const job = await getPenetrationJob(id, ownerUserId)
    if (job && ["succeeded", "failed", "blocked", "cancelled"].includes(job.status)) {
      return job
    }
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  throw new Error(`Timed out waiting for ${id}`)
}

try {
  await createJob({
    id: "pjob_a1",
    runId: "run_a1_1234567890",
    ownerUserId: "owner-a",
    question: "A 用户第一个问题",
  })
  while (!startedJobs.includes("run_a1_1234567890")) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }

  await createJob({
    id: "pjob_a2",
    runId: "run_a2_1234567890",
    ownerUserId: "owner-a",
    question: "A 用户第二个问题",
  })
  let queuedA2: PenetrationJobRecord | null = null
  const queueDeadline = Date.now() + 1_000
  while (Date.now() < queueDeadline) {
    queuedA2 = await getPenetrationJob("pjob_a2", "owner-a")
    if (queuedA2?.queuePosition) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.ok(queuedA2)
  assert.equal(queuedA2.queuePosition, 1)
  assert.equal(queuedA2.queueReason, "user_limit")

  await createJob({
    id: "pjob_b1",
    runId: "run_b1_1234567890",
    ownerUserId: "owner-b",
    question: "B 用户的问题",
  })

  const results = await Promise.all([
    waitForTerminal("pjob_a1", "owner-a"),
    waitForTerminal("pjob_a2", "owner-a"),
    waitForTerminal("pjob_b1", "owner-b"),
  ])

  assert.equal(results.every(job => job.status === "succeeded"), true)
  assert.equal(maxActiveRequests, 2, "全站最多只能并行两个检测任务")
  assert.equal(sameOwnerOverlap, false, "同一用户的检测任务不能同时占用多个执行位")
  assert.equal(
    startedJobs.slice(0, 2).includes("run_b1_1234567890"),
    true,
    "其他用户不能被同一用户的第二个任务挡在后面",
  )

  console.log("Penetration fair scheduling and concurrency limits passed.")
} finally {
  globalThis.fetch = originalFetch
  fs.rmSync(tempDir, { recursive: true, force: true })
}
