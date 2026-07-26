import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AiCredentialVendor } from "../src/types/ai-credentials"

const tempDir = mkdtempSync(join(tmpdir(), "geo-ai-credential-quotas-"))
delete process.env.DATABASE_URL
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = join(tempDir, "kv.json")
process.env.AI_CONFIG_ENCRYPTION_KEY = "test-ai-credential-quota-key"

const {
  saveAiCredential,
  setAiCredentialEnabled,
  updateAiCredentialHealth,
} = await import("../src/lib/ai-credential-store")
const { acquireAiCredential } = await import("../src/lib/ai-credential-router")
const { estimateAiCredentialQuota } = await import("../src/lib/ai-credential-quota")

async function createCredential(args: {
  vendor: AiCredentialVendor
  label: string
  priority?: number
  weight?: number
  tpmLimit?: number
  dailyBudgetCents?: number
}) {
  const saved = await saveAiCredential({
    vendor: args.vendor,
    name: `${args.vendor} ${args.label}`,
    accountLabel: args.label,
    quotaGroup: `${args.vendor}-${args.label}`,
    baseUrl: "https://api.example.com",
    chatPath: "/v1/chat/completions",
    apiKey: `test-${args.vendor}-${args.label}`,
    enabled: false,
    priority: args.priority || 100,
    weight: args.weight || 100,
    maxConcurrency: 1,
    quotaGroupMaxConcurrency: 1,
    tpmLimit: args.tpmLimit,
    dailyBudgetCents: args.dailyBudgetCents,
    allowedModels: ["test-model"],
    allowedModules: ["article"],
    declaredCapabilities: ["chat"],
  }, "quota-test")
  await updateAiCredentialHealth(saved.id, {
    status: "healthy",
    verifiedCapabilities: ["chat"],
  })
  await setAiCredentialEnabled(saved.id, true, "quota-test")
  return saved
}

const limited = await createCredential({
  vendor: "qwen",
  label: "受限账号",
  priority: 1,
  tpmLimit: 100,
  dailyBudgetCents: 1,
})
const fallback = await createCredential({
  vendor: "qwen",
  label: "备用账号",
  priority: 2,
})

const quotaLease = await acquireAiCredential({
  vendor: "qwen",
  module: "article",
  requiredCapabilities: ["chat"],
  estimatedTokens: 101,
  estimatedCostCents: 2,
  waitTimeoutMs: 0,
})
assert.equal(quotaLease.credential.id, fallback.id)
assert.notEqual(quotaLease.credential.id, limited.id)
await quotaLease.release()

const dailyLimited = await createCredential({
  vendor: "ernie",
  label: "日预算受限账号",
  priority: 1,
  dailyBudgetCents: 1,
})
const dailyFallback = await createCredential({
  vendor: "ernie",
  label: "日预算备用账号",
  priority: 2,
})
const dailyLease = await acquireAiCredential({
  vendor: "ernie",
  module: "article",
  requiredCapabilities: ["chat"],
  estimatedTokens: 10,
  estimatedCostCents: 2,
  waitTimeoutMs: 0,
})
assert.equal(dailyLease.credential.id, dailyFallback.id)
assert.notEqual(dailyLease.credential.id, dailyLimited.id)
await dailyLease.release()

const balanced = await Promise.all([
  createCredential({ vendor: "deepseek", label: "1号账号" }),
  createCredential({ vendor: "deepseek", label: "2号账号" }),
  createCredential({ vendor: "deepseek", label: "3号账号" }),
])
const counts = new Map(balanced.map(item => [item.id, 0]))
for (let index = 0; index < 180; index += 1) {
  const lease = await acquireAiCredential({
    vendor: "deepseek",
    module: "article",
    requiredCapabilities: ["chat"],
    waitTimeoutMs: 0,
  })
  counts.set(lease.credential.id, (counts.get(lease.credential.id) || 0) + 1)
  await lease.release()
}
for (const count of counts.values()) {
  assert.ok(count >= 35 && count <= 85, `equal-weight account distribution was ${count}/180`)
}

const estimate = estimateAiCredentialQuota({
  system: "系统",
  user: "用户问题",
  maxTokens: 1_000,
})
assert.equal(estimate.estimatedTokens, 1_006)
assert.ok(estimate.estimatedCostCents >= 1)

rmSync(tempDir, { recursive: true, force: true })
console.log("Credential TPM, daily budget protection and weighted routing passed")
