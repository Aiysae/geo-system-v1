import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const tempDir = mkdtempSync(join(tmpdir(), "geo-ai-credential-pool-"))
const kvFile = join(tempDir, "kv.json")
delete process.env.DATABASE_URL
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = kvFile
process.env.AI_CONFIG_ENCRYPTION_KEY = "test-ai-credential-encryption-key"

const {
  getAiCredentialRuntime,
  listAiCredentialsPublic,
  saveAiCredential,
  setAiCredentialEnabled,
  updateAiCredentialHealth,
} = await import("../src/lib/ai-credential-store")
const {
  acquireAiCredential,
  getAiCredentialPoolCapacity,
  recordAiCredentialFailure,
  recordAiCredentialSuccess,
  resolveAiCredentialModel,
} = await import("../src/lib/ai-credential-router")

const firstSecret = "sk-test-account-one-secret"
const secondSecret = "sk-test-account-two-secret"

const first = await saveAiCredential({
  vendor: "qwen",
  name: "千问 1 号",
  accountLabel: "1号账号",
  quotaGroup: "qwen-account-1",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
  chatPath: "/v1/chat/completions",
  apiKey: firstSecret,
  enabled: false,
  priority: 1,
  maxConcurrency: 1,
  quotaGroupMaxConcurrency: 1,
  allowedModels: ["qwen-plus"],
  allowedModules: ["article", "question"],
  declaredCapabilities: ["chat", "json"],
}, "admin-test")

const second = await saveAiCredential({
  vendor: "qwen",
  name: "千问 2 号",
  accountLabel: "2号账号",
  quotaGroup: "qwen-account-1",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
  chatPath: "/v1/chat/completions",
  apiKey: secondSecret,
  enabled: false,
  priority: 1,
  maxConcurrency: 1,
  quotaGroupMaxConcurrency: 1,
  allowedModels: ["qwen-plus"],
  allowedModules: ["article", "question"],
  declaredCapabilities: ["chat", "json", "native_web", "auditable_sources"],
}, "admin-test")

const serialized = readFileSync(kvFile, "utf8")
assert.equal(serialized.includes(firstSecret), false, "account 1 key must be encrypted")
assert.equal(serialized.includes(secondSecret), false, "account 2 key must be encrypted")
assert.equal((first as unknown as { apiKey?: string }).apiKey, undefined)
assert.equal((second as unknown as { apiKey?: string }).apiKey, undefined)
assert.equal((await getAiCredentialRuntime(first.id)).apiKey, firstSecret)

await assert.rejects(
  () => saveAiCredential({
    vendor: "qwen",
    name: "重复 Key",
    accountLabel: "重复账号",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
    apiKey: firstSecret,
  }, "admin-test"),
  /已经存在/,
)

await updateAiCredentialHealth(first.id, {
  status: "healthy",
  verifiedCapabilities: ["chat", "json"],
  latencyMs: 120,
})
await updateAiCredentialHealth(second.id, {
  status: "healthy",
  verifiedCapabilities: ["chat", "json", "native_web", "auditable_sources"],
  latencyMs: 140,
})
await setAiCredentialEnabled(first.id, true, "admin-test")
await setAiCredentialEnabled(second.id, true, "admin-test")

const publicItems = await listAiCredentialsPublic()
assert.equal(publicItems.length, 2)
assert.equal(publicItems.every(item => !(item as unknown as { apiKey?: string }).apiKey), true)

const secondRuntime = await getAiCredentialRuntime(second.id)
assert.equal(resolveAiCredentialModel(secondRuntime, "qwen-stale", ["chat"]), "qwen-plus")
assert.equal(resolveAiCredentialModel(
  { allowedModels: ["qwen-plus", "qwen3-vl-plus"] },
  "qwen-stale",
  ["vision"],
), "qwen3-vl-plus")

const articleCapacity = await getAiCredentialPoolCapacity({
  vendor: "qwen",
  module: "article",
  model: "qwen-plus",
  requiredCapabilities: ["chat"],
})
assert.deepEqual(articleCapacity, {
  candidateCount: 2,
  maxConcurrency: 1,
  quotaGroupCount: 1,
})

const firstLease = await acquireAiCredential({
  vendor: "qwen",
  module: "article",
  model: "qwen-plus",
  requiredCapabilities: ["chat"],
  waitTimeoutMs: 0,
})
await assert.rejects(
  () => acquireAiCredential({
    vendor: "qwen",
    module: "article",
    model: "qwen-plus",
    requiredCapabilities: ["chat"],
    waitTimeoutMs: 0,
  }),
  /任务较多/,
  "credentials in one quota group must share their group concurrency limit",
)
await firstLease.release()

const webLease = await acquireAiCredential({
  vendor: "qwen",
  module: "question",
  model: "qwen-plus",
  requiredCapabilities: ["chat", "native_web"],
  waitTimeoutMs: 0,
})
assert.equal(webLease.credential.id, second.id)
await recordAiCredentialSuccess(webLease.credential.id, 88)
await webLease.release()

const strictWebLease = await acquireAiCredential({
  vendor: "qwen",
  module: "penetration",
  model: "qwen-plus",
  requiredCapabilities: ["native_web", "auditable_sources"],
  waitTimeoutMs: 0,
})
assert.equal(strictWebLease.credential.id, second.id)
await strictWebLease.release()

const runtimeAfterSuccess = await getAiCredentialRuntime(second.id)
assert.equal(runtimeAfterSuccess.healthStatus, "healthy")
assert.equal(runtimeAfterSuccess.lastLatencyMs, 88)

await recordAiCredentialFailure(runtimeAfterSuccess, new Error("HTTP 401 invalid key"))
const runtimeAfterFailure = await getAiCredentialRuntime(second.id)
assert.equal(runtimeAfterFailure.healthStatus, "unhealthy")
assert.ok(runtimeAfterFailure.cooldownUntil)

rmSync(tempDir, { recursive: true, force: true })
console.log("AI multi-account credential storage, encryption, routing and shared quota gates passed")
