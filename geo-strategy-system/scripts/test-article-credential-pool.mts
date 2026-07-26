import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ResolvedArticleModel } from "../src/lib/article-models"

const tempDir = mkdtempSync(join(tmpdir(), "geo-article-credential-pool-"))
delete process.env.DATABASE_URL
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = join(tempDir, "kv.json")
process.env.AI_CONFIG_ENCRYPTION_KEY = "test-article-credential-pool-key"

const {
  saveAiCredential,
  setAiCredentialEnabled,
  updateAiCredentialHealth,
} = await import("../src/lib/ai-credential-store")
const { runArticleModelChat } = await import("../src/lib/article-model-runtime")

const credential = await saveAiCredential({
  vendor: "deepseek",
  name: "DeepSeek V4 池账号",
  accountLabel: "1号账号",
  quotaGroup: "deepseek-account-1",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  chatPath: "/chat/completions",
  apiKey: "test-deepseek-v4-key",
  enabled: false,
  allowedModels: ["deepseek-v4-flash"],
  allowedModules: ["article"],
  declaredCapabilities: ["chat", "long_text"],
}, "article-pool-test")
await updateAiCredentialHealth(credential.id, {
  status: "healthy",
  verifiedCapabilities: ["chat"],
})
await setAiCredentialEnabled(credential.id, true, "article-pool-test")

const primary: ResolvedArticleModel = {
  providerKey: "deepseek",
  label: "DeepSeek",
  baseUrl: "https://api.deepseek.com",
  chatPath: "/chat/completions",
  apiKey: "",
  model: "deepseek-chat",
  timeout: 30,
  authType: "bearer",
  protocol: "openai_chat",
}

const originalFetch = globalThis.fetch
try {
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as { model?: string }
    assert.equal(body.model, "deepseek-v4-flash")
    return new Response(JSON.stringify({
      choices: [{
        finish_reason: "stop",
        message: { role: "assistant", content: "V4 账号池文章" },
      }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  const result = await runArticleModelChat(primary, {
    system: "你是文章编辑。",
    user: "生成一篇测试文章。",
    label: "文章池回归",
    maxTokens: 1_000,
  })
  assert.equal(result.content, "V4 账号池文章")
  assert.equal(result.usedFallback, false)
} finally {
  globalThis.fetch = originalFetch
  rmSync(tempDir, { recursive: true, force: true })
}

console.log("Article generation resolves the actual model exposed by a pooled credential")
