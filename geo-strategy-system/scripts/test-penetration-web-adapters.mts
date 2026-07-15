import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { SearchSourceEvent } from "../src/lib/llm/openai-compat"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-penetration-web-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(tempDir, "kv.json")
process.env.DASHSCOPE_API_KEY = "test-dashscope-key"
process.env.DASHSCOPE_MODEL = "qwen-plus"
process.env.DASHSCOPE_ENABLE_SEARCH = "true"
process.env.DEEPSEEK_WEB_SEARCH_MODEL = "deepseek-v4-flash"
process.env.MOONSHOT_API_KEY = "test-moonshot-key"
process.env.MOONSHOT_MODEL = "kimi-k2.6"
process.env.MOONSHOT_BASE_URL = "https://api.moonshot.cn"
process.env.MOONSHOT_CHAT_PATH = "/v1/chat/completions"
process.env.TENCENT_HUNYUAN_API_KEY = "test-tokenhub-key"
process.env.TENCENT_HUNYUAN_MODEL = "hy3-preview"
process.env.TENCENT_HUNYUAN_CHAT_URL = "https://tokenhub.tencentmaas.com/v1/chat/completions"

type CapturedRequest = { url: string; body: Record<string, unknown> }
const requests: CapturedRequest[] = []
const originalFetch = globalThis.fetch

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

globalThis.fetch = async (input, init) => {
  const url = String(input)
  const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>
  requests.push({ url, body })

  if (url.includes("dashscope.aliyuncs.com")) {
    return jsonResponse({
      request_id: "dash-request-1",
      output: {
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: "DeepSeek 原始联网回答" },
        }],
        search_info: {
          search_results: [{
            index: 1,
            title: "DeepSeek 联网信源",
            snippet: "用于验证结构化来源提取的公开文章摘要。",
            url: "https://example.com/news/deepseek-web-search",
          }],
        },
      },
      usage: { plugins: { search: { count: 1 } } },
    })
  }

  if (url.includes("api.moonshot.cn")) {
    const messages = body.messages as Array<Record<string, unknown>>
    if (!messages.some(message => message.role === "tool")) {
      return jsonResponse({
        id: "kimi-request-1",
        choices: [{
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "web-search-1",
              type: "function",
              function: {
                name: "$web_search",
                arguments: JSON.stringify({
                  search_result: "provider-encrypted-search-payload",
                  usage: { search_content_total_tokens: 1200 },
                }),
              },
            }],
          },
        }],
      })
    }
    return jsonResponse({
      id: "kimi-request-2",
      choices: [{
        finish_reason: "stop",
        message: { role: "assistant", content: "Kimi 原始联网回答" },
      }],
    })
  }

  if (url.includes("tokenhub.tencentmaas.com")) {
    return jsonResponse({
      id: "hunyuan-request-1",
      choices: [{
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: "混元原始联网回答",
          search_results: [{
            title: "混元联网信源",
            snippet: "用于验证 TokenHub search_results 的公开文章摘要。",
            url: "https://news.qq.com/rain/a/20260715A00123",
          }],
        },
      }],
    })
  }

  throw new Error(`Unexpected test URL: ${url}`)
}

const { chatDeepSeek } = await import("../src/lib/llm/deepseek")
const { chatKimi } = await import("../src/lib/llm/kimi")
const { chatHunyuan } = await import("../src/lib/llm/hunyuan")
const { isAuditableSourceUrl } = await import("../src/lib/llm/source-extract")

const question = "今天有哪些最新的人工智能新闻？"
const baseArgs = {
  system: "SENTINEL_SYSTEM_PROMPT_MUST_NOT_BE_SENT",
  user: question,
  temperature: 0,
  mode: "consumer" as const,
  forceWebSearch: true,
  rawQuestionOnly: true,
  requireWebEvidence: true,
  officialWebOnly: true,
  timeoutSec: 30,
}

try {
  assert.equal(
    isAuditableSourceUrl(
      "https://ss1.baidu.com/6ONXsjip0QIZ8tyhnq/it/u=123456789,987654321&fm=173&app=49",
      "新闻配图",
      "这是搜索结果中夹带的图片缓存链接。",
    ),
    false,
  )

  const deepSeekEvents: SearchSourceEvent[] = []
  const deepSeekAnswer = await chatDeepSeek({
    ...baseArgs,
    onSearchSources: event => deepSeekEvents.push(event),
  })
  assert.equal(deepSeekAnswer, "DeepSeek 原始联网回答")
  const deepSeekRequest = requests.find(request => request.url.includes("dashscope.aliyuncs.com"))
  assert.ok(deepSeekRequest)
  assert.equal(deepSeekRequest.body.model, "deepseek-v4-flash")
  assert.deepEqual(
    (deepSeekRequest.body.input as { messages: unknown[] }).messages,
    [{ role: "user", content: question }],
  )
  const deepSeekParameters = deepSeekRequest.body.parameters as Record<string, unknown>
  assert.equal(deepSeekParameters.enable_search, true)
  assert.deepEqual(deepSeekParameters.search_options, {
    forced_search: true,
    enable_source: true,
    enable_citation: true,
    citation_format: "[<number>]",
  })
  assert.equal(deepSeekEvents[0]?.searchExecuted, true)
  assert.equal(deepSeekEvents[0]?.sources.length, 1)

  const kimiEvents: SearchSourceEvent[] = []
  const kimiAnswer = await chatKimi({
    ...baseArgs,
    onSearchSources: event => kimiEvents.push(event),
  })
  assert.equal(kimiAnswer, "Kimi 原始联网回答")
  const kimiRequests = requests.filter(request => request.url.includes("api.moonshot.cn"))
  assert.equal(kimiRequests.length, 2)
  assert.deepEqual(kimiRequests[0].body.messages, [{ role: "user", content: question }])
  assert.equal(kimiRequests[0].body.temperature, 0.6)
  assert.deepEqual(kimiRequests[0].body.thinking, { type: "disabled" })
  assert.equal(kimiEvents.some(event => event.searchExecuted === true), true)
  assert.equal(kimiEvents.some(event => event.sources.length > 0), false)

  const hunyuanEvents: SearchSourceEvent[] = []
  const hunyuanAnswer = await chatHunyuan({
    ...baseArgs,
    onSearchSources: event => hunyuanEvents.push(event),
  })
  assert.equal(hunyuanAnswer, "混元原始联网回答")
  const hunyuanRequest = requests.find(request => request.url.includes("tokenhub.tencentmaas.com"))
  assert.ok(hunyuanRequest)
  assert.deepEqual(hunyuanRequest.body.messages, [{ role: "user", content: question }])
  assert.deepEqual(hunyuanRequest.body.web_search_options, {
    enable: true,
    search_source: "standard",
  })
  assert.equal("temperature" in hunyuanRequest.body, false)
  assert.equal(hunyuanEvents[0]?.searchExecuted, true)
  assert.equal(hunyuanEvents[0]?.sources.length, 1)

  console.log("Penetration native web adapter contract passed.")
} finally {
  globalThis.fetch = originalFetch
  fs.rmSync(tempDir, { recursive: true, force: true })
}
