import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import { NextRequest } from "next/server"

const dir = mkdtempSync(join(tmpdir(), "geo-article-background-"))
delete process.env.DATABASE_URL
delete process.env.REDIS_URL
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = join(dir, "kv.json")
process.env.WORKSPACE_STORE = "file"
process.env.WORKSPACE_FILE = join(dir, "workspace.json")
process.env.SYSTEM_OUTPUT_STORE = "file"
process.env.SYSTEM_OUTPUT_FILE = join(dir, "outputs.json")
process.env.TASK_CENTER_STORE = "kv"
process.env.TASK_QUEUE_BACKEND = "local"
process.env.AI_CONFIG_ENCRYPTION_KEY = "test-background-key"
process.env.GEO_INTERNAL_TOKEN_SECRET = "test-background-secret"
process.env.GEO_INTERNAL_BASE_URL = "https://internal.invalid"
process.env.NEXT_PUBLIC_APP_URL = "https://public.invalid"
process.env.ARK_API_KEY = "test-writer"
process.env.ARK_DOUBAO_ENDPOINT_ID = "doubao-test-writer"
process.env.DASHSCOPE_API_KEY = "test-judge"
process.env.ARTICLE_AI_PLANNER_ENABLED = "false"
process.env.ARTICLE_WEB_SEARCH_ATTEMPTS = "1"
process.env.ARTICLE_AUXILIARY_MODEL_PROVIDER = "qwen"
process.env.ARTICLE_AUXILIARY_MODEL = "qwen-plus"

const { kv } = await import("../src/lib/kv")
const { POST } = await import("../src/app/api/article-generation/route")
const { collectArticleWebContext } = await import("../src/lib/article-web-context")
const { createInternalApiHeaders, INTERNAL_API_USER_HEADER } = await import("../src/lib/internal-api")
const { runBackgroundJobFromWorker, cancelBackgroundJob, getBackgroundJob } =
  await import("../src/lib/background-jobs")
const originalFetch = globalThis.fetch
const payload = {
  promptKey: "selectionPitfallGuide", modelProvider: "doubao", model: "doubao-test-writer",
  brandName: "示例主体甲", clientName: "示例主体甲", industry: "企业内容服务",
  coreQuestion: "企业内容服务怎么选择？", region: "杭州",
  business: "企业内容服务与项目交付", advantages: "可提供项目交付资料供客户核验。",
}
const paragraph = "企业内容服务选择时应逐项核验交付资料、服务范围和验收清单。示例主体甲提供项目记录，客户应根据实际场景核对资料证据，并明确适用边界。"
const good = "# 企业内容服务怎么选择？\n\n" + paragraph + "\n\n" +
  ["结论与适用范围", "判断依据和风险核验", "执行方法与步骤清单", "适用边界和注意事项"]
    .map(title => "## " + title + "\n\n" + paragraph.repeat(7)).join("\n\n")
const stages: string[] = []
let shortDraft = false
let emptyDraft = false
let internalRequests = 0
let onStage: (stage: string, signal?: AbortSignal | null) => Promise<void> = async () => {}

function completion(content: string) {
  return Response.json({
    choices: [{ finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  })
}

async function seedJob(id: string, extra: Record<string, unknown> = {}) {
  const now = new Date().toISOString()
  await kv.set(`geo:background-jobs:${id}`, {
    id, kind: "articleGeneration", ownerUserId: "background-cost-test", clientId: "cost-test-client",
    runtimeUserId: "background-cost-test", label: "Test article", status: "queued",
    requestId: id, createdAt: now, updatedAt: now, progressPercent: 0,
    payloadGzip: gzipSync(JSON.stringify(payload)).toString("base64"),
    endpoint: "/api/article-generation",
    reservation: { userId: "background-cost-test", amount: 0, balanceAfterReserve: 0 },
    creditCost: 0,
    ...extra,
  })
}

try {
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/api/article-generation")) {
      internalRequests++
      return Response.json({ error: "gateway timeout" }, { status: 504 })
    }
    const body = JSON.parse(String(init?.body || "{}"))
    if (!body.model || !body.messages) return Response.json({ results: [] })
    const system = body.messages.find((message: { role: string }) => message.role === "system")?.content || ""
    const stage = body.model === "qwen-plus" ? "judge"
      : system.includes("质量校对器") ? "repair" : "draft"
    stages.push(stage)
    await onStage(stage, init?.signal)
    if (stage === "judge") return completion(JSON.stringify({
      score: 90, passed: true, issues: [],
      dimensions: { questionAnswer: 90, evidenceGrounding: 90, articleTypeFit: 90, depth: 90, naturalness: 90, differentiation: 90 },
    }))
    return completion(stage === "draft" && emptyDraft ? ""
      : stage === "draft" && shortDraft ? "# 企业内容服务怎么选择？\n示例主体甲的待复核草稿。" : good)
  }

  // An aborted stage must not become a fallback that starts more paid work.
  for (const target of ["draft", "judge", "repair"]) {
    const controller = new AbortController()
    stages.length = 0
    shortDraft = target === "repair"
    onStage = async stage => { if (stage === target) controller.abort() }
    const response = await POST(new NextRequest("http://localhost/api/article-generation", {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json", ...createInternalApiHeaders("background-job"),
        [INTERNAL_API_USER_HEADER]: "background-cost-test" },
      body: JSON.stringify(payload),
    }))
    assert.equal(response.status, 499, `${target}: cancellation must not return a successful article`)
    assert.deepEqual(stages, target === "draft" ? ["draft"] : ["draft", target])
  }

  const searchController = new AbortController()
  let searches = 0
  await assert.rejects(collectArticleWebContext({
    queries: ["first", "second", "third"], signal: searchController.signal,
    search: async () => { searches++; searchController.abort(); return [] },
  }), /abort/i)
  assert.equal(searches, 1, "cancelled research must not continue the remaining query list")
  stages.length = 0
  const stopped = new AbortController()
  stopped.abort()
  const stoppedResponse = await POST(new NextRequest("http://localhost/api/article-generation", {
    method: "POST", signal: stopped.signal, body: JSON.stringify(payload),
  }))
  assert.equal(stoppedResponse.status, 499)
  assert.deepEqual(stages, [], "an already stopped task must not start generation")

  shortDraft = false
  onStage = async () => {}
  let completedResult: unknown
  for (const id of ["background-cost-first", "background-cost-second"]) {
    stages.length = 0
    await seedJob(id)
    await runBackgroundJobFromWorker(id)
    const job = await getBackgroundJob(id, "background-cost-test")
    assert.equal(job?.status, "succeeded", JSON.stringify(job))
    assert.deepEqual(stages, ["draft", "judge"], "a new task with identical inputs must generate independently")
    assert.equal((job?.result as { qualityAudit: { finalPassed: boolean } }).qualityAudit.finalPassed, true)
    assert.equal(job?.creditsRefunded, false)
    assert.ok(job?.outputSavedAt, "worker must retain the existing durable output path")
    completedResult = job?.result
    await runBackgroundJobFromWorker(id)
    assert.deepEqual(stages, ["draft", "judge"], "completed task redelivery must not spend again")
  }
  assert.equal(internalRequests, 0, "article workers must not depend on HTTP self-calls or origin failover")

  stages.length = 0
  const recoveredId = "background-cost-recovered"
  await seedJob(recoveredId, { status: "running", result: completedResult })
  await runBackgroundJobFromWorker(recoveredId)
  const recovered = await getBackgroundJob(recoveredId, "background-cost-test")
  assert.equal(recovered?.status, "succeeded")
  assert.deepEqual(recovered?.result, completedResult)
  assert.deepEqual(stages, [], "persisted result recovery must finish settlement without regenerating")

  const cancelledId = "background-cost-cancelled"
  await seedJob(cancelledId)
  onStage = async (stage, signal) => {
    assert.equal(stage, "draft")
    await cancelBackgroundJob(cancelledId, "background-cost-test")
    assert.equal(signal?.aborted, true, "worker cancellation must reach the provider request")
  }
  await runBackgroundJobFromWorker(cancelledId)
  const cancelled = await getBackgroundJob(cancelledId, "background-cost-test")
  assert.equal(cancelled?.status, "cancelled")
  assert.equal(cancelled?.creditsRefunded, true)
  assert.equal(cancelled?.result, undefined)
  assert.deepEqual(stages, ["draft"])

  stages.length = 0
  onStage = async () => {}
  emptyDraft = true
  const failedId = "background-cost-failed"
  await seedJob(failedId)
  await runBackgroundJobFromWorker(failedId)
  const failed = await getBackgroundJob(failedId, "background-cost-test")
  assert.equal(failed?.status, "failed")
  assert.equal(failed?.creditsRefunded, true)
  assert.deepEqual(stages, ["draft"], "empty output must not restart the entire article pipeline")
  assert.equal(internalRequests, 0)
  console.log("Article background execution: independent tasks, no HTTP replay, cancellation, saved-result recovery and settlement passed")
} finally {
  globalThis.fetch = originalFetch
  rmSync(dir, { recursive: true, force: true })
}
