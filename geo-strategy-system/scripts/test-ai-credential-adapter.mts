import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SearchSourceEvent } from "../src/lib/llm/openai-compat"

const tempDir = mkdtempSync(join(tmpdir(), "geo-ai-adapter-pool-"))
delete process.env.DATABASE_URL
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = join(tempDir, "kv.json")
process.env.AI_CONFIG_ENCRYPTION_KEY = "test-ai-adapter-encryption-key"
process.env.ARK_API_KEY = "test-static-doubao-key"
process.env.ARK_DOUBAO_ENDPOINT_ID = "doubao-seed-2-0-lite-260215"

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
const { saveAiProviderSetting } = await import("../src/lib/ai-settings")
const { getPenetrationModelReadiness } = await import("../src/lib/penetration/model-readiness")

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
    verifiedWebModels: args.web ? ["qwen-plus"] : [],
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
const qwenWebSecret = "sk-adapter-web-account"
await createCredential({
  label: "3号联网账号",
  key: qwenWebSecret,
  priority: 3,
  web: true,
})
const qwenWebSecondSecret = "sk-adapter-web-account-second"
await createCredential({
  label: "4号联网账号",
  key: qwenWebSecondSecret,
  priority: 4,
  web: true,
})

const kimiSecret = "sk-kimi-generation-account"
const kimiCredential = await saveAiCredential({
  vendor: "kimi",
  name: "Kimi 1号",
  accountLabel: "1号账号",
  quotaGroup: "kimi-account-1",
  baseUrl: "https://api.moonshot.cn/v1",
  chatPath: "/chat/completions",
  apiKey: kimiSecret,
  enabled: false,
  priority: 1,
  maxConcurrency: 1,
  quotaGroupMaxConcurrency: 1,
  allowedModels: ["kimi-k2.6"],
  // Existing production rows may predate penetration permission.
  allowedModules: ["article", "question"],
  declaredCapabilities: ["chat", "json", "native_web"],
}, "adapter-test")
await updateAiCredentialHealth(kimiCredential.id, {
  status: "healthy",
  verifiedCapabilities: ["chat", "json"],
  consecutiveFailures: 0,
})
await setAiCredentialEnabled(kimiCredential.id, true, "adapter-test")

const deepSeekSecret = "test-deepseek-generation-account"
const deepSeekCredential = await saveAiCredential({
  vendor: "deepseek",
  name: "DeepSeek 1号",
  accountLabel: "1号账号",
  quotaGroup: "deepseek-account-1",
  baseUrl: "https://api.deepseek.com",
  chatPath: "/chat/completions",
  apiKey: deepSeekSecret,
  enabled: false,
  priority: 2,
  maxConcurrency: 1,
  quotaGroupMaxConcurrency: 1,
  allowedModels: ["deepseek-chat"],
  // Existing rows can predate the new penetration permission.
  allowedModules: ["article", "judge"],
  declaredCapabilities: ["chat", "json"],
}, "adapter-test")
await updateAiCredentialHealth(deepSeekCredential.id, {
  status: "healthy",
  verifiedCapabilities: ["chat", "json"],
  consecutiveFailures: 0,
})
await setAiCredentialEnabled(deepSeekCredential.id, true, "adapter-test")

const incompatibleDeepSeekSecret = "test-deepseek-v4-only-account"
const incompatibleDeepSeekCredential = await saveAiCredential({
  vendor: "deepseek",
  name: "DeepSeek V4 only",
  accountLabel: "V4 专用账号",
  quotaGroup: "deepseek-v4-account",
  baseUrl: "https://api.deepseek.com",
  chatPath: "/chat/completions",
  apiKey: incompatibleDeepSeekSecret,
  enabled: false,
  priority: 1,
  maxConcurrency: 1,
  quotaGroupMaxConcurrency: 1,
  allowedModels: ["deepseek-v4-pro"],
  allowedModules: ["article", "judge"],
  declaredCapabilities: ["chat", "json"],
}, "adapter-test")
await updateAiCredentialHealth(incompatibleDeepSeekCredential.id, {
  status: "healthy",
  verifiedCapabilities: ["chat", "json"],
  consecutiveFailures: 0,
})
await setAiCredentialEnabled(incompatibleDeepSeekCredential.id, true, "adapter-test")

const baiduSearchSecret = "test-baidu-search-account"
const baiduSearchCredential = await saveAiCredential({
  vendor: "ernie",
  name: "百度搜索 1号",
  accountLabel: "1号账号",
  quotaGroup: "ernie-account-1",
  baseUrl: "https://qianfan.baidubce.com/v2",
  chatPath: "/chat/completions",
  apiKey: baiduSearchSecret,
  enabled: false,
  priority: 1,
  maxConcurrency: 1,
  quotaGroupMaxConcurrency: 1,
  allowedModels: ["ernie-5.1"],
  allowedModules: ["penetration"],
  declaredCapabilities: ["chat", "native_web", "auditable_sources"],
}, "adapter-test")
await updateAiCredentialHealth(baiduSearchCredential.id, {
  status: "healthy",
  verifiedCapabilities: ["chat", "native_web", "auditable_sources"],
  verifiedWebModels: ["ernie-5.1"],
  consecutiveFailures: 0,
})
await setAiCredentialEnabled(baiduSearchCredential.id, true, "adapter-test")

await saveAiProviderSetting("hunyuan", {
  baseUrl: "https://tokenhub.tencentmaas.com",
  chatPath: "/v1/chat/completions",
  model: "hy3-preview",
  timeout: 300,
  extra: {},
}, "adapter-test")
const hunyuanCredential = await saveAiCredential({
  vendor: "hunyuan",
  name: "混元已验证账号",
  accountLabel: "1号联网账号",
  quotaGroup: "hunyuan-account-1",
  baseUrl: "https://tokenhub.tencentmaas.com",
  chatPath: "/v1/chat/completions",
  apiKey: "test-hunyuan-hy3-account",
  enabled: false,
  priority: 1,
  maxConcurrency: 2,
  quotaGroupMaxConcurrency: 2,
  allowedModels: ["hy3"],
  allowedModules: ["penetration"],
  declaredCapabilities: ["chat", "native_web", "auditable_sources"],
}, "adapter-test")
await updateAiCredentialHealth(hunyuanCredential.id, {
  status: "healthy",
  verifiedCapabilities: ["chat", "native_web", "auditable_sources"],
  verifiedWebModels: ["hy3"],
  consecutiveFailures: 0,
})
await setAiCredentialEnabled(hunyuanCredential.id, true, "adapter-test")

const strictArgs = {
  mode: "consumer" as const,
  forceWebSearch: true,
  rawQuestionOnly: true,
  requireWebEvidence: true,
  officialWebOnly: true,
}
assert.deepEqual(
  await getPenetrationModelReadiness("doubao"),
  {
    model: "doubao",
    ready: false,
    reason: "豆包暂无已启用且通过严格联网验证的账号",
  },
  "static provider configuration must not report ready when strict routing has no verified account",
)
assert.equal(
  await hasAdapterCredentialPoolCandidate("hunyuan", "penetration", strictArgs),
  true,
  "strict routing must use the credential's verified web model when the saved default is stale",
)
assert.deepEqual(
  await getAdapterCredentialPoolCapacity("hunyuan", "penetration", strictArgs),
  {
    vendor: "hunyuan",
    candidateCount: 1,
    maxConcurrency: 2,
    quotaGroupCount: 1,
    usesFallback: false,
  },
)
assert.equal(
  await hasAdapterCredentialPoolCandidate("qwen", "penetration", strictArgs),
  true,
  "strict penetration must only see a credential with verified web evidence",
)
assert.deepEqual(
  await getAdapterCredentialPoolCapacity("qwen", "penetration", strictArgs),
  {
    vendor: "qwen",
    candidateCount: 2,
    maxConcurrency: 2,
    quotaGroupCount: 2,
    usesFallback: false,
  },
)

const originalFetch = globalThis.fetch
const usedKeys: string[] = []
let kimiRound = 0
let deepSeekRound = 0
let deepSeekFailureMode = false
let qwenStrictFirstKey = ""
try {
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    const authorization = headers.get("authorization") || ""
    const key = authorization.replace(/^Bearer\s+/i, "")
    usedKeys.push(key)
    const body = JSON.parse(String(init?.body || "{}")) as {
      model?: string
      messages?: Array<Record<string, unknown>>
    }

    if (url.includes("api.moonshot.cn")) {
      assert.equal(key, kimiSecret)
      assert.equal(body.model, "kimi-k2.6")
      kimiRound += 1
      if (kimiRound === 1) {
        return new Response(JSON.stringify({
          id: "moonshot-pool-tool-1",
          choices: [{
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "pool-search-call-1",
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
        id: "moonshot-pool-answer-1",
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: "Kimi 双账号池联网回答" },
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.includes("api.deepseek.com")) {
      assert.equal(key, deepSeekSecret)
      assert.equal(body.model, "deepseek-chat")
      if (deepSeekFailureMode) {
        return new Response(JSON.stringify({
          error: {
            code: "invalid_request_error",
            message: "Thinking mode does not support this tool_choice",
          },
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      }
      deepSeekRound += 1
      if (deepSeekRound === 1) {
        return new Response(JSON.stringify({
          id: "deepseek-pool-tool-1",
          choices: [{
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "deepseek-pool-search-call-1",
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
        id: "deepseek-pool-answer-1",
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: "DeepSeek 双账号池联网回答" },
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.includes("/v2/ai_search/web_search")) {
      assert.equal(key, baiduSearchSecret)
      assert.deepEqual(body.messages, [{ role: "user", content: "今天是几月几号" }])
      return new Response(JSON.stringify({
        request_id: "baidu-pool-search-1",
        references: [{
          type: "web",
          title: "日期信源",
          content: "用于验证 Kimi 双账号池的公开网页摘要。",
          url: "https://example.com/news/current-date",
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.includes("dashscope.aliyuncs.com/api/v1/services/aigc")) {
      if (!qwenStrictFirstKey) qwenStrictFirstKey = key
      const hasAuditableSources = key !== qwenStrictFirstKey
      return new Response(JSON.stringify({
        request_id: `dashscope-${hasAuditableSources ? "recovered" : "empty"}`,
        output: {
          choices: [{
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: hasAuditableSources ? "千问切换账号后的联网回答" : "无来源自答",
            },
          }],
          search_info: {
            search_results: hasAuditableSources ? [{
              title: "千问联网公开文章",
              snippet: "用于验证无信源时自动切换另一独立账号。",
              url: "https://example.com/news/qwen-credential-failover",
            }] : [],
          },
        },
        usage: { plugins: { search: { count: 1 } } },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

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

  usedKeys.length = 0
  const qwenStrictEvents: SearchSourceEvent[] = []
  const qwenStrictResult = await runAdapterCredentialPoolChat("qwen", "penetration", {
    system: "",
    user: "今天有哪些公开人工智能新闻？",
    mode: "consumer",
    forceWebSearch: true,
    rawQuestionOnly: true,
    requireWebEvidence: true,
    officialWebOnly: true,
    timeoutSec: 30,
    onSearchSources: event => qwenStrictEvents.push(event),
  })
  assert.equal(qwenStrictResult, "千问切换账号后的联网回答")
  assert.equal(usedKeys.length, 2)
  assert.equal(new Set(usedKeys).size, 2)
  assert.equal(
    usedKeys.every(key => [qwenWebSecret, qwenWebSecondSecret].includes(key)),
    true,
  )
  assert.equal(qwenStrictEvents.flatMap(event => event.sources).length, 1)

  usedKeys.length = 0
  assert.equal(
    await hasAdapterCredentialPoolCandidate("kimi", "penetration", strictArgs),
    true,
  )
  assert.deepEqual(
    await getAdapterCredentialPoolCapacity("kimi", "penetration", strictArgs),
    {
      vendor: "ernie",
      candidateCount: 1,
      maxConcurrency: 1,
      quotaGroupCount: 1,
      usesFallback: false,
    },
  )
  const searchEvents: SearchSourceEvent[] = []
  const kimiResult = await runAdapterCredentialPoolChat("kimi", "penetration", {
    system: "",
    user: "今天是几月几号",
    mode: "consumer",
    forceWebSearch: true,
    rawQuestionOnly: true,
    requireWebEvidence: true,
    officialWebOnly: true,
    timeoutSec: 30,
    onSearchSources: event => searchEvents.push(event),
  })
  assert.equal(kimiResult, "Kimi 双账号池联网回答")
  assert.deepEqual(usedKeys, [kimiSecret, baiduSearchSecret, kimiSecret])
  assert.equal(searchEvents.flatMap(event => event.sources).length, 1)
  assert.equal(
    new Set(searchEvents.map(event => event.providerRequestId).filter(Boolean)).size,
    3,
  )

  usedKeys.length = 0
  assert.equal(
    await hasAdapterCredentialPoolCandidate("deepseek", "penetration", strictArgs),
    true,
  )
  assert.deepEqual(
    await getAdapterCredentialPoolCapacity("deepseek", "penetration", strictArgs),
    {
      vendor: "ernie",
      candidateCount: 1,
      maxConcurrency: 1,
      quotaGroupCount: 1,
      usesFallback: false,
    },
  )
  const deepSeekEvents: SearchSourceEvent[] = []
  const deepSeekResult = await runAdapterCredentialPoolChat("deepseek", "penetration", {
    system: "",
    user: "今天是几月几号",
    mode: "consumer",
    forceWebSearch: true,
    rawQuestionOnly: true,
    requireWebEvidence: true,
    officialWebOnly: true,
    timeoutSec: 30,
    onSearchSources: event => deepSeekEvents.push(event),
  })
  assert.equal(deepSeekResult, "DeepSeek 双账号池联网回答")
  assert.deepEqual(usedKeys, [deepSeekSecret, baiduSearchSecret, deepSeekSecret])
  assert.equal(deepSeekEvents.flatMap(event => event.sources).length, 1)

  deepSeekFailureMode = true
  await assert.rejects(
    () => runAdapterCredentialPoolChat("deepseek", "penetration", {
      system: "",
      user: "今天是几月几号",
      mode: "consumer",
      forceWebSearch: true,
      rawQuestionOnly: true,
      requireWebEvidence: true,
      officialWebOnly: true,
      timeoutSec: 30,
    }),
    /Thinking mode does not support this tool_choice/,
    "exhausted account failover must preserve the real upstream error",
  )
} finally {
  globalThis.fetch = originalFetch
  rmSync(tempDir, { recursive: true, force: true })
}

console.log("AI adapter credential failover and strict capability isolation passed")
