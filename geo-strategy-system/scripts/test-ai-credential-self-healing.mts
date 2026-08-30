import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const tempDir = mkdtempSync(join(tmpdir(), "geo-ai-credential-self-healing-"))
delete process.env.DATABASE_URL
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = join(tempDir, "kv.json")
process.env.AI_CONFIG_ENCRYPTION_KEY = "test-ai-self-healing-encryption-key"

const { classifyAiCredentialFailure } = await import(
  "../src/lib/ai-credential-failure-classifier"
)
const {
  getAiCredentialRuntime,
  saveAiCredential,
  setAiCredentialEnabled,
  updateAiCredentialHealth,
} = await import("../src/lib/ai-credential-store")
const {
  getAiCredentialPoolCapacity,
  recordAiCredentialFailure,
  recordAiCredentialSuccess,
} = await import("../src/lib/ai-credential-router")
const { listAiCredentialRouteHealth } = await import(
  "../src/lib/ai-credential-route-health"
)
const { runAiCredentialHealthSweep } = await import(
  "../src/lib/ai-credential-health-monitor"
)

assert.equal(classifyAiCredentialFailure(new DOMException("Aborted", "AbortError")).scope, "ignored")
assert.equal(classifyAiCredentialFailure(new Error("HTTP 429 too many requests")).failureClass, "rate_limited")
assert.equal(classifyAiCredentialFailure(new Error("HTTP 401 invalid api key")).scope, "credential")
assert.equal(classifyAiCredentialFailure(new Error("ToolNotOpen: web search is not activated")).scope, "capability")
assert.equal(classifyAiCredentialFailure(new Error("model not found")).scope, "model")

const saved = await saveAiCredential({
  vendor: "qwen",
  name: "千问自愈测试账号",
  accountLabel: "自愈账号",
  quotaGroup: "qwen-self-healing",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
  chatPath: "/v1/chat/completions",
  apiKey: "sk-test-self-healing",
  enabled: false,
  maxConcurrency: 2,
  quotaGroupMaxConcurrency: 2,
  allowedModels: ["qwen-plus"],
  allowedModules: ["article", "penetration"],
  declaredCapabilities: ["chat", "native_web", "auditable_sources"],
}, "self-healing-test")
await updateAiCredentialHealth(saved.id, {
  status: "healthy",
  verifiedCapabilities: ["chat", "native_web", "auditable_sources"],
  verifiedWebModels: ["qwen-plus"],
  consecutiveFailures: 0,
})
await setAiCredentialEnabled(saved.id, true, "self-healing-test")

let runtime = await getAiCredentialRuntime(saved.id)
await recordAiCredentialFailure(runtime, new Error("AI 请求已停止"), {
  module: "penetration",
  model: "qwen-plus",
  requiredCapabilities: ["native_web", "auditable_sources"],
})
assert.equal((await listAiCredentialRouteHealth([saved.id])).length, 0)

for (let index = 0; index < 3; index += 1) {
  runtime = await getAiCredentialRuntime(saved.id)
  await recordAiCredentialFailure(
    runtime,
    new Error("官方联网未返回可点击的网页信源"),
    {
      module: "penetration",
      model: "qwen-plus",
      requiredCapabilities: ["native_web", "auditable_sources"],
    },
  )
}

let routes = await listAiCredentialRouteHealth([saved.id])
const strictRoute = routes.find(route => route.capabilityProfile === "strict_web")
assert.equal(strictRoute?.state, "open")
assert.equal(strictRoute?.consecutiveFailures, 3)
assert.equal((await getAiCredentialRuntime(saved.id)).healthStatus, "healthy")
assert.equal((await getAiCredentialPoolCapacity({
  vendor: "qwen",
  module: "penetration",
  model: "qwen-plus",
  requiredCapabilities: ["native_web", "auditable_sources"],
})).candidateCount, 0)
assert.equal((await getAiCredentialPoolCapacity({
  vendor: "qwen",
  module: "article",
  model: "qwen-plus",
  requiredCapabilities: ["chat"],
})).candidateCount, 1)

await updateAiCredentialHealth(saved.id, {
  status: "unhealthy",
  verifiedCapabilities: ["chat", "native_web", "auditable_sources"],
  verifiedWebModels: ["qwen-plus"],
  consecutiveFailures: 6,
  cooldownUntil: new Date(Date.now() - 60_000).toISOString(),
})
runtime = await getAiCredentialRuntime(saved.id)
await recordAiCredentialSuccess(runtime, 42, {
  module: "penetration",
  model: "qwen-plus",
  requiredCapabilities: ["native_web", "auditable_sources"],
  isProbe: true,
})
routes = await listAiCredentialRouteHealth([saved.id])
assert.equal(routes.find(route => route.capabilityProfile === "strict_web")?.state, "closed")
assert.equal((await getAiCredentialRuntime(saved.id)).healthStatus, "healthy")
assert.equal((await getAiCredentialPoolCapacity({
  vendor: "qwen",
  module: "penetration",
  model: "qwen-plus",
  requiredCapabilities: ["native_web", "auditable_sources"],
})).candidateCount, 1)

runtime = await getAiCredentialRuntime(saved.id)
await recordAiCredentialFailure(runtime, new Error("HTTP 401 invalid api key"), {
  module: "article",
  model: "qwen-plus",
  requiredCapabilities: ["chat"],
})
assert.equal((await getAiCredentialRuntime(saved.id)).healthStatus, "unhealthy")
assert.equal(
  (await listAiCredentialRouteHealth([saved.id]))
    .find(route => route.capabilityProfile === "chat")?.state,
  "action_required",
)

await updateAiCredentialHealth(saved.id, {
  status: "unhealthy",
  verifiedCapabilities: ["chat", "native_web", "auditable_sources"],
  verifiedWebModels: ["qwen-plus"],
  consecutiveFailures: 6,
  cooldownUntil: new Date(Date.now() - 60_000).toISOString(),
})

const originalFetch = globalThis.fetch
try {
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{
      finish_reason: "stop",
      message: { role: "assistant", content: '{"ok":true}' },
    }],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
  const sweep = await runAiCredentialHealthSweep({
    credentialId: saved.id,
    force: true,
    limit: 1,
  })
  assert.equal(sweep.inspected, 1)
  assert.equal(sweep.recovered, 1)
  assert.equal((await getAiCredentialRuntime(saved.id)).healthStatus, "healthy")

  const jsonCredential = await saveAiCredential({
    vendor: "doubao",
    name: "豆包 JSON 自愈测试账号",
    accountLabel: "JSON 自愈账号",
    quotaGroup: "doubao-json-self-healing",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    chatPath: "/chat/completions",
    apiKey: "test-doubao-json-self-healing",
    enabled: false,
    maxConcurrency: 1,
    quotaGroupMaxConcurrency: 1,
    allowedModels: ["doubao-test-model"],
    allowedModules: ["research"],
    declaredCapabilities: ["chat", "json"],
  }, "self-healing-test")
  await updateAiCredentialHealth(jsonCredential.id, {
    status: "healthy",
    verifiedCapabilities: ["chat", "json"],
    consecutiveFailures: 0,
  })
  await setAiCredentialEnabled(jsonCredential.id, true, "self-healing-test")
  const jsonRuntime = await getAiCredentialRuntime(jsonCredential.id)
  await recordAiCredentialFailure(
    jsonRuntime,
    new Error("HTTP 403 Forbidden [AccountOverdueError]: overdue balance"),
    {
      module: "research",
      model: "doubao-test-model",
      requiredCapabilities: ["json"],
    },
  )
  assert.equal(
    (await listAiCredentialRouteHealth([jsonCredential.id]))
      .find(route => route.capabilityProfile === "json")?.state,
    "action_required",
  )

  const jsonSweep = await runAiCredentialHealthSweep({
    credentialId: jsonCredential.id,
    force: true,
    limit: 10,
  })
  assert.equal(jsonSweep.failed, 0)
  assert.equal(
    (await listAiCredentialRouteHealth([jsonCredential.id]))
      .find(route => route.capabilityProfile === "json")?.state,
    "closed",
  )
} finally {
  globalThis.fetch = originalFetch
  rmSync(tempDir, { recursive: true, force: true })
}

console.log("AI credential routes isolate failures and recover through half-open probes")
