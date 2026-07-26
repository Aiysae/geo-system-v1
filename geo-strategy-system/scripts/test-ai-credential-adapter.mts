import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const tempDir = mkdtempSync(join(tmpdir(), "geo-ai-adapter-pool-"))
delete process.env.DATABASE_URL
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = join(tempDir, "kv.json")
process.env.AI_CONFIG_ENCRYPTION_KEY = "test-ai-adapter-encryption-key"

const {
  getAiCredentialRuntime,
  saveAiCredential,
  setAiCredentialEnabled,
  updateAiCredentialHealth,
} = await import("../src/lib/ai-credential-store")
const {
  getAdapterCredentialPoolCapacity,
  hasAdapterCredentialPoolCandidate,
  runAdapterCredentialPoolChat,
} = await import("../src/lib/ai-credential-adapter")

async function createCredential(args: {
  label: string
  key: string
  priority: number
  web?: boolean
}) {
  const saved = await saveAiCredential({
    vendor: "qwen",
    name: `千问 ${args.label}`,
    accountLabel: args.label,
    quotaGroup: `qwen-${args.label}`,
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    chatPath: "/chat/completions",
    apiKey: args.key,
    enabled: false,
    priority: args.priority,
    maxConcurrency: 1,
    quotaGroupMaxConcurrency: 1,
    allowedModels: ["qwen-plus"],
    allowedModules: ["difficulty", "penetration"],
    declaredCapabilities: ["chat", "json", "native_web", "auditable_sources"],
  }, "adapter-test")
  await updateAiCredentialHealth(saved.id, {
    status: "healthy",
    verifiedCapabilities: args.web
      ? ["chat", "json", "native_web", "auditable_sources"]
      : ["chat", "json"],
    consecutiveFailures: 0,
  })
  await setAiCredentialEnabled(saved.id, true, "adapter-test")
  return saved
}

const firstSecret = "sk-adapter-first-account"
const secondSecret = "sk-adapter-second-account"
const first = await createCredential({
  label: "1号账号",
  key: firstSecret,
  priority: 1,
})
const second = await createCredential({
  label: "2号账号",
  key: secondSecret,
  priority: 2,
})
await createCredential({
  label: "3号联网账号",
  key: "sk-adapter-web-account",
  priority: 3,
  web: true,
})

const strictArgs = {
  mode: "consumer" as const,
  forceWebSearch: true,
  rawQuestionOnly: true,
  requireWebEvidence: true,
  officialWebOnly: true,
}
assert.equal(
  await hasAdapterCredentialPoolCandidate("qwen", "penetration", strictArgs),
  true,
  "strict penetration must only see a credential with verified web evidence",
)
assert.deepEqual(
  await getAdapterCredentialPoolCapacity("qwen", "penetration", strictArgs),
  {
    vendor: "qwen",
    candidateCount: 1,
    maxConcurrency: 1,
    quotaGroupCount: 1,
    usesFallback: false,
  },
)

const originalFetch = globalThis.fetch
const usedKeys: string[] = []
try {
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers)
    const authorization = headers.get("authorization") || ""
    const key = authorization.replace(/^Bearer\s+/i, "")
    usedKeys.push(key)
    const body = JSON.parse(String(init?.body || "{}")) as { model?: string }
    assert.equal(body.model, "qwen-plus", "account failover must preserve the selected model")
    if (key === firstSecret) {
      return new Response(JSON.stringify({ error: { message: "invalid key" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    }
    return new Response(JSON.stringify({
      id: "chatcmpl-adapter-test",
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

  const result = await runAdapterCredentialPoolChat("qwen", "difficulty", {
    system: "只返回 JSON。",
    user: "返回 ok。",
    jsonMode: true,
    mode: "judge",
    allowWebSearch: false,
    timeoutSec: 10,
  })
  assert.match(result, /"ok":true/)
  assert.deepEqual(usedKeys, [firstSecret, secondSecret])
  assert.equal((await getAiCredentialRuntime(first.id)).healthStatus, "unhealthy")
  assert.equal((await getAiCredentialRuntime(second.id)).healthStatus, "healthy")
} finally {
  globalThis.fetch = originalFetch
  rmSync(tempDir, { recursive: true, force: true })
}

console.log("AI adapter credential failover and strict capability isolation passed")
