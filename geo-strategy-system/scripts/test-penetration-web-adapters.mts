import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { SearchSourceEvent } from "../src/lib/llm/openai-compat"
import type { PenetrationRequestAudit } from "../src/types"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-penetration-web-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(tempDir, "kv.json")
process.env.DASHSCOPE_API_KEY = "test-dashscope-key"
process.env.DASHSCOPE_MODEL = "qwen-plus"
process.env.DASHSCOPE_ENABLE_SEARCH = "true"
process.env.DEEPSEEK_WEB_SEARCH_MODEL = "deepseek-v4-flash"
process.env.DEEPSEEK_API_KEY = "test-deepseek-key"
process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.com"
process.env.MOONSHOT_API_KEY = "test-moonshot-key"
process.env.MOONSHOT_MODEL = "kimi-k2.6"
process.env.MOONSHOT_BASE_URL = "https://api.moonshot.cn"
process.env.MOONSHOT_CHAT_PATH = "/v1/chat/completions"
process.env.BAIDU_QIANFAN_API_KEY = "test-baidu-key"
process.env.BAIDU_QIANFAN_MODEL = "ernie-5.1"
process.env.BAIDU_QIANFAN_BASE_URL = "https://qianfan.baidubce.com/v2"
process.env.ARK_API_KEY = "test-ark-key"
process.env.ARK_DOUBAO_ENDPOINT_ID = "doubao-seed-2-0-lite-260215"
process.env.TENCENT_HUNYUAN_API_KEY = "test-tokenhub-key"
process.env.TENCENT_HUNYUAN_MODEL = "hy3-preview"
process.env.TENCENT_HUNYUAN_CHAT_URL = "https://tokenhub.tencentmaas.com/v1/chat/completions"

type CapturedRequest = { url: string; body: Record<string, unknown> }
const requests: CapturedRequest[] = []
const originalFetch = globalThis.fetch
let kimiMoonshotRound = 0
let deepSeekRound = 0
let baiduWebSearchRound = 0

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

function sseResponse(events: unknown[]): Response {
  const body = events
    .map(event => `event: ${(event as { type?: string }).type || "message"}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("")
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  })
}

globalThis.fetch = async (input, init) => {
  const url = String(input)
  const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>
  requests.push({ url, body })

  if (url.includes("dashscope.aliyuncs.com")) {
    return jsonResponse({
      request_id: "dash-qwen-request-1",
      output: {
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: "通义千问原始联网回答" },
        }],
        search_info: {
          search_results: [{
            index: 1,
            title: "通义千问联网信源",
            snippet: "用于验证结构化来源提取的公开文章摘要。",
            url: "https://example.com/news/qwen-web-search",
          }],
        },
      },
      usage: { plugins: { search: { count: 1 } } },
    })
  }

  if (url.includes("api.deepseek.com")) {
    deepSeekRound += 1
    if (deepSeekRound === 1) {
      return jsonResponse({
        id: "deepseek-tool-1",
        choices: [{
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "deepseek-search-call-1",
              type: "function",
              function: {
                name: "search_web",
                arguments: JSON.stringify({ query: question }),
              },
            }],
          },
        }],
      })
    }
    return jsonResponse({
      id: "deepseek-answer-1",
      choices: [{
        finish_reason: "stop",
        message: { role: "assistant", content: "DeepSeek 原始联网回答" },
      }],
    })
  }

  if (url.includes("api.moonshot.cn")) {
    kimiMoonshotRound += 1
    if (kimiMoonshotRound === 1) {
      return jsonResponse({
        id: "moonshot-kimi-tool-1",
        choices: [{
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "kimi-search-call-1",
              type: "function",
              function: {
                name: "search_web",
                arguments: JSON.stringify({ query: question }),
              },
            }],
          },
        }],
      })
    }
    return jsonResponse({
      id: "moonshot-kimi-answer-1",
      choices: [{
        finish_reason: "stop",
        message: { role: "assistant", content: "Kimi 原始联网回答" },
      }],
    })
  }

  if (url.includes("qianfan.baidubce.com/v2/ai_search/web_search")) {
    baiduWebSearchRound += 1
    const slug = baiduWebSearchRound === 1 ? "deepseek" : "kimi"
    return jsonResponse({
      request_id: `baidu-${slug}-search-request-1`,
      references: [{
        type: "web",
        title: `${slug === "kimi" ? "Kimi" : "DeepSeek"} 联网信源`,
        content: "用于验证百度透明搜索返回公开文章网址。",
        url: `https://example.com/news/${slug}-search`,
        website: "示例网站",
      }],
    })
  }

  if (url.includes("qianfan.baidubce.com/v2/ai_search/chat/completions")) {
    return jsonResponse({
      request_id: "ernie-search-request-1",
      choices: [{
        finish_reason: "stop",
        message: { role: "assistant", content: "文心 原始联网回答" },
      }],
      references: [{
        type: "web",
        title: "文心 联网信源",
        content: "用于验证百度 AI 搜索返回公开文章网址。",
        url: "https://example.com/news/ernie-search",
        website: "示例网站",
      }],
    })
  }

  if (url.includes("ark.cn-beijing.volces.com/api/v3/responses")) {
    return jsonResponse({
      id: "doubao-response-1",
      output: [
        { type: "web_search_call", id: "doubao-search-1", status: "completed" },
        {
          type: "message",
          role: "assistant",
          content: [{
            type: "output_text",
            text: "豆包原始联网回答",
            annotations: [{
              type: "url_citation",
              title: "豆包联网信源",
              url: "https://example.com/news/doubao-search",
            }],
          }],
        },
      ],
    })
  }

  if (url.includes("tokenhub.tencentmaas.com")) {
    return sseResponse([
      {
        type: "response.created",
        response: { id: "hunyuan-request-1", status: "in_progress" },
      },
      {
        type: "response.web_search_call.completed",
        item: {
          type: "web_search_call",
          action: { query: question, queries: [question] },
        },
      },
      { type: "response.output_text.delta", delta: "混元原始联网回答" },
      {
        type: "response.completed",
        response: {
          id: "hunyuan-request-1",
          status: "completed",
          output: [
            {
              type: "web_search_call",
              id: "hunyuan-search-1",
              status: "completed",
              action: { query: question, queries: [question] },
            },
            {
              type: "message",
              status: "completed",
              content: [{
                type: "output_text",
                text: "混元原始联网回答",
                annotations: [{
                  type: "url_citation",
                  title: "混元联网信源",
                  url: "https://news.qq.com/rain/a/20260715A00123",
                }],
              }],
            },
          ],
          usage: { tool_usage: { web_search_call: 1 } },
        },
      },
    ])
  }

  throw new Error(`Unexpected test URL: ${url}`)
}

const { chatDeepSeek } = await import("../src/lib/llm/deepseek")
const { chatQwen } = await import("../src/lib/llm/qwen")
const { chatKimi } = await import("../src/lib/llm/kimi")
const { chatErnie } = await import("../src/lib/llm/ernie")
const { chatDoubao } = await import("../src/lib/llm/doubao")
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
  const deepSeekAudits: PenetrationRequestAudit[] = []
  const deepSeekAnswer = await chatDeepSeek({
    ...baseArgs,
    onSearchSources: event => deepSeekEvents.push(event),
    onRequestAudit: audit => deepSeekAudits.push(audit),
  })
  assert.equal(deepSeekAnswer, "DeepSeek 原始联网回答")
  const deepSeekRequests = requests.filter(request =>
    request.url.includes("api.deepseek.com")
  )
  assert.equal(deepSeekRequests.length, 2)
  assert.equal(deepSeekRequests[0]?.body.model, "deepseek-v4-flash")
  assert.deepEqual(deepSeekRequests[0]?.body.messages, [
    { role: "user", content: question },
  ])
  assert.equal(deepSeekRequests[0]?.body.tool_choice, "required")
  assert.equal(deepSeekEvents.some(event => event.searchExecuted === true), true)
  assert.equal(deepSeekEvents.flatMap(event => event.sources).length, 1)
  assert.equal(
    deepSeekEvents.some(event => event.mode === "external_tool_web"),
    true,
  )
  assert.equal(deepSeekAudits.length, 1)
  assert.equal(deepSeekAudits[0]?.verified, true)
  assert.equal(deepSeekAudits[0]?.modelProvider, "deepseek")
  assert.equal(deepSeekAudits[0]?.searchProvider, "baidu_search")
  assert.equal(deepSeekAudits[0]?.searchMode, "external_tool_web")
  assert.deepEqual(deepSeekAudits[0]?.messageRoles, ["user"])

  const qwenEvents: SearchSourceEvent[] = []
  const qwenAudits: PenetrationRequestAudit[] = []
  const qwenAnswer = await chatQwen({
    ...baseArgs,
    onSearchSources: event => qwenEvents.push(event),
    onRequestAudit: audit => qwenAudits.push(audit),
  })
  assert.equal(qwenAnswer, "通义千问原始联网回答")
  const qwenRequest = requests.find(request =>
    request.url.includes("dashscope.aliyuncs.com")
    && request.body.model === "qwen-plus"
  )
  assert.ok(qwenRequest)
  assert.deepEqual(
    (qwenRequest.body.input as { messages: unknown[] }).messages,
    [{ role: "user", content: question }],
  )
  assert.equal(qwenEvents[0]?.mode, "native_web")
  assert.equal(qwenAudits[0]?.verified, true)
  assert.equal(qwenAudits[0]?.searchMode, "native_web")

  const kimiEvents: SearchSourceEvent[] = []
  const kimiAudits: PenetrationRequestAudit[] = []
  const kimiAnswer = await chatKimi({
    ...baseArgs,
    onSearchSources: event => kimiEvents.push(event),
    onRequestAudit: audit => kimiAudits.push(audit),
  })
  assert.equal(kimiAnswer, "Kimi 原始联网回答")
  const kimiRequests = requests.filter(request => request.url.includes("api.moonshot.cn"))
  assert.equal(kimiRequests.length, 2)
  assert.deepEqual(kimiRequests[0]?.body.messages, [{ role: "user", content: question }])
  assert.equal(kimiRequests[0]?.body.tool_choice, "required")
  assert.deepEqual(kimiRequests[0]?.body.thinking, { type: "disabled" })
  assert.equal(
    ((kimiRequests[0]?.body.tools as Array<{ function?: { name?: string } }>)[0])
      ?.function?.name,
    "search_web",
  )
  const kimiSearchRequest = requests.find(request =>
    request.url.includes("/v2/ai_search/web_search")
  )
  assert.ok(kimiSearchRequest)
  assert.deepEqual(kimiSearchRequest.body.messages, [{ role: "user", content: question }])
  assert.deepEqual(
    kimiSearchRequest.body.resource_type_filter,
    [{ type: "web", top_k: 20 }],
  )
  const secondKimiMessages = kimiRequests[1]?.body.messages as Array<Record<string, unknown>>
  assert.equal(secondKimiMessages[0]?.role, "user")
  assert.equal(secondKimiMessages[1]?.role, "assistant")
  assert.equal(secondKimiMessages[2]?.role, "tool")
  assert.match(
    String(secondKimiMessages[2]?.content),
    /https:\/\/example\.com\/news\/kimi-search/,
  )
  assert.equal(
    kimiEvents.flatMap(event => event.sources).length,
    1,
  )
  assert.equal(
    new Set(kimiEvents.map(event => event.providerRequestId).filter(Boolean)).size,
    3,
  )
  assert.equal(kimiEvents.some(event => event.mode === "external_tool_web"), true)
  assert.equal(kimiAudits[0]?.verified, true)
  assert.equal(kimiAudits[0]?.modelProvider, "moonshot")
  assert.equal(kimiAudits[0]?.searchProvider, "baidu_search")
  assert.equal(kimiAudits[0]?.searchMode, "external_tool_web")

  const ernieEvents: SearchSourceEvent[] = []
  const ernieAudits: PenetrationRequestAudit[] = []
  const ernieAnswer = await chatErnie({
    ...baseArgs,
    onSearchSources: event => ernieEvents.push(event),
    onRequestAudit: audit => ernieAudits.push(audit),
  })
  assert.equal(ernieAnswer, "文心 原始联网回答")
  const ernieRequest = requests.find(request =>
    request.url.includes("qianfan.baidubce.com") && request.body.model === "ernie-5.1"
  )
  assert.ok(ernieRequest)
  assert.deepEqual(ernieRequest.body.messages, [{ role: "user", content: question }])
  assert.equal(ernieRequest.body.search_mode, "required")
  assert.equal(ernieEvents[0]?.sources.length, 1)
  assert.equal(ernieAudits[0]?.verified, true)
  assert.equal(ernieAudits[0]?.searchMode, "native_web")

  const doubaoEvents: SearchSourceEvent[] = []
  const doubaoAudits: PenetrationRequestAudit[] = []
  const doubaoAnswer = await chatDoubao({
    ...baseArgs,
    onSearchSources: event => doubaoEvents.push(event),
    onRequestAudit: audit => doubaoAudits.push(audit),
  })
  assert.equal(doubaoAnswer, "豆包原始联网回答")
  const doubaoRequest = requests.find(request => request.url.includes("/api/v3/responses"))
  assert.ok(doubaoRequest)
  assert.equal(doubaoRequest.body.input, question)
  assert.deepEqual(doubaoRequest.body.tools, [{ type: "web_search" }])
  assert.equal(doubaoRequest.body.tool_choice, "required")
  assert.equal(doubaoEvents[0]?.sources.length, 1)
  assert.equal(doubaoAudits[0]?.verified, true)
  assert.equal(doubaoAudits[0]?.searchMode, "native_web")

  const hunyuanEvents: SearchSourceEvent[] = []
  const hunyuanAudits: PenetrationRequestAudit[] = []
  const hunyuanAnswer = await chatHunyuan({
    ...baseArgs,
    onSearchSources: event => hunyuanEvents.push(event),
    onRequestAudit: audit => hunyuanAudits.push(audit),
  })
  assert.equal(hunyuanAnswer, "混元原始联网回答")
  const hunyuanRequest = requests.find(request => request.url.includes("tokenhub.tencentmaas.com"))
  assert.ok(hunyuanRequest)
  assert.ok(hunyuanRequest.url.endsWith("/v1/responses"))
  assert.equal(hunyuanRequest.body.input, question)
  assert.deepEqual(hunyuanRequest.body.tools, [{ type: "web_search", search_context_size: "medium" }])
  assert.equal(hunyuanRequest.body.tool_choice, "auto")
  assert.equal(hunyuanRequest.body.stream, true)
  assert.equal("temperature" in hunyuanRequest.body, false)
  assert.equal(hunyuanEvents[0]?.searchExecuted, true)
  assert.equal(hunyuanEvents[0]?.sources.length, 1)
  assert.equal(hunyuanAudits[0]?.verified, true)
  assert.equal(hunyuanAudits[0]?.searchMode, "native_web")

  assert.equal(
    requests.some(request =>
      JSON.stringify(request.body).includes("SENTINEL_SYSTEM_PROMPT_MUST_NOT_BE_SENT")
    ),
    false,
    "严格盲测不得把 system Prompt 发送给任何模型或搜索接口",
  )

  console.log("Penetration auditable web adapter contract passed.")
} finally {
  globalThis.fetch = originalFetch
  fs.rmSync(tempDir, { recursive: true, force: true })
}
