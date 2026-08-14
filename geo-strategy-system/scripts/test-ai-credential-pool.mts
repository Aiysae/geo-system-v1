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
const { sanitizeAiUpstreamMessage } = await import("../src/lib/ai-secrets")

const sanitizedUpstreamMessage = sanitizeAiUpstreamMessage(
  '{"api_key":"ak-sensitive-upstream-key","credential":"bce-v3/very-sensitive-search-key"}',
)
assert.equal(sanitizedUpstreamMessage.includes("ak-sensitive-upstream-key"), false)
assert.equal(sanitizedUpstreamMessage.includes("very-sensitive-search-key"), false)

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
  allowedModels: ["qwen-plus", "qwen-max"],
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
  verifiedWebModels: ["qwen-plus"],
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

const unverifiedStrictCapacity = await getAiCredentialPoolCapacity({
  vendor: "qwen",
  module: "penetration",
  model: "qwen-max",
  requiredCapabilities: ["native_web", "auditable_sources"],
})
assert.deepEqual(unverifiedStrictCapacity, {
  candidateCount: 0,
  maxConcurrency: 0,
  quotaGroupCount: 0,
})

const runtimeAfterSuccess = await getAiCredentialRuntime(second.id)
assert.equal(runtimeAfterSuccess.healthStatus, "healthy")
assert.equal(runtimeAfterSuccess.lastLatencyMs, 88)

await recordAiCredentialFailure(runtimeAfterSuccess, new Error("HTTP 401 invalid key"))
const runtimeAfterFailure = await getAiCredentialRuntime(second.id)
assert.equal(runtimeAfterFailure.healthStatus, "unhealthy")
assert.ok(runtimeAfterFailure.cooldownUntil)
await updateAiCredentialHealth(second.id, {
  status: "unhealthy",
  cooldownUntil: new Date(Date.now() - 60_000).toISOString(),
})
assert.deepEqual(
  await getAiCredentialPoolCapacity({
    vendor: "qwen",
    module: "penetration",
    model: "qwen-plus",
    requiredCapabilities: ["native_web", "auditable_sources"],
  }),
  {
    candidateCount: 0,
    maxConcurrency: 0,
    quotaGroupCount: 0,
  },
  "permanently unhealthy credentials must remain quarantined after cooldown expires",
)

await saveAiCredential({
  id: second.id,
  vendor: "qwen",
  name: "千问 2 号",
  accountLabel: "2号账号",
  quotaGroup: "qwen-account-1",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
  chatPath: "/v1/chat/completions",
  apiKey: "sk-test-account-two-rotated-secret",
  enabled: true,
  priority: 1,
  maxConcurrency: 1,
  quotaGroupMaxConcurrency: 1,
  allowedModels: ["qwen-plus", "qwen-max"],
  allowedModules: ["article", "question", "penetration"],
  declaredCapabilities: ["chat", "json", "native_web", "auditable_sources"],
}, "admin-test")
const runtimeAfterKeyRotation = await getAiCredentialRuntime(second.id)
assert.equal(runtimeAfterKeyRotation.healthStatus, "unchecked")
assert.deepEqual(runtimeAfterKeyRotation.verifiedWebModels, [])
assert.equal(runtimeAfterKeyRotation.verifiedCapabilities.includes("native_web"), false)
assert.equal(runtimeAfterKeyRotation.verifiedCapabilities.includes("auditable_sources"), false)

async function createKimiAccount(label: string, secret: string) {
  const saved = await saveAiCredential({
    vendor: "kimi",
    name: `Kimi ${label}`,
    accountLabel: label,
    quotaGroup: `kimi-${label}`,
    baseUrl: "https://api.moonshot.cn/v1",
    chatPath: "/chat/completions",
    apiKey: secret,
    enabled: false,
    priority: label.startsWith("1") ? 1 : 2,
    maxConcurrency: 1,
    quotaGroupMaxConcurrency: 1,
    allowedModels: ["kimi-k2.6"],
    allowedModules: ["penetration"],
    declaredCapabilities: ["chat"],
  }, "admin-test")
  await updateAiCredentialHealth(saved.id, {
    status: "healthy",
    verifiedCapabilities: ["chat"],
    consecutiveFailures: 0,
  })
  await setAiCredentialEnabled(saved.id, true, "admin-test")
  return saved
}

const kimiFirst = await createKimiAccount("1号账号", "sk-kimi-rate-account-one")
const kimiSecond = await createKimiAccount("2号账号", "sk-kimi-rate-account-two")
const kimiRequest = {
  vendor: "kimi" as const,
  module: "penetration" as const,
  model: "kimi-k2.6",
  requiredCapabilities: ["chat" as const],
  waitTimeoutMs: 0,
}
const kimiFirstLease = await acquireAiCredential(kimiRequest)
assert.equal(kimiFirstLease.credential.id, kimiFirst.id)
await kimiFirstLease.release()
const kimiSecondLease = await acquireAiCredential(kimiRequest)
assert.equal(
  kimiSecondLease.credential.id,
  kimiSecond.id,
  "a second independent Kimi account should run while the first account is rate limited",
)
await kimiSecondLease.release()
await assert.rejects(
  () => acquireAiCredential(kimiRequest),
  /任务较多/,
  "strict Kimi tasks must reserve two upstream calls per account",
)

rmSync(tempDir, { recursive: true, force: true })
console.log("AI multi-account credential storage, encryption, routing and shared quota gates passed")
