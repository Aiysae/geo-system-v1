import { openaiCompatChat, type ChatArgs } from "./openai-compat"
import { chatWithLocalWebSearchTool } from "./tool-loop"
import { extractSourcesFromUnknown } from "./source-extract"
import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { getChatRuntimeSetting } from "@/lib/llm/runtime-config"
import type { AiProviderRuntimeSetting } from "@/types/ai-settings"

const LABEL = "腾讯元宝/混元"

interface TokenHubUrlCitation {
  type?: string
  url?: string
  title?: string
}

interface TokenHubOutputItem {
  type?: string
  id?: string
  status?: string
  action?: {
    query?: string
    queries?: string[]
  }
  content?: Array<{
    type?: string
    text?: string
    annotations?: TokenHubUrlCitation[]
  }>
}

interface TokenHubResponse {
  id?: string
  status?: string
  error?: { message?: string; code?: string } | string
  message?: string
  output?: TokenHubOutputItem[]
  usage?: {
    tool_usage?: { web_search_call?: number }
  }
}

interface TokenHubStreamEvent {
  type?: string
  delta?: string
  text?: string
  item?: TokenHubOutputItem
  response?: TokenHubResponse
  error?: { message?: string } | string
}

export async function isHunyuanConfigured(): Promise<boolean> {
  const config = await getAiProviderRuntimeSetting("hunyuan")
  return !!config.apiKey
}

function isTokenHub(baseUrl: string): boolean {
  return /tokenhub\.tencentmaas\.com/i.test(baseUrl)
}

function tokenHubResponsesUrl(chatUrl: string): string {
  const parsed = new URL(chatUrl)
  if (!/\/chat\/completions\/?$/.test(parsed.pathname)) {
    throw new Error(`${LABEL} TokenHub 地址不是受支持的 Chat Completions 端点。`)
  }
  parsed.pathname = parsed.pathname.replace(/\/chat\/completions\/?$/, "/responses")
  return parsed.toString()
}

function safeError(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._\-]{16,}/gi, "Bearer ***")
    .replace(/\s+/g, " ")
    .slice(0, 240)
}

function tokenHubErrorMessage(value: TokenHubResponse["error"] | TokenHubStreamEvent["error"]): string {
  if (typeof value === "string") return value
  return value?.message || ""
}

function parseTokenHubResponse(data: TokenHubResponse, streamedAnswer = "") {
  const output = data.output || []
  const annotations: TokenHubUrlCitation[] = []
  const queries = new Set<string>()
  let answer = ""
  let searchExecuted = (data.usage?.tool_usage?.web_search_call || 0) > 0

  for (const item of output) {
    if (item.type === "web_search_call") {
      searchExecuted = true
      if (item.action?.query?.trim()) queries.add(item.action.query.trim())
      for (const query of item.action?.queries || []) {
        if (query.trim()) queries.add(query.trim())
      }
    }
    if (item.type !== "message") continue
    for (const part of item.content || []) {
      if (part.type === "output_text" && part.text) answer += part.text
      annotations.push(...(part.annotations || []))
    }
  }

  return {
    answer: answer || streamedAnswer,
    annotations,
    queries: [...queries],
    searchExecuted,
    providerRequestId: data.id,
  }
}

async function readTokenHubEventStream(response: Response): Promise<{
  response: TokenHubResponse
  streamedAnswer: string
  searchObserved: boolean
}> {
  if (!response.body) throw new Error(`${LABEL} TokenHub 流式响应为空。`)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let streamedAnswer = ""
  let searchObserved = false
  let finalResponse: TokenHubResponse | undefined
  let providerRequestId = ""
  let streamError = ""

  const processBlock = (block: string) => {
    const lines = block.split(/\r?\n/)
    const eventName = lines.find(line => line.startsWith("event:"))?.slice(6).trim()
    const rawData = lines
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart())
      .join("\n")
    if (!rawData || rawData === "[DONE]") return

    let event: TokenHubStreamEvent
    try {
      event = JSON.parse(rawData) as TokenHubStreamEvent
    } catch {
      return
    }
    const type = event.type || eventName || ""
    if (type === "response.output_text.delta" && event.delta) streamedAnswer += event.delta
    if (type === "response.output_text.done" && event.text) streamedAnswer = event.text
    if (type.startsWith("response.web_search_call.")) searchObserved = true
    if (event.item?.type === "web_search_call") searchObserved = true
    if (event.response?.id && !providerRequestId) providerRequestId = event.response.id
    if (type === "response.completed" && event.response) finalResponse = event.response
    if (type === "response.failed" || type === "error") {
      streamError = tokenHubErrorMessage(event.error)
        || tokenHubErrorMessage(event.response?.error)
        || `${LABEL} TokenHub 流式响应失败。`
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() || ""
    for (const block of blocks) processBlock(block)
    if (done) break
  }
  if (buffer.trim()) processBlock(buffer)
  if (streamError) throw new Error(streamError)

  return {
    response: finalResponse || {
      id: providerRequestId || undefined,
      status: "completed",
      output: [],
    },
    streamedAnswer,
    searchObserved,
  }
}

async function chatTokenHubNativeSearch(
  args: ChatArgs,
  config: AiProviderRuntimeSetting,
): Promise<string> {
  if (!config.apiKey) {
    throw new Error(`${LABEL} TokenHub API Key 未配置。`)
  }
  const chatUrl = buildAiChatUrl(config)
  if (!isTokenHub(chatUrl)) {
    throw new Error(`${LABEL} 严格联网必须使用腾讯 TokenHub 官方地址。`)
  }
  const url = tokenHubResponsesUrl(chatUrl)

  const timeoutMs = Math.max(30, args.timeoutSec ?? config.timeout) * 1000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        input: args.user,
        tools: [{ type: "web_search", search_context_size: "medium" }],
        // Hy3 preview currently accepts only "auto". Strict completion is
        // enforced after the response by requiring a real search call + URLs.
        tool_choice: "auto",
        max_output_tokens: args.maxTokens ?? 1200,
        stream: true,
      }),
    })
    if (!response.ok) {
      const text = await response.text()
      let data: TokenHubResponse = {}
      try {
        data = JSON.parse(text) as TokenHubResponse
      } catch {
        // The redacted response excerpt below remains useful for provider support.
      }
      const upstream = tokenHubErrorMessage(data.error) || data.message || safeError(text) || "(无响应体)"
      throw new Error(`${LABEL} TokenHub 调用失败 HTTP ${response.status}：${upstream}`)
    }

    const contentType = response.headers.get("content-type") || ""
    let data: TokenHubResponse
    let streamedAnswer = ""
    let searchObserved = false
    if (contentType.includes("text/event-stream")) {
      const streamed = await readTokenHubEventStream(response)
      data = streamed.response
      streamedAnswer = streamed.streamedAnswer
      searchObserved = streamed.searchObserved
    } else {
      data = await response.json() as TokenHubResponse
    }

    if (data.status === "failed" || data.error) {
      throw new Error(tokenHubErrorMessage(data.error) || `${LABEL} TokenHub 响应失败。`)
    }
    const parsed = parseTokenHubResponse(data, streamedAnswer)
    const sources = extractSourcesFromUnknown(parsed.annotations, args.user)
    const searchExecuted = searchObserved || parsed.searchExecuted
    args.onSearchSources?.({
      query: parsed.queries[0] || args.user,
      sources,
      mode: "native_web",
      searchExecuted,
      providerRequestId: parsed.providerRequestId,
      failureReason: searchExecuted
        ? undefined
        : "腾讯 TokenHub 未执行 web_search；请检查联网搜索资源包状态。",
    })

    if (!parsed.answer.trim()) {
      throw new Error(`${LABEL} TokenHub 返回空内容。`)
    }
    if (args.requireWebEvidence && sources.length === 0) {
      throw new Error(`${LABEL} TokenHub 未返回可审计网页来源，已阻断模型自答。`)
    }
    return parsed.answer
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`${LABEL} TokenHub 联网请求超时 (${timeoutMs / 1000}s)。`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function chatHunyuan(args: ChatArgs): Promise<string> {
  const config = await getChatRuntimeSetting("hunyuan", args)
  if (args.forceWebSearch) {
    if (!isTokenHub(config.baseUrl)) {
      throw new Error(`${LABEL} 严格联网需要切换到腾讯 TokenHub · HY3 Preview。`)
    }
    return chatTokenHubNativeSearch(args, config)
  }

  if (isTokenHub(config.baseUrl)) {
    return chatWithLocalWebSearchTool({
      url: buildAiChatUrl(config),
      apiKey: config.apiKey,
      model: config.model,
      label: LABEL,
      allowSpecifiedToolChoice: false,
      ...args,
      timeoutSec: args.timeoutSec ?? config.timeout,
    })
  }

  const enableEnhancement = config.extra.enableEnhancement === true
  const extraBody =
    args.allowWebSearch !== false && args.mode === "consumer" && enableEnhancement
      ? { enable_enhancement: true }
      : undefined

  return openaiCompatChat({
    url: buildAiChatUrl(config),
    apiKey: config.apiKey,
    model: config.model,
    label: LABEL,
    ...args,
    extraBody,
    timeoutSec: args.timeoutSec ?? config.timeout,
  })
}
