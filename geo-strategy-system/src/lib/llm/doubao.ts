import { openaiCompatChat, type ChatArgs } from "./openai-compat"
import { getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { getChatRuntimeSetting } from "@/lib/llm/runtime-config"
import { extractSourcesFromUnknown } from "./source-extract"

// 豆包 (Volcengine Ark) 适配器
//
// 两套对话入口：
//   1) Bot/Agent（推荐）—— /api/v3/bots/chat/completions，model=bot-xxxx。
//      在火山方舟控制台为 Bot 挂载"联网搜索"插件后，调用即享原生联网。
//   2) Endpoint Inference —— /api/v3/chat/completions，model=ep-xxxx。
//      Endpoint 本身没有官方联网插件。疑问句检测严格模式禁止再用本地 search_web 兜底。
//
// 因此：
//   - 渗透率客观盲测：只走挂载官方联网搜索插件的干净 Bot/Agent。
//   - 非盲测调研/分析：优先走 Bot，吃 Bot 的原生联网插件。
//
// 参考文档：
//   - https://www.volcengine.com/docs/82379/1099475 (Bot 调用)
//   - https://www.volcengine.com/docs/82379/1298454 (联网搜索插件)

const ENDPOINT_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions"
const BOT_URL = "https://ark.cn-beijing.volces.com/api/v3/bots/chat/completions"
const RESPONSES_URL = "https://ark.cn-beijing.volces.com/api/v3/responses"

interface ArkResponsesPayload {
  id?: string
  output_text?: string
  error?: { code?: string; message?: string }
  output?: Array<Record<string, unknown>>
}

export async function isDoubaoConfigured(): Promise<boolean> {
  const config = await getAiProviderRuntimeSetting("doubao")
  const botId = typeof config.extra.botId === "string" ? config.extra.botId : ""
  return !!config.apiKey && (!!botId || !!config.model)
}

function isRawArkModel(model: string): boolean {
  return model.startsWith("ep-") || model.startsWith("doubao-")
}

function arkResponseText(data: ArkResponsesPayload): string {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text
  const parts: string[] = []
  for (const output of data.output || []) {
    const content = output.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== "object") continue
      const value = part as { text?: unknown; content?: unknown }
      if (typeof value.text === "string") parts.push(value.text)
      else if (typeof value.content === "string") parts.push(value.content)
    }
  }
  return parts.filter(Boolean).join("\n")
}

function safeError(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._\-]{16,}/gi, "Bearer ***")
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, "sk-***")
    .replace(/\s+/g, " ")
    .slice(0, 260)
}

async function chatDoubaoResponses(args: ChatArgs, apiKey: string, model: string, timeoutSec: number): Promise<string> {
  if (!apiKey) throw new Error("豆包 API Key 未配置。")
  if (!isRawArkModel(model)) {
    throw new Error(`豆包 Responses 联网需要 doubao- 或 ep- 开头的模型，当前为「${model || "空"}」。`)
  }

  const timeoutMs = Math.max(30, timeoutSec) * 1000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(RESPONSES_URL, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: args.user,
        tools: [{ type: "web_search" }],
        tool_choice: "required",
        stream: false,
        max_output_tokens: args.maxTokens ?? 2048,
      }),
    })
    const text = await response.text()
    let data: ArkResponsesPayload
    try {
      data = JSON.parse(text) as ArkResponsesPayload
    } catch (error) {
      throw new Error(`豆包 Responses 返回体解析失败：${error instanceof Error ? error.message : String(error)}`)
    }
    if (!response.ok || data.error) {
      throw new Error(
        `豆包 Responses 联网调用失败 HTTP ${response.status}${data.error?.code ? ` [${data.error.code}]` : ""}：${data.error?.message || safeError(text) || "(无响应体)"}`,
      )
    }

    const answer = arkResponseText(data)
    const sources = extractSourcesFromUnknown(data, args.user)
    const searchExecuted = (data.output || []).some(output => output.type === "web_search_call")
    args.onSearchSources?.({
      query: args.user,
      sources,
      mode: "native_web",
      searchExecuted: searchExecuted || sources.length > 0,
      providerRequestId: data.id,
      failureReason: sources.length > 0 ? undefined : "豆包 Responses 联网没有返回可读取的网页信源。",
    })

    if (!answer.trim()) throw new Error("豆包 Responses 联网返回空内容。")
    if (args.requireWebEvidence && sources.length === 0) {
      throw new Error("豆包 Responses 联网未返回可审计网页来源，已进入后台补采。")
    }
    if (!data.id?.trim()) throw new Error("豆包 Responses 联网未返回请求编号，已进入后台补采。")
    return answer
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`豆包 Responses 联网请求超时 (${timeoutMs / 1000}s)。`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function chatDoubao(args: ChatArgs): Promise<string> {
  const config = await getChatRuntimeSetting("doubao", args)
  const key = config.apiKey
  const bot = typeof config.extra.botId === "string" ? config.extra.botId : ""
  const endpoint = config.model

  if (args.forceWebSearch) {
    return chatDoubaoResponses(args, key, endpoint, args.timeoutSec ?? config.timeout)
  }

  if (bot) {
    // Bot 模式仅用于非盲测调研/分析；渗透率盲测 forceWebSearch 会在上方提前返回。
    return openaiCompatChat({
      url: BOT_URL,
      apiKey: key,
      model: bot,
      label: "豆包",
      ...args,
      timeoutSec: args.timeoutSec ?? config.timeout,
    })
  }

  if (!isRawArkModel(endpoint)) {
    throw new Error(
      `豆包 Endpoint/模型配置错误：当前填写的是「${endpoint || "空"}」。火山方舟 /chat/completions 需要 ep- 开头的 Endpoint ID，或官方 doubao- 开头的模型 ID；如果你有 bot- 开头的 Bot，请填到后台豆包配置的 Bot ID 字段。`
    )
  }

  return openaiCompatChat({
    url: ENDPOINT_URL,
    apiKey: key,
    model: endpoint,
    label: "豆包",
    ...args,
    timeoutSec: args.timeoutSec ?? config.timeout,
  })
}
