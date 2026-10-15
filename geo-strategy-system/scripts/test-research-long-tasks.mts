import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const tempDir = mkdtempSync(join(tmpdir(), "geo-research-long-task-"))
delete process.env.DATABASE_URL
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = join(tempDir, "kv.json")
process.env.AI_CONFIG_ENCRYPTION_KEY = "test-research-long-task-encryption-key"
process.env.ARK_API_KEY = ""

const { compactResearchPenetrationSnapshot } = await import(
  "../src/lib/research/penetration-snapshot"
)
const {
  DOUBAO_RESEARCH_STABLE_MODEL,
} = await import("../src/lib/research/runtime")
const {
  isDirectBackgroundJobKind,
} = await import("../src/lib/background-jobs")
const {
  saveAiCredential,
  setAiCredentialEnabled,
  updateAiCredentialHealth,
} = await import("../src/lib/ai-credential-store")
const { saveAiProviderSetting } = await import("../src/lib/ai-settings")
const { runAdapterCredentialPoolChat } = await import(
  "../src/lib/ai-credential-adapter"
)
const { listAiCredentialRouteHealth } = await import(
  "../src/lib/ai-credential-route-health"
)
const { verifyAiCredentialChat } = await import(
  "../src/lib/ai-credential-verification"
)

assert.equal(isDirectBackgroundJobKind("research"), true)
assert.equal(isDirectBackgroundJobKind("competitorCompare"), true)
assert.equal(isDirectBackgroundJobKind("diagnosis"), false)

const rawPenetration = {
  aggregated: {
    penetrationRate: 0.42,
    ourMentions: 105,
    totalSlots: 250,
    ourRanking: 3,
    topCompetitors: Array.from({ length: 40 }, (_, index) => `竞品${index}`),
    missedQuestions: Array.from({ length: 40 }, (_, index) => `未命中问题${index}`),
    industryShare: Array.from({ length: 40 }, (_, index) => ({
      brand: `品牌${index}`,
      count: 40 - index,
      ratio: (40 - index) / 100,
    })),
    perModelRate: Array.from({ length: 20 }, (_, index) => ({
      model: `model-${index}`,
      rate: 0.4,
      mentions: 20,
      total: 50,
    })),
  },
  byModel: Object.fromEntries(Array.from({ length: 5 }, (_, modelIndex) => [
    `model-${modelIndex}`,
    Array.from({ length: 50 }, (_, questionIndex) => ({
      question: `问题 ${questionIndex}`,
      answer: `回答 ${questionIndex} ${"x".repeat(10_000)}`,
      hitOur: questionIndex % 2 === 0,
      mentionedBrands: Array.from({ length: 30 }, (_, index) => `品牌${index}`),
      sources: Array.from({ length: 20 }, () => ({ raw: "y".repeat(1_000) })),
    })),
  ])),
}
const compact = compactResearchPenetrationSnapshot(rawPenetration) as {
  aggregated: { topCompetitors: string[] }
  byModel: Record<string, Array<{ answer: string; mentionedBrands: string[] }>>
}
assert.ok(JSON.stringify(rawPenetration).length > 2_000_000)
assert.ok(JSON.stringify(compact).length < 80_000)
assert.equal(compact.aggregated.topCompetitors.length, 24)
assert.ok(Object.values(compact.byModel).every(items => items.length <= 8))
assert.ok(Object.values(compact.byModel).flat().every(item => item.answer.length <= 520))
assert.ok(Object.values(compact.byModel).flat().every(item => item.mentionedBrands.length <= 20))

await saveAiProviderSetting("doubao", {
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  chatPath: "/chat/completions",
  model: "doubao-seed-2-1-pro-260628",
  timeout: 600,
  extra: {},
}, "research-long-task-test")

const credential = await saveAiCredential({
  vendor: "doubao",
  name: "豆包调研测试账号",
  accountLabel: "1号账号",
  quotaGroup: "doubao-research-test",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  chatPath: "/chat/completions",
  apiKey: "test-doubao-research-key",
  enabled: false,
  maxConcurrency: 2,
  quotaGroupMaxConcurrency: 2,
  allowedModels: [DOUBAO_RESEARCH_STABLE_MODEL, "doubao-seed-2-1-pro-260628"],
  allowedModules: ["research"],
  declaredCapabilities: ["chat", "json", "long_text"],
}, "research-long-task-test")
await updateAiCredentialHealth(credential.id, {
  status: "healthy",
  verifiedCapabilities: ["chat", "json"],
  consecutiveFailures: 0,
})
await setAiCredentialEnabled(credential.id, true, "research-long-task-test")

const secondCredential = await saveAiCredential({
  vendor: "doubao",
  name: "豆包调研测试账号 2",
  accountLabel: "4号账号",
  quotaGroup: "doubao-research-test-2",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  chatPath: "/chat/completions",
  apiKey: "test-doubao-research-key-2",
  enabled: false,
  priority: 100,
  maxConcurrency: 2,
  quotaGroupMaxConcurrency: 2,
  allowedModels: [DOUBAO_RESEARCH_STABLE_MODEL, "doubao-seed-2-1-pro-260628"],
  allowedModules: ["research"],
  declaredCapabilities: ["chat", "json", "long_text"],
}, "research-long-task-test")
await updateAiCredentialHealth(secondCredential.id, {
  status: "healthy",
  verifiedCapabilities: ["chat", "json"],
  consecutiveFailures: 0,
})
await setAiCredentialEnabled(secondCredential.id, true, "research-long-task-test")

const originalFetch = globalThis.fetch
const requestedModels: string[] = []
const requestedTokenBudgets: number[] = []
const requestedKeys: string[] = []
try {
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as {
      model?: string
      max_tokens?: number
    }
    requestedModels.push(String(body.model || ""))
    requestedTokenBudgets.push(Number(body.max_tokens || 0))
    requestedKeys.push(
      String(new Headers(init?.headers).get("authorization") || "").replace(/^Bearer\s+/i, ""),
    )
    return new Response(JSON.stringify({
      choices: [{
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: JSON.stringify({ ok: true, text: "长任务验证".repeat(80) }),
        },
      }],
      usage: { prompt_tokens: 100, completion_tokens: 500, total_tokens: 600 },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  await runAdapterCredentialPoolChat("doubao", "research", {
    system: "只输出 JSON",
    user: "生成调研测试",
    jsonMode: true,
    mode: "judge",
    maxTokens: 1800,
    timeoutSec: 30,
    preferredModel: DOUBAO_RESEARCH_STABLE_MODEL,
    workloadClass: "long",
  })
  assert.equal(requestedModels[0], DOUBAO_RESEARCH_STABLE_MODEL)
  assert.notEqual(requestedModels[0], "doubao-seed-2-1-pro-260628")

  const concurrentArgs = {
    system: "只输出 JSON",
    user: "并行调研测试",
    jsonMode: true,
    mode: "judge" as const,
    maxTokens: 1800,
    timeoutSec: 30,
    preferredModel: DOUBAO_RESEARCH_STABLE_MODEL,
    workloadClass: "long" as const,
  }
  const keyOffset = requestedKeys.length
  await Promise.all([
    runAdapterCredentialPoolChat("doubao", "research", concurrentArgs),
    runAdapterCredentialPoolChat("doubao", "research", concurrentArgs),
  ])
  assert.equal(
    new Set(requestedKeys.slice(keyOffset, keyOffset + 2)).size,
    2,
    "parallel long stages should use independent credential accounts",
  )

  const routes = await listAiCredentialRouteHealth([credential.id, secondCredential.id])
  assert.ok(routes.some(route => (
    route.model === DOUBAO_RESEARCH_STABLE_MODEL
    && route.module === "research"
    && route.capabilityProfile === "json+long_text"
    && route.state === "closed"
  )))

  const verification = await verifyAiCredentialChat(credential.id, {
    model: DOUBAO_RESEARCH_STABLE_MODEL,
    module: "research",
    requiredCapabilities: ["json", "long_text"],
  })
  assert.ok(verification.credential.verifiedCapabilities.includes("long_text"))
  assert.equal(requestedTokenBudgets.at(-1), 768)
} finally {
  globalThis.fetch = originalFetch
  rmSync(tempDir, { recursive: true, force: true })
}

console.log("research long-task routing, payload compaction, and direct execution tests passed")
