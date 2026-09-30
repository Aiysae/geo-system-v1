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

const { articleCheckpointContext } = await import("../src/lib/article-checkpoint")
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

  // A worker restart after the draft checkpoint must not pay for another draft.
  for (const repaired of [false, true]) {
    const interruptedId = `background-checkpoint-${repaired}`
    await seedJob(interruptedId)
    shortDraft = repaired
    stages.length = 0
    let savedCheckpoint: unknown
    onStage = async stage => {
      if (stage !== "judge") return
      const stored = await kv.get<{ articleCheckpoint?: { draft: string; repairedDraft?: string } }>(
        `geo:background-jobs:${interruptedId}`,
      )
      savedCheckpoint = stored?.articleCheckpoint
      assert.ok(stored?.articleCheckpoint?.draft)
      assert.equal(Boolean(stored?.articleCheckpoint?.repairedDraft), repaired)
      await cancelBackgroundJob(interruptedId, "background-cost-test")
    }
    await runBackgroundJobFromWorker(interruptedId)
    const interrupted = await getBackgroundJob(interruptedId, "background-cost-test")
    assert.equal(interrupted?.status, "cancelled")
    assert.ok(interrupted?.partialArticle)
    assert.equal("articleCheckpoint" in (interrupted || {}), false, "private checkpoint must not leak")
    assert.equal(await getBackgroundJob(interruptedId, "another-user"), null)
    const restartId = `${interruptedId}-restart`
    await seedJob(restartId, { status: "running", articleCheckpoint: savedCheckpoint })
    stages.length = 0
    onStage = async () => {}
    await runBackgroundJobFromWorker(restartId)
    assert.equal((await getBackgroundJob(restartId, "background-cost-test"))?.status, "succeeded")
    assert.deepEqual(stages, ["judge"], "restart must not regenerate or repeat a completed repair")
  }
  shortDraft = false
  stages.length = 0

  const saveFailure = await articleCheckpointContext.run({
    save: async () => { throw new Error("storage unavailable") },
  }, () => POST(new NextRequest("http://localhost/api/article-generation", {
    method: "POST", headers: { "Content-Type": "application/json", ...createInternalApiHeaders("background-job"),
      [INTERNAL_API_USER_HEADER]: "background-cost-test" }, body: JSON.stringify(payload),
  })))
  assert.equal(saveFailure.status, 500)
  assert.deepEqual(stages, ["draft"], "checkpoint failure must stop before more paid stages")
  stages.length = 0

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
  // A cooling model must keep queued tasks alive without another paid request.
  emptyDraft = false
  const { saveAiCredential, updateAiCredentialHealth, setAiCredentialEnabled, getAiCredentialRuntime } =
    await import("../src/lib/ai-credential-store")
  const { recordAiCredentialFailure, recordAiCredentialSuccess } = await import("../src/lib/ai-credential-router")
  const account = await saveAiCredential({
    vendor: "doubao", name: "wait-test", accountLabel: "wait-test", apiKey: "wait-test-secret",
    baseUrl: "https://writer.invalid", chatPath: "/chat/completions", enabled: false,
    allowedModels: ["doubao-test-writer"], allowedModules: ["article"], declaredCapabilities: ["chat"],
  }, "test")
  await updateAiCredentialHealth(account.id, { status: "healthy", verifiedCapabilities: ["chat"] })
  await setAiCredentialEnabled(account.id, true, "test")
  const accountRuntime = await getAiCredentialRuntime(account.id)
  const routeContext = { module: "article" as const, model: "doubao-test-writer", requiredCapabilities: ["chat" as const] }
  for (let i = 0; i < 3; i++) await recordAiCredentialFailure(accountRuntime, new Error("upstream timed out"), routeContext)
  stages.length = 0
  await kv.set("user_credits:background-cost-test", 92)
  const paidReservation = { userId: "background-cost-test", amount: 8, balanceAfterReserve: 92 }
  await seedJob("cooling", { reservation: paidReservation, creditCost: 8 })
  const waiting = await runBackgroundJobFromWorker("cooling")
  assert.equal(waiting.requeue, true, "temporary outage must defer rather than fail every queued article")
  assert.ok((waiting.delayMs || 0) >= 1000)
  const cooling = await getBackgroundJob("cooling", "background-cost-test")
  assert.equal(cooling?.status, "queued")
  assert.notEqual(cooling?.creditsRefunded, true)
  assert.deepEqual(stages, [])
  await runBackgroundJobFromWorker("cooling")
  assert.deepEqual(stages, [], "early delivery must honor the durable delay")
  assert.equal(await kv.get("user_credits:background-cost-test"), 92, "waiting must neither reserve again nor refund")
  await seedJob("cooling-cancel", { reservation: paidReservation, creditCost: 8 })
  await runBackgroundJobFromWorker("cooling-cancel")
  await cancelBackgroundJob("cooling-cancel", "background-cost-test")
  assert.deepEqual(await runBackgroundJobFromWorker("cooling-cancel"), {})
  assert.equal((await getBackgroundJob("cooling-cancel", "background-cost-test"))?.creditsRefunded, true)
  assert.equal(await kv.get("user_credits:background-cost-test"), 100, "cancelled waiting task refunds exactly once")
  await cancelBackgroundJob("cooling-cancel", "background-cost-test")
  assert.equal(await kv.get("user_credits:background-cost-test"), 100)
  await kv.set("user_credits:background-cost-test", 92)
  await seedJob("cooling-expired", { reservation: paidReservation, creditCost: 8, articleWaitStartedAt: new Date(Date.now() - 16 * 60_000).toISOString() })
  await runBackgroundJobFromWorker("cooling-expired")
  assert.equal((await getBackgroundJob("cooling-expired", "background-cost-test"))?.status, "failed")
  assert.equal((await getBackgroundJob("cooling-expired", "background-cost-test"))?.creditsRefunded, true)
  assert.equal(await kv.get("user_credits:background-cost-test"), 100, "expired wait refunds once")
  await kv.set("user_credits:background-cost-test", 92)
  await recordAiCredentialSuccess(accountRuntime, 10, routeContext)
  const storedCooling = await kv.get<Record<string, unknown>>("geo:background-jobs:cooling")
  await kv.set("geo:background-jobs:cooling", { ...storedCooling, articleRetryAt: undefined })
  await runBackgroundJobFromWorker("cooling")
  assert.equal((await getBackgroundJob("cooling", "background-cost-test"))?.status, "succeeded")
  assert.deepEqual(stages, ["draft", "judge"])
  await runBackgroundJobFromWorker("cooling")
  assert.deepEqual(stages, ["draft", "judge"], "recovery must settle only once and not regenerate")
  assert.equal(await kv.get("user_credits:background-cost-test"), 92, "successful recovery keeps the original charge only")
  await recordAiCredentialFailure(accountRuntime, new Error("HTTP 403 AccountOverdueError"), routeContext)
  stages.length = 0
  await seedJob("billing-blocked")
  assert.deepEqual(await runBackgroundJobFromWorker("billing-blocked"), {})
  const billingBlocked = await getBackgroundJob("billing-blocked", "background-cost-test")
  assert.equal(billingBlocked?.status, "failed", "billing is actionable, not a temporary queue delay")
  assert.match(billingBlocked?.error || "", /欠费|余额/)
  assert.deepEqual(stages, [])
  // Recovery after the draft must only resume the unavailable judge stage.
  await recordAiCredentialSuccess(accountRuntime, 10, { ...routeContext, isProbe: true })
  const judgeAccount = await saveAiCredential({
    vendor: "qwen", name: "judge-wait", accountLabel: "judge-wait", apiKey: "judge-wait-secret",
    baseUrl: "https://judge.invalid", chatPath: "/chat/completions", enabled: false,
    allowedModels: ["qwen-plus"], allowedModules: ["article"], declaredCapabilities: ["chat"],
  }, "test")
  await updateAiCredentialHealth(judgeAccount.id, { status: "healthy", verifiedCapabilities: ["chat"] })
  await setAiCredentialEnabled(judgeAccount.id, true, "test")
  const judgeRuntime = await getAiCredentialRuntime(judgeAccount.id)
  const judgeContext = { ...routeContext, model: "qwen-plus" }
  for (let i = 0; i < 3; i++) await recordAiCredentialFailure(judgeRuntime, new Error("HTTP 503 upstream unavailable"), judgeContext)
  stages.length = 0
  await seedJob("judge-wait")
  assert.equal((await runBackgroundJobFromWorker("judge-wait")).requeue, true)
  assert.deepEqual(stages, ["draft"])
  assert.ok((await getBackgroundJob("judge-wait", "background-cost-test"))?.partialArticle)
  await recordAiCredentialSuccess(judgeRuntime, 10, judgeContext)
  const judgeWaiting = await kv.get<Record<string, unknown>>("geo:background-jobs:judge-wait")
  await kv.set("geo:background-jobs:judge-wait", { ...judgeWaiting, articleRetryAt: undefined })
  await runBackgroundJobFromWorker("judge-wait")
  assert.deepEqual(stages, ["draft", "judge"], "judge recovery must reuse the saved draft")
  assert.equal((await getBackgroundJob("judge-wait", "background-cost-test"))?.status, "succeeded")
  const { prepareArticleModelSelection } = await import("../src/lib/article-model-runtime")
  const pinned = await prepareArticleModelSelection("doubao")
  assert.equal(pinned.model, "doubao-test-writer", "new tasks must pin the resolved default")
  assert.deepEqual(Object.keys(pinned).sort(), ["model", "modelProvider"], "selection must not expose credentials")
  await assert.rejects(prepareArticleModelSelection("doubao", "doubao-unopened-model"), /允许型号|权限/)
  const { createBackgroundJob, createBackgroundJobsBatch } = await import("../src/lib/background-jobs")
  const { createArticleBatch } = await import("../src/lib/article-batches/manager")
  const badPayload = { ...payload, model: "doubao-unopened-model" }
  const balanceBeforeInvalid = await kv.get("user_credits:background-cost-test")
  const invalid = await createBackgroundJob({
    kind: "articleGeneration", clientId: "cost-test-client", ownerUserId: "background-cost-test",
    requestId: "invalid-model-single-request", payload: badPayload,
  })
  assert.equal(invalid.ok, false)
  if (!invalid.ok) assert.equal(invalid.response.status, 400)
  const invalidBatch = await createBackgroundJobsBatch({
    kind: "articleGeneration", clientId: "cost-test-client", ownerUserId: "background-cost-test",
    batchId: "invalid-model-batch", items: [1, 2].map(i => ({ requestId: `invalid-model-request-${i}`, payload: badPayload })),
  })
  assert.equal(invalidBatch.ok, false)
  if (!invalidBatch.ok) assert.equal(invalidBatch.response.status, 400)
  const invalidParent = await createArticleBatch({
    clientId: "cost-test-client", requestId: "invalid-parent-batch-request", promptTitle: "test",
    count: 2, topicMode: "auto", similarityRetry: false, basePayload: {
      ...badPayload, promptKey: "selectionPitfallGuide", modelProvider: "doubao",
      keywords: "", audience: "", extraRequirements: "", subjectType: "brand", subjectContext: "", website: "",
    },
  }, { actorUserId: "background-cost-test" })
  assert.equal(invalidParent.ok, false)
  if (!invalidParent.ok) assert.equal(invalidParent.response.status, 400)
  assert.equal(await kv.get("user_credits:background-cost-test"), balanceBeforeInvalid, "invalid model must not reserve credits")
  console.log("Article background execution: independent tasks, no HTTP replay, cancellation, saved-result recovery and settlement passed")
} finally {
  globalThis.fetch = originalFetch
  rmSync(dir, { recursive: true, force: true })
}
