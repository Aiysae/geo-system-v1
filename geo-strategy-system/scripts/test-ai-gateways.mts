import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const tempDir = mkdtempSync(join(tmpdir(), "geo-ai-gateways-"))
const kvFile = join(tempDir, "kv.json")
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = kvFile
process.env.AUTH_SECRET = "test-only-auth-secret-with-enough-entropy"

const {
  inferAiGatewayModelFamily,
  getAiGatewayPreset,
  getAiGatewayProviderRuntime,
  listAiGatewayProvidersPublic,
  parseGatewayProviderKey,
  saveAiGatewayProvider,
  setAiGatewayModelEnabled,
  syncAiGatewayModels,
} = await import("../src/lib/ai-gateways")
const { resolveArticleModel } = await import("../src/lib/article-models")
const { runArticleModelChat } = await import("../src/lib/article-model-runtime")
const { getAiProviderRuntimeSetting, saveAiProviderSetting } = await import("../src/lib/ai-settings")

assert.equal(inferAiGatewayModelFamily("gpt-5.2"), "gpt")
assert.equal(inferAiGatewayModelFamily("claude-sonnet-4-6"), "claude")
assert.equal(inferAiGatewayModelFamily("gemini-3-pro"), "gemini")
assert.equal(getAiGatewayPreset("openai").protocol, "openai_responses")
assert.equal(getAiGatewayPreset("openai").defaultModel, "gpt-5.6-terra")
assert.equal(getAiGatewayPreset("anthropic").defaultModel, "claude-sonnet-5")
assert.equal(getAiGatewayPreset("gemini").defaultModel, "gemini-3.6-flash")

const secret = "test-bai-super-secret-key"
const created = await saveAiGatewayProvider({
  name: "B.AI 测试",
  preset: "bai",
  baseUrl: "https://api.b.ai",
  chatPath: "/v1/chat/completions",
  modelsPath: "/v1/models",
  authType: "bearer",
  apiKey: secret,
  enabled: true,
  priority: 1,
  timeout: 600,
  maxConcurrency: 2,
  manualModels: ["gpt-manual"],
}, "admin-test")

assert.ok(parseGatewayProviderKey(created.providerKey))
assert.equal(created.hasApiKey, true)
assert.equal(created.apiKeyPreview, "••••-key")
assert.equal(created.models[0]?.id, "gpt-manual")

const serialized = readFileSync(kvFile, "utf8")
assert.equal(serialized.includes(secret), false, "API Key must never be stored as plaintext")
assert.match(serialized, /v1:/)

const runtime = await getAiGatewayProviderRuntime(created.id)
assert.equal(runtime.apiKey, secret)
assert.equal(runtime.providerKey, created.providerKey)

const originalFetch = globalThis.fetch
globalThis.fetch = (async () => new Response(JSON.stringify({
  data: [
    { id: "gpt-5.2", supported_endpoint_types: ["chat.completions"] },
    { id: "claude-sonnet-4-6", supported_endpoint_types: ["chat.completions"] },
    { id: "gemini-3-pro", supported_endpoint_types: ["chat.completions"] },
    { id: "embedding-only", supported_endpoint_types: ["embeddings"] },
    { id: "gpt-5.2", supported_endpoint_types: ["chat.completions"] },
  ],
}), { status: 200 })) as typeof fetch

const synced = await syncAiGatewayModels(created.id, "admin-test")
assert.equal(synced.healthStatus, "healthy")
assert.deepEqual(
  new Set(synced.models.map(model => model.id)),
  new Set(["gpt-5.2", "claude-sonnet-4-6", "gemini-3-pro", "gpt-manual"]),
)

await setAiGatewayModelEnabled(created.id, "gpt-5.2", false, "admin-test")
await assert.rejects(
  () => resolveArticleModel(created.providerKey, "gpt-5.2"),
  /未开放/,
)
const resolved = await resolveArticleModel(created.providerKey, "claude-sonnet-4-6")
assert.equal(resolved.model, "claude-sonnet-4-6")
assert.equal(resolved.apiKey, secret)

const backup = await saveAiGatewayProvider({
  name: "备用中转站",
  preset: "openai-compatible",
  baseUrl: "https://relay.example.com",
  chatPath: "/v1/chat/completions",
  modelsPath: "/v1/models",
  authType: "bearer",
  apiKey: "test-backup-key",
  enabled: true,
  priority: 2,
  timeout: 60,
  maxConcurrency: 1,
  manualModels: ["claude-sonnet-4-6"],
}, "admin-test")

globalThis.fetch = (async input => {
  const url = String(input)
  if (url.startsWith("https://api.b.ai")) throw new TypeError("network unavailable")
  return new Response(JSON.stringify({
    id: "chatcmpl-test",
    choices: [{ message: { role: "assistant", content: "备用线路回答" }, finish_reason: "stop" }],
  }), { status: 200 })
}) as typeof fetch

const fallback = await runArticleModelChat(resolved, {
  system: "测试系统提示",
  user: "测试问题",
  label: "测试",
})
assert.equal(fallback.content, "备用线路回答")
assert.equal(fallback.usedFallback, true)
assert.equal(fallback.model.providerKey, backup.providerKey)

globalThis.fetch = (async () => new Response(JSON.stringify({
  data: [{ id: "gpt-5.2", supported_endpoint_types: ["chat.completions"] }],
}), { status: 200 })) as typeof fetch
const afterRemoval = await syncAiGatewayModels(created.id, "admin-test")
assert.equal(afterRemoval.models.find(model => model.id === "claude-sonnet-4-6")?.status, "removed")
assert.equal(afterRemoval.models.find(model => model.id === "claude-sonnet-4-6")?.enabled, false)
assert.equal(afterRemoval.lastSyncSummary?.removed, 2)

const officialFirst = await saveAiGatewayProvider({
  name: "OpenAI 官方",
  preset: "openai",
  apiKey: "openai-key-one",
  primaryModel: "gpt-5.6-terra",
}, "admin-test")
const officialUpdated = await saveAiGatewayProvider({
  name: "OpenAI 官方更新",
  preset: "openai",
  apiKey: "openai-key-two",
  primaryModel: "gpt-5.6-terra",
}, "admin-test")
assert.equal(officialUpdated.id, officialFirst.id, "each official vendor must have one connection")

const legacySecret = "test-legacy-provider-secret"
await saveAiProviderSetting("qwen", {
  apiKey: legacySecret,
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
  chatPath: "/v1/chat/completions",
  model: "qwen-plus",
  timeout: 300,
  extra: { enableSearch: true },
}, "admin-test")
assert.equal((await getAiProviderRuntimeSetting("qwen")).apiKey, legacySecret)
assert.equal(readFileSync(kvFile, "utf8").includes(legacySecret), false, "legacy AI settings must be encrypted")

await assert.rejects(
  () => saveAiGatewayProvider({
    name: "Unsafe",
    preset: "openai-compatible",
    baseUrl: "https://127.0.0.1",
    chatPath: "/v1/chat/completions",
    modelsPath: "/v1/models",
    authType: "bearer",
    apiKey: "test-unsafe-key",
  }, "admin-test"),
  /localhost 或内网地址/,
)

globalThis.fetch = originalFetch
assert.equal((await listAiGatewayProvidersPublic()).length, 3)
rmSync(tempDir, { recursive: true, force: true })

console.log("AI gateway registry, encryption, sync, and resolver tests passed")
