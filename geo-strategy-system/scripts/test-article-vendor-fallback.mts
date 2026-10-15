import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const tempDir = mkdtempSync(join(tmpdir(), "geo-article-vendor-fallback-"))
delete process.env.DATABASE_URL
delete process.env.ARTICLE_FALLBACK_PROVIDERS
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = join(tempDir, "kv.json")
process.env.AI_CONFIG_ENCRYPTION_KEY = "test-article-vendor-fallback-key"

const { saveAiCredential, setAiCredentialEnabled, updateAiCredentialHealth } =
  await import("../src/lib/ai-credential-store")
const { resolveArticleModel } = await import("../src/lib/article-models")
const { runArticleModelChat } = await import("../src/lib/article-model-runtime")

async function account(vendor: "doubao" | "zhipu" | "qwen", baseUrl: string, models: string[], healthy = true) {
  const credential = await saveAiCredential({
    vendor, name: `${vendor} 账号`, accountLabel: `${vendor}-1`, baseUrl, chatPath: "/chat/completions",
    apiKey: `${vendor}-article-key`, enabled: false, allowedModels: models, allowedModules: ["article"],
    declaredCapabilities: ["chat", "long_text"],
  }, "fallback-test")
  await updateAiCredentialHealth(credential.id, healthy
    ? { status: "healthy", verifiedCapabilities: ["chat"] }
    : { status: "unhealthy", verifiedCapabilities: ["chat"], cooldownUntil: new Date(Date.now() + 3_600_000).toISOString(), consecutiveFailures: 9 })
  await setAiCredentialEnabled(credential.id, true, "fallback-test")
}

// Doubao's only account is out of service, as with "豆包 暂无可用账号".
await account("doubao", "https://ark.cn-beijing.volces.com/api/v3", ["doubao-seed-2-0-pro"], false)
const zhipuModel = (await resolveArticleModel("zhipu")).model
const qwenModel = (await resolveArticleModel("qwen")).model
await account("zhipu", "https://open.bigmodel.cn/api/paas/v4", [zhipuModel])
await account("qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1", [qwenModel])

const calls: Array<{ host: string; body: Record<string, unknown> }> = []
let zhipuBroke = false
const originalFetch = globalThis.fetch
try {
  globalThis.fetch = async (input, init) => {
    const host = new URL(String(input instanceof Request ? input.url : input)).hostname
    const body = JSON.parse(String(init?.body || "{}"))
    calls.push({ host, body })
    if (host.includes("bigmodel") && zhipuBroke) {
      return Response.json({ error: { code: "1113", message: "余额不足或无可用资源包,请充值。" } }, { status: 429 })
    }
    const writer = host.includes("bigmodel") ? "智谱" : host.includes("dashscope") ? "千问" : "豆包"
    return Response.json({
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: `${writer}写的文章` } }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    })
  }

  const primary = await resolveArticleModel("doubao", "doubao-seed-2-0-pro")
  const request = { system: "你是文章编辑。", user: "写一篇文章。", label: "跨厂商回退", maxTokens: 500, totalTimeoutMs: 60_000 }

  const byZhipu = await runArticleModelChat(primary, request)
  assert.equal(byZhipu.content, "智谱写的文章", "Zhipu takes over first when Doubao has no account")
  assert.equal(byZhipu.usedFallback, true)
  assert.equal(calls.some(call => call.host.includes("volces")), false, "the unavailable Doubao account is not called")
  assert.deepEqual(calls.find(call => call.host.includes("bigmodel"))?.body.thinking, { type: "disabled" })

  calls.length = 0
  zhipuBroke = true
  const byQwen = await runArticleModelChat(primary, request)
  assert.equal(byQwen.content, "千问写的文章", "Qwen takes over when Zhipu is out of balance")
  // Zhipu is tried (the request layer retries a 429 once), then Qwen writes.
  assert.equal(calls[0]?.host.includes("bigmodel"), true)
  assert.equal(calls.at(-1)?.host.includes("dashscope"), true)

  console.log("Article generation falls back to Zhipu, then Qwen, when its vendor cannot write")
} finally {
  globalThis.fetch = originalFetch
  rmSync(tempDir, { recursive: true, force: true })
}
