import assert from "node:assert/strict"

process.env.AI_CONFIG_ENCRYPTION_KEY = "test-deepseek-model-routing-key"
delete process.env.DATABASE_URL

const { shouldFailOverAiCredential, isPermanentAiCredentialFailure } = await import(
  "../src/lib/ai-credential-errors"
)
const { chatDeepSeek } = await import("../src/lib/llm/deepseek")

assert.equal(shouldFailOverAiCredential(new Error("HTTP 400 model not found")), true)
assert.equal(shouldFailOverAiCredential(new Error("HTTP 402 payment required")), true)
assert.equal(shouldFailOverAiCredential(new Error("HTTP 404 endpoint not found")), true)
assert.equal(isPermanentAiCredentialFailure(new Error("HTTP 402 payment required")), true)
assert.equal(isPermanentAiCredentialFailure(new Error("HTTP 404 endpoint not found")), false)

const originalFetch = globalThis.fetch
const requestedModels: string[] = []
try {
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as { model?: string }
    requestedModels.push(String(body.model || ""))
    return new Response(JSON.stringify({
      choices: [{
        finish_reason: "stop",
        message: { role: "assistant", content: '{"ok":true}' },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  const result = await chatDeepSeek({
    system: "只返回 JSON。",
    user: "执行诊断。",
    jsonMode: true,
    mode: "judge",
    allowWebSearch: false,
    runtimeOverride: {
      vendor: "deepseek",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      chatPath: "/chat/completions",
      apiKey: "test-deepseek-key",
      model: "deepseek-v4-flash",
      timeout: 10,
    },
  })

  assert.match(result, /"ok":true/)
  assert.deepEqual(
    requestedModels,
    ["deepseek-v4-flash"],
    "non-search diagnosis and judge calls must preserve the configured relay model",
  )
} finally {
  globalThis.fetch = originalFetch
}

console.log("DeepSeek relay model preservation and 400/402/404 failover classification passed")
