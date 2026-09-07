import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const dir = mkdtempSync(join(tmpdir(), "geo-probe-cost-"))
delete process.env.DATABASE_URL
delete process.env.REDIS_URL
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = join(dir, "kv.json")
process.env.AI_CONFIG_ENCRYPTION_KEY = "test-probe-cost-key"
const { saveAiCredential, updateAiCredentialHealth, setAiCredentialEnabled, getAiCredentialRuntime } =
  await import("../src/lib/ai-credential-store")
const { buildAiCredentialRouteIdentity, recordAiCredentialRouteFailure, listAiCredentialRouteHealth } =
  await import("../src/lib/ai-credential-route-health")
const { classifyAiCredentialFailure } = await import("../src/lib/ai-credential-failure-classifier")
const { runAiCredentialHealthSweep } = await import("../src/lib/ai-credential-health-monitor")
const { verifyAiCredentialWeb } = await import("../src/lib/ai-credential-web-verification")
const originalFetch = globalThis.fetch
const originalNow = Date.now
const usageGlobals = globalThis as unknown as {
  __geoAiUsagePool?: { query: (sql: string, values: unknown[]) => Promise<{ rows: unknown[] }> }
  __geoAiUsageSchemaPromise?: Promise<unknown>
}
const originalUsagePool = usageGlobals.__geoAiUsagePool
const originalUsageSchema = usageGlobals.__geoAiUsageSchemaPromise
const usageEvents: unknown[][] = []
usageGlobals.__geoAiUsageSchemaPromise = Promise.resolve()
usageGlobals.__geoAiUsagePool = { query: async (sql, values) => {
  assert.match(sql, /INSERT INTO geo_ai_usage_v1/)
  usageEvents.push(values)
  delete process.env.DATABASE_URL
  return { rows: [] }
} }
function meteredResponse(body: unknown, status = 200) {
  // Enable only the fake usage sink while consuming this upstream response.
  process.env.DATABASE_URL = "postgres://unused-test-sink"
  return Response.json(body, { status })
}
let now = originalNow()
Date.now = () => now

try {
  assert.equal(classifyAiCredentialFailure(new Error(
    "HTTP 200 [account_overdue]: Access denied due to overdue account",
  )).failureClass, "billing")
  const saved = await saveAiCredential({
    vendor: "doubao", name: "Probe cost fixture", accountLabel: "Probe cost fixture",
    quotaGroup: "probe-cost", apiKey: "test-probe-key", enabled: false,
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3", chatPath: "/chat/completions",
    allowedModels: ["doubao-test-web", "doubao-test-chat"],
    allowedModules: ["penetration", "article"],
    declaredCapabilities: ["chat", "json", "native_web", "auditable_sources"],
  }, "probe-test")
  await updateAiCredentialHealth(saved.id, {
    status: "healthy", verifiedCapabilities: ["chat", "json", "native_web", "auditable_sources"],
    verifiedWebModels: ["doubao-test-web"], consecutiveFailures: 0,
  })
  await setAiCredentialEnabled(saved.id, true, "probe-test")
  const credential = await getAiCredentialRuntime(saved.id)
  const web = buildAiCredentialRouteIdentity(credential, {
    module: "penetration", model: "doubao-test-web", requiredCapabilities: ["native_web", "auditable_sources"],
  })
  const chat = buildAiCredentialRouteIdentity(credential, {
    module: "article", model: "doubao-test-chat", requiredCapabilities: ["chat"],
  })
  for (const route of [web, chat]) {
    for (let i = 0; i < 3; i++) {
      await recordAiCredentialRouteFailure(route, classifyAiCredentialFailure(new Error("HTTP 503")))
    }
    now += 10
  }
  now += 3 * 60_000
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return meteredResponse({ error: { code: "AccountOverdueError", message: "overdue balance" } }, 403)
  }
  const failed = await runAiCredentialHealthSweep({ limit: 20 })
  assert.equal(calls, 1, "fresh account cooldown must prevent probing stale sibling candidates")
  assert.equal(failed.failed, 1)
  assert.equal(failed.inspected, 1)
  assert.equal(failed.skipped, 1)
  assert.equal((await getAiCredentialRuntime(saved.id)).enabled, true)
  assert.equal((await runAiCredentialHealthSweep()).inspected, 0)
  assert.equal(usageEvents.length, 1)
  assert.equal(usageEvents[0][1], "system-health-monitor")
  assert.equal(usageEvents[0][2], "credential_health_probe_web")
  assert.equal(usageEvents[0][10], false)
  assert.equal(usageEvents[0][13], saved.id)
  assert.equal(usageEvents[0][14], false, "missing usage is unknown, not a measured zero")

  // A manual check can verify a topped-up account without waiting for cooldown.
  globalThis.fetch = async () => {
    calls++
    return meteredResponse({ id: "test-request", usage: {
      input_tokens: 23, output_tokens: 7, total_tokens: 30,
    }, output: [
      { type: "web_search_call", status: "completed" },
      { type: "message", content: [{ type: "output_text", text: "联网测试回答", annotations: [
        { type: "url_citation", title: "测试来源", url: "https://example.com/articles/date" },
      ] }] },
    ] })
  }
  assert.equal((await runAiCredentialHealthSweep({ credentialId: saved.id, force: true, limit: 1 })).recovered, 1)
  assert.equal(usageEvents.length, 2)
  assert.deepEqual(usageEvents[1].slice(6, 9), [23, 7, 30])
  assert.equal(usageEvents[1][10], true)
  assert.equal(usageEvents[1][14], true)
  const recovered = await getAiCredentialRuntime(saved.id)
  assert.equal(recovered.healthStatus, "healthy")
  assert.deepEqual(recovered.allowedModels, credential.allowedModels)
  assert.equal((await listAiCredentialRouteHealth([saved.id])).find(r => r.model === chat.model)?.state, "open",
    "a successful web probe must not certify the separate chat route")

  // Concurrent automatic/manual sweeps share one probe lock per account.
  let entered!: () => void
  let finish!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { finish = resolve })
  globalThis.fetch = async () => {
    calls++
    entered()
    await gate
    return meteredResponse({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })
  }
  const running = runAiCredentialHealthSweep({ limit: 1 })
  await started
  try {
    const competing = await runAiCredentialHealthSweep({ credentialId: saved.id, force: true, limit: 20 })
    assert.equal(competing.inspected, 0)
    assert.ok(competing.skipped > 0)
  } finally { finish() }
  assert.equal((await running).recovered, 1)
  assert.equal(calls, 3)
  assert.equal((await runAiCredentialHealthSweep()).recovered, 1,
    "the manually seeded chat capability still requires its own evidence")
  assert.equal((await runAiCredentialHealthSweep()).inspected, 0)
  assert.equal(usageEvents.length, 4, "skipped and contending probes must not produce phantom usage")
  assert.equal(usageEvents[3][2], "credential_health_probe_chat")
  assert.deepEqual(usageEvents[3].slice(6, 9), [10, 5, 15])
  globalThis.fetch = async () => meteredResponse({
    id: "invalid-evidence", output_text: "有回答，但没有网页证据",
    usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 },
  })
  await assert.rejects(verifyAiCredentialWeb(saved.id, { model: "doubao-test-web" }), /未返回可审计/)
  assert.equal(usageEvents.length, 5)
  assert.equal(usageEvents[4][2], "credential_verify_web")
  assert.equal(usageEvents[4][10], false)
  assert.equal(usageEvents[4][14], true)
  assert.deepEqual(usageEvents[4].slice(6, 9), [40, 10, 50],
    "rejecting unauditable output must not hide consumed tokens")
  console.log("Probe cost controls: stale candidates, credential cooldown, manual recovery and account lock passed")
} finally {
  globalThis.fetch = originalFetch
  Date.now = originalNow
  delete process.env.DATABASE_URL
  usageGlobals.__geoAiUsagePool = originalUsagePool
  usageGlobals.__geoAiUsageSchemaPromise = originalUsageSchema
  rmSync(dir, { recursive: true, force: true })
}
