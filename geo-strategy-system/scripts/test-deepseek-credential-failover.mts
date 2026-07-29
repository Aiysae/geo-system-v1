import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SearchSourceEvent } from "../src/lib/llm/openai-compat"

const tempDir = mkdtempSync(join(tmpdir(), "geo-deepseek-model-failover-"))
delete process.env.DATABASE_URL
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = join(tempDir, "kv.json")
process.env.AI_CONFIG_ENCRYPTION_KEY = "test-deepseek-model-failover-key"

const {
  saveAiCredential,
  setAiCredentialEnabled,
  updateAiCredentialHealth,
} = await import("../src/lib/ai-credential-store")
const { runAdapterCredentialPoolChat } = await import("../src/lib/ai-credential-adapter")

async function enableCredential(input: Parameters<typeof saveAiCredential>[0]) {
  const saved = await saveAiCredential({ ...input, enabled: false }, "deepseek-failover-test")
  const declaredCapabilities = input.declaredCapabilities || []
  await updateAiCredentialHealth(saved.id, {
    status: "healthy",
    verifiedCapabilities: declaredCapabilities,
    verifiedWebModels: declaredCapabilities.includes("auditable_sources")
      ? input.allowedModels || []
      : [],
    consecutiveFailures: 0,
  })
  await setAiCredentialEnabled(saved.id, true, "deepseek-failover-test")
  return saved
}

const officialKey = "test-deepseek-empty-balance"
const relayKey = "test-deepseek-relay-healthy"
const searchKey = "test-baidu-search-healthy"

await enableCredential({
  vendor: "deepseek",
  name: "DeepSeek 1号",
  accountLabel: "1号账号",
  quotaGroup: "deepseek-account-1",
  baseUrl: "https://api.deepseek.com",
  chatPath: "/chat/completions",
  apiKey: officialKey,
  priority: 1,
  maxConcurrency: 1,
  quotaGroupMaxConcurrency: 1,
  allowedModels: ["deepseek-chat"],
  allowedModules: ["penetration"],
  declaredCapabilities: ["chat", "json"],
})
await enableCredential({
  vendor: "deepseek",
  name: "DeepSeek 2号",
  accountLabel: "2号账号",
  quotaGroup: "deepseek-account-2",
  baseUrl: "https://api.deepseek.com",
  chatPath: "/chat/completions",
  apiKey: relayKey,
  priority: 2,
  maxConcurrency: 1,
  quotaGroupMaxConcurrency: 1,
  allowedModels: ["deepseek-v4-pro"],
  allowedModules: ["penetration"],
  declaredCapabilities: ["chat", "json"],
})
await enableCredential({
  vendor: "ernie",
  name: "百度联网搜索",
  accountLabel: "搜索账号",
  quotaGroup: "ernie-search-account",
  baseUrl: "https://qianfan.baidubce.com/v2",
  chatPath: "/chat/completions",
  apiKey: searchKey,
  priority: 1,
  maxConcurrency: 1,
  quotaGroupMaxConcurrency: 1,
  allowedModels: ["ernie-5.1"],
  allowedModules: ["penetration"],
  declaredCapabilities: ["chat", "native_web", "auditable_sources"],
})

const originalFetch = globalThis.fetch
const generationRequests: Array<{ key: string; model: string }> = []
let relayRound = 0

try {
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    const key = (headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
    const body = JSON.parse(String(init?.body || "{}")) as { model?: string }

    if (url.includes("api.deepseek.com")) {
      generationRequests.push({ key, model: String(body.model || "") })
      if (key === officialKey) {
        return new Response(JSON.stringify({
          error: { code: "invalid_request_error", message: "Insufficient Balance" },
        }), {
          status: 402,
          statusText: "Payment Required",
          headers: { "Content-Type": "application/json" },
        })
      }
      assert.equal(key, relayKey)
      assert.equal(body.model, "deepseek-v4-pro")
      relayRound += 1
      if (relayRound === 1) {
        return new Response(JSON.stringify({
          id: "relay-tool-request",
          choices: [{
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "relay-search-call",
                type: "function",
                function: {
                  name: "search_web",
                  arguments: JSON.stringify({ query: "今天是几月几号" }),
                },
              }],
            },
          }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      return new Response(JSON.stringify({
        id: "relay-final-request",
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: "DeepSeek 2号账号联网回答" },
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.includes("/v2/ai_search/web_search")) {
      assert.equal(key, searchKey)
      return new Response(JSON.stringify({
        request_id: "baidu-search-request",
        references: [{
          type: "web",
          title: "当前日期公开信源",
          content: "用于验证 DeepSeek 在独立账号间切换后仍完成联网审计。",
          url: "https://example.com/news/current-date",
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    throw new Error(`Unexpected test URL: ${url}`)
  }

  const events: SearchSourceEvent[] = []
  const answer = await runAdapterCredentialPoolChat("deepseek", "penetration", {
    system: "",
    user: "今天是几月几号",
    mode: "consumer",
    forceWebSearch: true,
    rawQuestionOnly: true,
    requireWebEvidence: true,
    officialWebOnly: true,
    timeoutSec: 30,
    onSearchSources: event => events.push(event),
  })

  assert.equal(answer, "DeepSeek 2号账号联网回答")
  assert.deepEqual(generationRequests, [
    { key: officialKey, model: "deepseek-chat" },
    { key: relayKey, model: "deepseek-v4-pro" },
    { key: relayKey, model: "deepseek-v4-pro" },
  ])
  assert.equal(events.flatMap(event => event.sources).length, 1)
  assert.equal(events.some(event => event.searchExecuted), true)
  console.log("DeepSeek credential-specific model failover passed.")
} finally {
  globalThis.fetch = originalFetch
  rmSync(tempDir, { recursive: true, force: true })
}
