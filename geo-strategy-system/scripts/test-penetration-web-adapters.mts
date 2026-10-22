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
process.env.TENCENT_HUNYUAN_MODEL = "hy3"
process.env.TENCENT_HUNYUAN_CHAT_URL = "https://tokenhub.tencentmaas.com/v1/chat/completions"
process.env.ZHIPU_API_KEY = "test-zhipu-key"
process.env.ZHIPU_MODEL = "glm-5.1"

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

const SEARCH_DECLINED_QUESTION = "你们公司是本地的吗？"

globalThis.fetch = async (input, init) => {
  const url = String(input)
  const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>
  requests.push({ url, body })

  if (url === "https://open.bigmodel.cn/api/paas/v4/chat/completions") {
    return jsonResponse({
      id: "zhipu-completion-1",
      request_id: "zhipu-request-1",
      choices: [{
        finish_reason: "stop",
        message: { role: "assistant", content: "智谱 原始联网回答" },
      }],
      web_search: [
        {
          title: "智谱联网信源",
          link: "https://example.com/news/zhipu-search",
          content: "用于验证智谱官方联网搜索返回公开文章网址。",
          media: "示例网站",
          publish_date: "2026-10-01",
        },
        { title: "无网址的结果", link: "", content: "没有网址的结果不能作为信源。" },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 20, total_tokens: 32 },
    })
  }

  if (url.includes("dashscope.aliyuncs.com") && String(body.model).startsWith("qwen3.7")) {
    // Agent search streams each round's results and the answer in pieces.
    const events = [
      {
        request_id: "dash-qwen-agent-1",
        output: {
          choices: [{ finish_reason: "null", message: { role: "assistant", content: "通义千问" } }],
          search_info: { search_results: [{ index: 1, title: "第一轮信源", snippet: "第一轮检索到的公开文章。", url: "https://example.com/news/qwen-agent-round-1" }] },
        },
      },
      {
        request_id: "dash-qwen-agent-1",
        output: {
          choices: [{ finish_reason: "stop", message: { role: "assistant", content: "agent 联网回答" } }],
          search_info: { search_results: [{ index: 2, title: "第二轮信源", snippet: "第二轮检索到的公开文章。", url: "https://example.com/news/qwen-agent-round-2" }] },
        },
        usage: { plugins: { search: { count: 2 } } },
      },
    ]
    return new Response(events.map(event => `id:1\nevent:result\ndata:${JSON.stringify(event)}\n\n`).join(""), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })
  }

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
            }, {
              id: "deepseek-search-call-duplicate",
              type: "function",
              function: {
                name: "search_web",
                arguments: JSON.stringify({ query: `  ${question}  ` }),
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

  if (url === "https://api.moonshot.cn/v1/tools/search") {
    return new Response(JSON.stringify({
      search_results: [{
        authority: "S",
        date: "2026-10-01",
        title: "Kimi 联网信源",
        snippet: "用于验证 Kimi 官方搜索返回公开文章网址。",
        url: "https://example.com/news/kimi-search",
        site_name: "示例网站",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json", "X-Msh-Track-Id": "moonshot-search-track-1" } })
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
    return jsonResponse({
      request_id: "baidu-deepseek-search-request-1",
      references: [{
        type: "web",
        title: "DeepSeek 联网信源",
        content: "用于验证百度透明搜索返回公开文章网址。",
        url: "https://example.com/news/deepseek-search",
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

  if (url.includes("tokenhub.tencentmaas.com") && body.input === SEARCH_DECLINED_QUESTION) {
    return sseResponse([
      { type: "response.output_text.delta", delta: "我是腾讯元宝，一个 AI 助手。" },
      {
        type: "response.completed",
        response: {
          id: "hunyuan-request-declined",
          status: "completed",
          output: [{
            type: "message",
            status: "completed",
            content: [{ type: "output_text", text: "我是腾讯元宝，一个 AI 助手。", annotations: [] }],
          }],
        },
      },
    ])
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
const { chatDashScopeNativeSearch, dashScopeSearchStrategy } = await import("../src/lib/llm/dashscope-native-search")
const { chatKimi } = await import("../src/lib/llm/kimi")
const { chatErnie } = await import("../src/lib/llm/ernie")
const { chatDoubao } = await import("../src/lib/llm/doubao")
const { chatHunyuan } = await import("../src/lib/llm/hunyuan")
const { chatZhipu } = await import("../src/lib/llm/zhipu")
const { isAuditableSourceUrl } = await import("../src/lib/llm/source-extract")
const { searchMoonshotWeb } = await import("../src/lib/llm/moonshot-web-search")

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
  assert.equal(
    deepSeekRequests[1]?.body.tool_choice,
    "auto",
    "取得信源后模型可以再搜索一次或直接作答，不能被逼着在想继续搜索时交出半句话",
  )
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
  assert.equal(
    (qwenRequest.body.parameters as { search_options: { search_strategy: string } }).search_options.search_strategy,
    "max",
    "models without agent search keep the max strategy",
  )

  // Qwen 3.5 to 3.7 search like the App: agent rounds over a stream.
  assert.equal(dashScopeSearchStrategy("qwen3.7-max-preview"), "agent")
  assert.equal(dashScopeSearchStrategy("qwen-plus"), "max")
  const agentEvents: SearchSourceEvent[] = []
  const agentAnswer = await chatDashScopeNativeSearch({
    ...baseArgs,
    apiKey: "test-dashscope-key",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.7-max-preview",
    timeoutSec: 60,
    label: "通义千问",
    onSearchSources: event => agentEvents.push(event),
  })
  assert.equal(agentAnswer, "通义千问agent 联网回答")
  const agentRequest = requests.find(request => request.body.model === "qwen3.7-max-preview")
  const agentParameters = agentRequest?.body.parameters as {
    incremental_output?: boolean
    enable_thinking?: boolean
    search_options: { search_strategy: string }
  }
  assert.equal(agentParameters.search_options.search_strategy, "agent")
  assert.equal(agentParameters.incremental_output, true)
  assert.equal(agentParameters.enable_thinking, true)
  assert.deepEqual(
    agentEvents.flatMap(event => event.sources).map(source => source.url),
    ["https://example.com/news/qwen-agent-round-1", "https://example.com/news/qwen-agent-round-2"],
    "every round's results count as sources",
  )
  assert.equal(agentEvents[0]?.providerRequestId, "dash-qwen-agent-1")

  const kimiEvents: SearchSourceEvent[] = []
  const kimiAudits: PenetrationRequestAudit[] = []
  const kimiAnswer = await chatKimi({
    ...baseArgs,
    onSearchSources: event => kimiEvents.push(event),
    onRequestAudit: audit => kimiAudits.push(audit),
  })
  assert.equal(kimiAnswer, "Kimi 原始联网回答")
  const kimiRequests = requests.filter(request => request.url.includes("api.moonshot.cn/v1/chat"))
  assert.equal(kimiRequests.length, 2)
  assert.deepEqual(kimiRequests[0]?.body.messages, [{ role: "user", content: question }])
  assert.equal(kimiRequests[0]?.body.tool_choice, "required")
  assert.equal(kimiRequests[1]?.body.tool_choice, "auto")
  assert.deepEqual(kimiRequests[0]?.body.thinking, { type: "disabled" })
  assert.equal(
    ((kimiRequests[0]?.body.tools as Array<{ function?: { name?: string } }>)[0])
      ?.function?.name,
    "search_web",
  )
  // Kimi searches with its own official endpoint, not Baidu.
  const kimiSearchRequest = requests.find(request =>
    request.url === "https://api.moonshot.cn/v1/tools/search"
  )
  assert.ok(kimiSearchRequest)
  assert.equal(kimiSearchRequest.body.text_query, question)
  assert.equal(kimiSearchRequest.body.limit, 20)
  assert.equal(baiduWebSearchRound, 1, "only DeepSeek used Baidu search")
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
  assert.equal(kimiAudits[0]?.searchProvider, "moonshot_search")
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
  // The callers here pass temperature 0, which Baidu rejects as an invalid body.
  assert.equal(ernieRequest.body.temperature, 0.01)
  assert.equal(ernieEvents[0]?.sources.length, 1)
  assert.equal(ernieAudits[0]?.verified, true)
  assert.equal(ernieAudits[0]?.searchMode, "native_web")

  const doubaoEvents: SearchSourceEvent[] = []
  const doubaoAudits: PenetrationRequestAudit[] = []
  const doubaoAnswer = await chatDoubao({
    ...baseArgs,
    userLocation: { region: "浙江", city: "杭州" },
    onSearchSources: event => doubaoEvents.push(event),
    onRequestAudit: audit => doubaoAudits.push(audit),
  })
  assert.equal(doubaoAnswer, "豆包原始联网回答")
  const doubaoRequest = requests.find(request => request.url.includes("/api/v3/responses"))
  assert.ok(doubaoRequest)
  assert.equal(doubaoRequest.body.input, question)
  // The asker's city is search metadata; the prompt stays the raw question.
  assert.deepEqual(doubaoRequest.body.tools, [{
    type: "web_search",
    user_location: { type: "approximate", country: "中国", region: "浙江", city: "杭州" },
  }])
  assert.equal(doubaoRequest.body.tool_choice, "required")
  assert.deepEqual(doubaoRequest.body.thinking, { type: "disabled" }, "detection asks in the app's fast mode")
  assert.equal(doubaoEvents[0]?.sources.length, 1)
  assert.equal(doubaoAudits[0]?.verified, true)
  assert.equal(doubaoAudits[0]?.searchMode, "native_web")

  const hunyuanEvents: SearchSourceEvent[] = []
  const hunyuanAudits: PenetrationRequestAudit[] = []
  const hunyuanAnswer = await chatHunyuan({
    ...baseArgs,
    userLocation: { region: "浙江", city: "杭州" },
    onSearchSources: event => hunyuanEvents.push(event),
    onRequestAudit: audit => hunyuanAudits.push(audit),
  })
  assert.equal(hunyuanAnswer, "混元原始联网回答")
  const hunyuanRequest = requests.find(request => request.url.includes("tokenhub.tencentmaas.com"))
  assert.ok(hunyuanRequest)
  assert.ok(hunyuanRequest.url.endsWith("/v1/responses"))
  assert.equal(hunyuanRequest.body.input, question)
  assert.deepEqual(hunyuanRequest.body.tools, [{
    type: "web_search",
    search_context_size: "high",
    user_location: {
      type: "approximate",
      country: "CN",
      region: "浙江",
      city: "杭州",
      timezone: "Asia/Shanghai",
    },
  }])
  assert.deepEqual(hunyuanRequest.body.reasoning, { effort: "no_think" })
  assert.equal("tool_choice" in hunyuanRequest.body, false)
  assert.equal(hunyuanRequest.body.stream, true)
  assert.equal("temperature" in hunyuanRequest.body, false)
  assert.equal(hunyuanEvents[0]?.searchExecuted, true)
  assert.equal(hunyuanEvents[0]?.sources.length, 1)
  assert.equal(hunyuanAudits[0]?.verified, true)
  assert.equal(hunyuanAudits[0]?.searchMode, "native_web")

  const declinedEvents: SearchSourceEvent[] = []
  await assert.rejects(
    chatHunyuan({
      ...baseArgs,
      user: SEARCH_DECLINED_QUESTION,
      onSearchSources: event => declinedEvents.push(event),
    }),
    /判断这个问题不需要联网/,
  )
  assert.equal(declinedEvents.at(-1)?.declinedAnswer, "我是腾讯元宝，一个 AI 助手。")
  assert.equal(declinedEvents.at(-1)?.providerRequestId, "hunyuan-request-declined")
  assert.equal(declinedEvents.at(-1)?.searchExecuted, false)

  // A burst of searches on one key must stay under Moonshot's per-second cap.
  const searchStartedAt: number[] = []
  const burstFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/v1/tools/search")) searchStartedAt.push(Date.now())
    return burstFetch(input, init)
  }
  await Promise.all(Array.from({ length: 5 }, (_, index) => searchMoonshotWeb({
    apiKey: "test-moonshot-burst-key",
    baseUrl: "https://api.moonshot.cn",
    query: `${question} ${index}`,
    timeoutSec: 30,
  })))
  globalThis.fetch = burstFetch
  searchStartedAt.sort((a, b) => a - b)
  assert.ok(searchStartedAt[4] - searchStartedAt[0] >= 1_000, "five searches span at least two one-second windows")

  const zhipuEvents: SearchSourceEvent[] = []
  const zhipuAudits: PenetrationRequestAudit[] = []
  const zhipuAnswer = await chatZhipu({
    ...baseArgs,
    onSearchSources: event => zhipuEvents.push(event),
    onRequestAudit: audit => zhipuAudits.push(audit),
  })
  assert.equal(zhipuAnswer, "智谱 原始联网回答")
  const zhipuRequest = requests.find(request => request.url.startsWith("https://open.bigmodel.cn/"))
  assert.ok(zhipuRequest)
  assert.deepEqual(zhipuRequest.body.messages, [{ role: "user", content: question }])
  assert.deepEqual(zhipuRequest.body.tools, [{
    type: "web_search",
    web_search: { enable: true, search_engine: "search_pro_quark", search_result: true, count: 30 },
  }])
  assert.deepEqual(zhipuRequest.body.thinking, { type: "disabled" })
  assert.deepEqual(
    zhipuEvents.flatMap(event => event.sources).map(source => source.url),
    ["https://example.com/news/zhipu-search"],
    "only results with a URL count as sources",
  )
  assert.equal(zhipuEvents[0]?.providerRequestId, "zhipu-request-1")
  assert.equal(zhipuAudits[0]?.verified, true)
  assert.equal(zhipuAudits[0]?.modelProvider, "zhipu")
  assert.equal(zhipuAudits[0]?.searchProvider, "zhipu_search")

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
