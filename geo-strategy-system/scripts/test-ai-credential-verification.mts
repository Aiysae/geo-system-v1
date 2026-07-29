import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const tempDir = mkdtempSync(join(tmpdir(), "geo-ai-credential-verification-"))
delete process.env.DATABASE_URL
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = join(tempDir, "kv.json")
process.env.AI_CONFIG_ENCRYPTION_KEY = "test-ai-verification-encryption-key"

const {
  getAiCredentialRuntime,
  saveAiCredential,
} = await import("../src/lib/ai-credential-store")
const { knownAiCredentialRepair } = await import(
  "../src/lib/ai-credential-pool-repair"
)
const { verifyAiCredentialChat } = await import(
  "../src/lib/ai-credential-verification"
)
const { verifyAiCredentialWeb } = await import(
  "../src/lib/ai-credential-web-verification"
)

const saved = await saveAiCredential({
  vendor: "doubao",
  name: "豆包 1 号",
  accountLabel: "1号账号",
  quotaGroup: "doubao-account-1",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  chatPath: "/chat/completions",
  apiKey: "test-doubao-key",
  enabled: false,
  allowedModels: ["retired-model", "working-model", "second-working-model"],
  allowedModules: ["article", "question"],
  declaredCapabilities: ["chat", "json"],
}, "verification-test")

const repair = knownAiCredentialRepair(saved)
assert.equal(repair?.allowedModels?.[0], "doubao-seed-2-0-lite-260215")

const kimiRepair = knownAiCredentialRepair({
  ...saved,
  vendor: "kimi",
  baseUrl: "https://api.moonshot.ai/v1",
})
assert.equal(kimiRepair?.baseUrl, "https://api.moonshot.cn/v1")

const originalFetch = globalThis.fetch
const attemptedModels: string[] = []
const attemptedTokenBudgets: number[] = []
try {
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as {
      model?: string
      max_tokens?: number
    }
    attemptedModels.push(String(body.model || ""))
    attemptedTokenBudgets.push(Number(body.max_tokens || 0))
    if (body.model === "doubao-web-working") {
      return new Response(JSON.stringify({
        id: "ark-request-web-working",
        output: [
          { type: "web_search_call", id: "search-1", status: "completed" },
          {
            type: "message",
            role: "assistant",
            content: [{
              type: "output_text",
              text: "今天是测试日期。",
              annotations: [{
                type: "url_citation",
                title: "公开日期资料",
                url: "https://example.com/articles/current-date",
              }],
            }],
          },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (body.model === "doubao-web-failing") {
      return new Response(JSON.stringify({
        error: { code: "ToolNotOpen", message: "web search is not activated" },
      }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    }
    if (body.model === "retired-model") {
      return new Response(JSON.stringify({
        error: { message: "model not found" },
      }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    }
    return new Response(JSON.stringify({
      choices: [{
        finish_reason: "stop",
        message: { role: "assistant", content: '{"ok":true}' },
      }],
      usage: { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13 },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  const result = await verifyAiCredentialChat(saved.id, { allModels: true })
  assert.match(result.message, /2\/3 个型号可用/)
  assert.deepEqual(
    attemptedModels,
    ["retired-model", "working-model", "second-working-model"],
  )
  assert.deepEqual(attemptedTokenBudgets, [64, 64, 64])
  assert.deepEqual(
    result.models.map(item => item.status),
    ["failed", "passed", "passed"],
  )

  const runtime = await getAiCredentialRuntime(saved.id)
  assert.equal(runtime.allowedModels[0], "working-model")
  assert.equal(runtime.healthStatus, "healthy")
  assert.equal(runtime.verifiedCapabilities.includes("chat"), true)
  assert.equal(runtime.verifiedCapabilities.includes("json"), true)

  const savedKimi = await saveAiCredential({
    vendor: "kimi",
    name: "Kimi 2 号",
    accountLabel: "2号账号",
    quotaGroup: "kimi-account-2",
    baseUrl: "https://api.moonshot.cn/v1",
    chatPath: "/chat/completions",
    apiKey: "test-kimi-key",
    enabled: false,
    allowedModels: ["kimi-k2.6"],
    allowedModules: ["article", "question"],
    declaredCapabilities: ["chat", "json"],
  }, "verification-test")
  await verifyAiCredentialChat(savedKimi.id)
  assert.equal(attemptedModels.at(-1), "kimi-k2.6")
  assert.equal(attemptedTokenBudgets.at(-1), 512)

  const savedWeb = await saveAiCredential({
    vendor: "doubao",
    name: "豆包严格联网账号",
    accountLabel: "联网账号",
    quotaGroup: "doubao-web-account",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    chatPath: "/responses",
    apiKey: "test-doubao-web-key",
    enabled: false,
    allowedModels: ["doubao-web-working", "doubao-web-failing"],
    allowedModules: ["penetration"],
    declaredCapabilities: ["chat", "native_web", "auditable_sources"],
  }, "verification-test")
  const webResult = await verifyAiCredentialWeb(savedWeb.id, {
    model: "doubao-web-working",
  })
  assert.match(webResult.message, /doubao-web-working/)
  assert.deepEqual(webResult.credential.verifiedWebModels, ["doubao-web-working"])

  await assert.rejects(
    () => verifyAiCredentialWeb(savedWeb.id, { model: "doubao-web-failing" }),
    /web search is not activated/,
  )
  const webRuntimeAfterFailure = await getAiCredentialRuntime(savedWeb.id)
  assert.deepEqual(webRuntimeAfterFailure.verifiedWebModels, ["doubao-web-working"])
  assert.equal(webRuntimeAfterFailure.healthStatus, "healthy")
} finally {
  globalThis.fetch = originalFetch
  rmSync(tempDir, { recursive: true, force: true })
}

console.log("AI credential verification skips stale models and promotes a working model")
