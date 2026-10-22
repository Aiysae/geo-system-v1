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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-penetration-model-rerun-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(tempDir, "kv.json")
process.env.PENETRATION_HISTORY_STORE = "file"
process.env.PENETRATION_HISTORY_FILE = path.join(tempDir, "penetration-history.json")
process.env.WORKSPACE_STORE = "file"
process.env.WORKSPACE_FILE = path.join(tempDir, "workspaces.json")
process.env.PORT = "3000"
process.env.PENETRATION_SCHEDULER_V3 = "false"
process.env.PENETRATION_SCHEDULER_V2 = "false"

const originalFetch = globalThis.fetch
const owner = "rerun-owner"
const questions = ["问题一", "问题二"]

function item(model: ModelKey, question: string, index: number, brand: string, runId: string): PenetrationItem {
  return {
    sampleId: `${runId}_${model}_${index + 1}`,
    sampledAt: new Date().toISOString(),
    question,
    answer: `${model} 推荐${brand}，这是对 ${question} 的独立联网回答。`,
    mentionedBrands: [brand],
    topRecommended: brand,
    searchSources: [{
      title: `${model} 公开来源`,
      snippet: "用于验证单模型重新检测。",
      url: `https://example.com/news/${runId}-${model}-${index + 1}`,
      domain: "example.com",
      query: question,
    }],
    sourceCount: 1,
    searchMode: "native_web",
    promptPurity: "raw_question_only",
    requestAuditVerified: true,
    webAttempted: true,
    webExecutionVerified: true,
    providerRequestIds: [`${model}-request-${index + 1}`],
    webVerified: true,
    extraction: { status: "succeeded", attempts: 1, version: 2 },
    hitOur: false,
  }
}

// The re-run answers name a different brand, so replacement is visible.
globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body || "{}")) as {
    questions: string[]
    models: ModelKey[]
    sampleStart: number
    runId?: string
  }
  const byModel: Partial<Record<ModelKey, PenetrationItem[]>> = {}
  for (const model of body.models) {
    byModel[model] = body.questions.map((question, offset) => (
      item(model, question, body.sampleStart + offset, "新品牌", body.runId || "rerun")
    ))
  }
  return new Response(JSON.stringify({ byModel, generatedAt: new Date().toISOString(), modelErrors: {} }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

const { buildPenetrationBatchResult, replacePenetrationModelAnswers } = await import("../src/lib/penetration/result-merge")
const { buildPenetrationModelStats, detectPenetrationModelAnomalies } = await import("../src/lib/penetration/model-diagnostics")
const { createWorkspaceClient, listWorkspaceClients } = await import("../src/lib/workspace-store")
const {
  createPenetrationJob,
  decidePenetrationModelRerun,
  getPenetrationJob,
} = await import("../src/lib/penetration/jobs")

const brandArgs = { ourBrand: "测试品牌", brandAliases: [] as string[], competitors: [] as string[], subjectType: "brand" as const }
const base = buildPenetrationBatchResult({
  operation: "replace",
  incomingByModel: {
    doubao: questions.map((question, index) => item("doubao", question, index, "旧品牌", "base")),
    kimi: questions.map((question, index) => item("kimi", question, index, "旧品牌", "base")),
  },
  ...brandArgs,
  generatedAt: "2026-10-20T00:00:00.000Z",
  plannedSlots: 4,
  modelCount: 2,
})

// A partly failed re-run keeps the earlier answer where it came back short.
{
  const merged = replacePenetrationModelAnswers({
    base,
    model: "kimi",
    incoming: [item("kimi", "问题一", 0, "新品牌", "partial")],
    rerun: { model: "kimi", jobId: "partial", rerunAt: "2026-10-22T00:00:00.000Z", questionCount: 2, samplesPerQuestion: 1 },
    ...brandArgs,
    generatedAt: "2026-10-22T00:00:00.000Z",
  })
  assert.deepEqual(merged.byModel.kimi?.map(entry => entry.mentionedBrands[0]), ["新品牌", "旧品牌"])
  assert.deepEqual(merged.byModel.doubao, base.byModel.doubao, "other models stay untouched")
  assert.equal(merged.modelReruns?.[0]?.answerCount, 1)
  assert.equal(merged.aggregated.totalSlots, 4)
}

// Anomaly rules fire on the patterns they were written for.
{
  const answers = (model: ModelKey, hits: number, total: number, brands: string[] = ["别家"]) => (
    Array.from({ length: total }, (_, index) => ({
      ...item(model, `问题${index}`, index, "别家", `anomaly-${model}`),
      mentionedBrands: brands,
      hitOur: index < hits,
      answer: `${index < hits ? "测试品牌" : ""}${"这是一段足够长的回答内容。".repeat(40)}`,
      searchSources: ["a.com", "b.com", "c.com", "d.com"].map(domain => ({
        title: domain,
        snippet: "公开来源",
        url: `https://${domain}/${model}-${index}`,
        domain,
        query: `问题${index}`,
      })),
    }))
  )
  const result = buildPenetrationBatchResult({
    operation: "replace",
    incomingByModel: {
      deepseek: answers("deepseek", 8, 20),
      doubao: answers("doubao", 1, 20),
      qwen: answers("qwen", 1, 20),
      kimi: answers("kimi", 1, 20, []),
    },
    ...brandArgs,
    generatedAt: "2026-10-22T00:00:00.000Z",
  })
  const anomalies = detectPenetrationModelAnomalies(buildPenetrationModelStats(result))
  assert.ok(anomalies.some(item => item.model === "deepseek" && item.code === "target_rate_high"))
  assert.ok(anomalies.some(item => item.model === "kimi" && item.code === "no_brand_answers"))
  assert.ok(!anomalies.some(item => item.model === "doubao"), "a normal model raises nothing")
}

async function waitForTerminal(id: string): Promise<PenetrationJobRecord> {
  const started = Date.now()
  while (Date.now() - started < 8_000) {
    const job = await getPenetrationJob(id, owner)
    if (job && ["succeeded", "blocked", "failed", "cancelled"].includes(job.status)) return job
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${id}`)
}

async function workspacePenetration() {
  const clients = await listWorkspaceClients(owner)
  return clients.find(entry => entry.client.id === "rerun-client")?.client
}

const reservation = {
  userId: owner,
  amount: 0,
  balanceAfterReserve: 0,
  ledgerContext: { featureKey: "penetrationSlot" as const, source: "test", description: "test" },
}

function rerunRequest(id: string, mode: "compare" | "overwrite") {
  return {
    id,
    request: {
      clientId: "rerun-client",
      clientName: "重测客户",
      runId: id,
      operation: "model_rerun" as const,
      rerunMode: mode,
      ...brandArgs,
      industry: "测试行业",
      website: "https://example.com",
      questions,
      competitors: [],
      selectedModels: ["kimi" as ModelKey],
      models: ["kimi" as ModelKey],
      samplesPerQuestion: 1,
    },
    ownerUserId: owner,
    reservation,
    skipped: [],
  }
}

try {
  const client: Client = {
    id: "rerun-client",
    name: "重测客户",
    subjectType: "brand",
    ourBrand: "测试品牌",
    brandAliases: [],
    industry: "测试行业",
    website: "https://example.com",
    questions,
    competitors: [],
    selectedModels: ["doubao", "kimi"],
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    penetration: base,
  }
  await createWorkspaceClient(owner, client)

  // Compare first: the report stays as it was until the user decides.
  await createPenetrationJob({ ...rerunRequest("pjob_rerun_compare", "compare"), baseResult: base })
  const compared = await waitForTerminal("pjob_rerun_compare")
  assert.equal(compared.status, "succeeded")
  assert.equal(compared.modelRerun?.decision, "pending")
  assert.equal(compared.result, undefined, "a pending comparison never hands its report to the page")
  assert.equal(compared.modelRerun?.after?.model?.answers, 2)
  assert.equal(compared.modelRerun?.before?.model?.topBrands[0]?.brand, "旧品牌")
  let saved = await workspacePenetration()
  assert.equal(saved?.penetration?.generatedAt, base.generatedAt)
  assert.equal(saved?.penetrationRerunJobId, "pjob_rerun_compare")

  const applied = await decidePenetrationModelRerun("pjob_rerun_compare", owner, "apply")
  assert.deepEqual(applied.penetration?.byModel.kimi?.map(entry => entry.mentionedBrands[0]), ["新品牌", "新品牌"])
  assert.deepEqual(applied.penetration?.byModel.doubao, base.byModel.doubao)
  assert.equal(applied.job.modelRerun?.undoable, true)
  saved = await workspacePenetration()
  assert.equal(saved?.penetration?.byModel.kimi?.[0]?.mentionedBrands[0], "新品牌")
  await assert.rejects(decidePenetrationModelRerun("pjob_rerun_compare", owner, "discard"), /已经处理过/)

  // Undo restores the report it replaced.
  const undone = await decidePenetrationModelRerun("pjob_rerun_compare", owner, "undo")
  assert.equal(undone.penetration?.generatedAt, base.generatedAt)
  saved = await workspacePenetration()
  assert.equal(saved?.penetration?.byModel.kimi?.[0]?.mentionedBrands[0], "旧品牌")
  assert.equal(saved?.penetrationRerunJobId, undefined)

  // Overwrite writes the moment the re-run ends, and only for that model.
  await createPenetrationJob({ ...rerunRequest("pjob_rerun_overwrite", "overwrite"), baseResult: base })
  const overwritten = await waitForTerminal("pjob_rerun_overwrite")
  assert.equal(overwritten.modelRerun?.decision, "applied")
  assert.equal(overwritten.result?.byModel.kimi?.[0]?.mentionedBrands[0], "新品牌")
  saved = await workspacePenetration()
  assert.equal(saved?.penetration?.byModel.kimi?.[0]?.mentionedBrands[0], "新品牌")
  assert.deepEqual(saved?.penetration?.byModel.doubao, base.byModel.doubao)
  assert.equal(saved?.penetration?.modelReruns?.at(-1)?.jobId, "pjob_rerun_overwrite")

  console.log("Penetration single-model re-run, comparison, undo and anomaly contracts passed.")
} finally {
  globalThis.fetch = originalFetch
  fs.rmSync(tempDir, { recursive: true, force: true })
}
