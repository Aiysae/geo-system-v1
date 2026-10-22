import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SearchSourceEvent } from "../src/lib/llm/openai-compat"
import type { PenetrationRequestAudit } from "../src/types"

// Detection searches with each App's own engine: DeepSeek's search on the
// DeepSeek account, and Yuanbao search for Hunyuan once such an account is in
// the pool.

const tempDir = mkdtempSync(join(tmpdir(), "geo-app-search-"))
delete process.env.DATABASE_URL
delete process.env.DEEPSEEK_SEARCH_PROVIDER
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = join(tempDir, "kv.json")
process.env.AI_CONFIG_ENCRYPTION_KEY = "test-app-search-encryption-key"

const originalFetch = globalThis.fetch
const calls: Array<{ url: string; body: Record<string, unknown> }> = []
let yuanbaoError: { Code: string; Message: string } | null = null

function json(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", ...headers } })
}

function chatTurn(messages: Array<{ role: string }>, id: string, answer: string, toolTurnFinish = "tool_calls") {
  // First turn searches; once a tool result is in, answer.
  if (!messages.some(message => message.role === "tool")) {
    return json({
      id: `${id}-tool`,
      choices: [{
        finish_reason: toolTurnFinish,
        message: {
          role: "assistant",
          content: toolTurnFinish === "stop" ? "我先搜索一下。" : "",
          tool_calls: [{ id: `${id}-call`, type: "function", function: { name: "search_web", arguments: JSON.stringify({ query: "监理公司 排名" }) } }],
        },
      }],
    })
  }
  return json({ id: `${id}-answer`, choices: [{ finish_reason: "stop", message: { role: "assistant", content: answer } }] })
}

globalThis.fetch = async (input, init) => {
  const url = String(input)
  const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>
  calls.push({ url, body })
  if (url === "https://api.deepseek.com/v1/tools/search") {
    return json({
      results: [{
        title: "2026 监理公司榜单",
        url: "https://example.com/deepseek-rank",
        snippet: "短摘要",
        summary: "长摘要：上海建科、浙江江南位列前茅。",
      }],
    }, { "x-ds-trace-id": "ds-trace-1" })
  }
  if (url === "https://api.deepseek.com/chat/completions") {
    return chatTurn(body.messages as Array<{ role: string }>, "deepseek", "DeepSeek 用自家搜索的回答")
  }
  if (url === "https://api.wsa.cloud.tencent.com/SearchPro") {
    if (yuanbaoError) return json({ Response: { Error: yuanbaoError, RequestId: "wsa-error" } })
    return json({
      Response: {
        RequestId: "wsa-request-1",
        Pages: [JSON.stringify({
          title: "工程监理十大品牌",
          url: "https://example.com/yuanbao-rank",
          passage: "元宝搜索摘要",
          content: "元宝搜索动态摘要：中咨、公诚。",
          date: "2026-10-01",
        })],
      },
    })
  }
  if (url === "https://tokenhub.tencentmaas.com/v1/chat/completions") {
    // hy3 marks a turn that calls tools as finished.
    return chatTurn(body.messages as Array<{ role: string }>, "hunyuan", "元宝用元宝搜索的回答", "stop")
  }
  throw new Error(`unexpected request ${url}`)
}

const { saveAiCredential, setAiCredentialEnabled, updateAiCredentialHealth, getAiCredentialRuntime } = await import("../src/lib/ai-credential-store")
const { runAdapterCredentialPoolChat, getAdapterCredentialPoolCapacity } = await import("../src/lib/ai-credential-adapter")
const { verifyAiCredentialChat } = await import("../src/lib/ai-credential-verification")
const { classifyAiCredentialFailure } = await import("../src/lib/ai-credential-failure-classifier")

const strictArgs = {
  system: "",
  mode: "consumer" as const,
  forceWebSearch: true,
  rawQuestionOnly: true,
  requireWebEvidence: true,
  officialWebOnly: true,
}

async function enabledCredential(input: Parameters<typeof saveAiCredential>[0], health: Parameters<typeof updateAiCredentialHealth>[1]) {
  const saved = await saveAiCredential(input, "app-search-test")
  await updateAiCredentialHealth(saved.id, health)
  await setAiCredentialEnabled(saved.id, true, "app-search-test")
  return saved
}

try {
  await enabledCredential({
    vendor: "deepseek",
    name: "DeepSeek 1号",
    accountLabel: "1号",
    quotaGroup: "deepseek-1",
    baseUrl: "https://api.deepseek.com",
    chatPath: "/chat/completions",
    apiKey: "test-deepseek-key",
    enabled: false,
    priority: 1,
    maxConcurrency: 2,
    quotaGroupMaxConcurrency: 2,
    allowedModels: ["deepseek-chat"],
    allowedModules: ["penetration"],
    declaredCapabilities: ["chat", "json"],
  }, { status: "healthy", verifiedCapabilities: ["chat", "json"], consecutiveFailures: 0 })

  await enabledCredential({
    vendor: "hunyuan",
    name: "混元 1号",
    accountLabel: "1号",
    quotaGroup: "hunyuan-1",
    baseUrl: "https://tokenhub.tencentmaas.com/v1",
    chatPath: "/chat/completions",
    apiKey: "test-tokenhub-key",
    enabled: false,
    priority: 1,
    maxConcurrency: 3,
    quotaGroupMaxConcurrency: 3,
    allowedModels: ["hy3"],
    allowedModules: ["penetration"],
    declaredCapabilities: ["chat", "native_web", "auditable_sources"],
  }, { status: "healthy", verifiedCapabilities: ["chat", "native_web", "auditable_sources"], verifiedWebModels: ["hy3"], consecutiveFailures: 0 })

  // DeepSeek searches with its own engine and needs no search account.
  {
    const events: SearchSourceEvent[] = []
    const audits: PenetrationRequestAudit[] = []
    const answer = await runAdapterCredentialPoolChat("deepseek", "penetration", {
      ...strictArgs,
      user: "有哪些监理公司实力比较强？",
      onSearchSources: event => events.push(event),
      onRequestAudit: audit => audits.push(audit),
    })
    assert.equal(answer, "DeepSeek 用自家搜索的回答")
    assert.equal(audits[0]?.searchProvider, "deepseek_search")
    const search = calls.find(call => call.url.endsWith("/v1/tools/search"))
    assert.equal(search?.body.ori_question, "有哪些监理公司实力比较强？", "the question helps DeepSeek read the query")
    const sourced = events.find(event => event.sources.length > 0)
    assert.equal(sourced?.providerRequestId, "ds-trace-1")
    assert.equal(sourced?.sources[0]?.snippet, "短摘要", "the report keeps the short snippet")
    const toolMessage = (calls.filter(call => call.url.endsWith("/chat/completions") && call.url.includes("deepseek")).at(-1)
      ?.body.messages as Array<{ role: string; content: string }>).find(message => message.role === "tool")
    assert.match(toolMessage?.content || "", /长摘要/, "the model reads the long summary")
  }

  // Without a Yuanbao search account, Hunyuan keeps TokenHub's own search.
  assert.equal((await getAdapterCredentialPoolCapacity("hunyuan", "penetration", strictArgs)).maxConcurrency, 3)

  const yuanbao = await saveAiCredential({
    vendor: "yuanbao_search",
    name: "元宝搜索 1号",
    accountLabel: "1号",
    quotaGroup: "yuanbao-1",
    baseUrl: "https://api.wsa.cloud.tencent.com",
    chatPath: "/SearchPro",
    apiKey: "test-wsa-key",
    enabled: false,
    priority: 1,
    maxConcurrency: 2,
    quotaGroupMaxConcurrency: 2,
    allowedModels: ["SearchPro"],
    allowedModules: ["penetration"],
    declaredCapabilities: ["native_web", "auditable_sources"],
  }, "app-search-test")
  // The admin's "检测" on a search account runs a real search.
  const verified = await verifyAiCredentialChat(yuanbao.id)
  assert.match(verified.message, /严格联网检测通过/)
  const runtime = await getAiCredentialRuntime(yuanbao.id)
  assert.equal(runtime.healthStatus, "healthy")
  assert.ok(runtime.verifiedCapabilities.includes("native_web"))
  await setAiCredentialEnabled(yuanbao.id, true, "app-search-test")

  // With one, Hunyuan answers through it, capped by the smaller pool.
  {
    assert.equal((await getAdapterCredentialPoolCapacity("hunyuan", "penetration", strictArgs)).maxConcurrency, 2)
    const events: SearchSourceEvent[] = []
    const audits: PenetrationRequestAudit[] = []
    const answer = await runAdapterCredentialPoolChat("hunyuan", "penetration", {
      ...strictArgs,
      user: "工程监理哪家强？",
      onSearchSources: event => events.push(event),
      onRequestAudit: audit => audits.push(audit),
    })
    assert.equal(answer, "元宝用元宝搜索的回答")
    assert.equal(audits[0]?.searchProvider, "yuanbao_search")
    assert.equal(audits[0]?.model, "hy3")
    const search = calls.filter(call => call.url.endsWith("/SearchPro")).at(-1)
    assert.equal(search?.body.Mode, 2)
    assert.equal(search?.body.Cnt, 20)
    assert.equal(events.find(event => event.sources.length > 0)?.providerRequestId, "wsa-request-1")
    const chat = calls.filter(call => call.url.startsWith("https://tokenhub.tencentmaas.com/v1/chat/completions")).at(-1)
    assert.equal(chat?.body.reasoning_effort, "low", "hy3 calls tools only while thinking")
    assert.ok(!calls.some(call => call.url.includes("/v1/responses")), "TokenHub's own search is not used")
  }

  // Tencent Cloud's error codes are read as the account problems they are.
  yuanbaoError = { Code: "ResourceUnavailable", Message: "account in arrears" }
  await assert.rejects(
    runAdapterCredentialPoolChat("hunyuan", "penetration", { ...strictArgs, user: "欠费时的问题", credentialAttemptLimit: 1 }),
    error => classifyAiCredentialFailure(error).failureClass === "billing",
  )
  assert.equal(
    classifyAiCredentialFailure(new Error("元宝搜索鉴权失败 HTTP 401（UnauthorizedOperation），请检查 API Key：x")).failureClass,
    "authentication",
  )

  console.log("Penetration App search engines: DeepSeek's own search and Yuanbao search for Hunyuan passed.")
} finally {
  globalThis.fetch = originalFetch
  rmSync(tempDir, { recursive: true, force: true })
}
