import { openaiCompatChat, type ChatArgs } from "./openai-compat"
import { chatWithLocalWebSearchTool } from "./tool-loop"
import { extractSourcesFromUnknown } from "./source-extract"
import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import type { AiProviderRuntimeSetting } from "@/types/ai-settings"

const LABEL = "腾讯元宝/混元"

interface TokenHubResponse {
  id?: string
  error?: { message?: string; code?: string }
  message?: string
  choices?: Array<{
    finish_reason?: string
    message?: {
      content?: string | Array<{ text?: string }>
      search_results?: Array<Record<string, unknown>>
    }
  }>
}

type TokenHubContent = string | Array<{ text?: string }> | undefined

export async function isHunyuanConfigured(): Promise<boolean> {
  const config = await getAiProviderRuntimeSetting("hunyuan")
  return !!config.apiKey
}

function isTokenHub(baseUrl: string): boolean {
  return /tokenhub\.tencentmaas\.com/i.test(baseUrl)
}

function messageText(content: TokenHubContent): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.map(part => part?.text || "").filter(Boolean).join("\n")
}

function safeError(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._\-]{16,}/gi, "Bearer ***")
    .replace(/\s+/g, " ")
    .slice(0, 240)
}

async function chatTokenHubNativeSearch(
  args: ChatArgs,
  config: AiProviderRuntimeSetting,
): Promise<string> {
  if (!config.apiKey) {
    throw new Error(`${LABEL} TokenHub API Key 未配置。`)
  }
  const url = buildAiChatUrl(config)
  if (!isTokenHub(url)) {
    throw new Error(`${LABEL} 严格联网必须使用腾讯 TokenHub 官方地址。`)
  }

  const messages: Array<{ role: "system" | "user"; content: string }> = []
  if (!args.rawQuestionOnly && args.system.trim()) {
    messages.push({ role: "system", content: args.system })
  }
  messages.push({ role: "user", content: args.user })

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
        messages,
        max_tokens: args.maxTokens ?? 1200,
        web_search_options: {
          enable: true,
          search_source: "standard",
        },
      }),
    })
    const text = await response.text()
    let data: TokenHubResponse
    try {
      data = JSON.parse(text) as TokenHubResponse
    } catch (error) {
      throw new Error(`${LABEL} TokenHub 返回体解析失败：${error instanceof Error ? error.message : String(error)}`)
    }
    if (!response.ok) {
      const upstream = data.error?.message || data.message || safeError(text) || "(无响应体)"
      throw new Error(`${LABEL} TokenHub 调用失败 HTTP ${response.status}：${upstream}`)
    }

    const choice = data.choices?.[0]
    const answer = messageText(choice?.message?.content)
    const rawSearchResults = choice?.message?.search_results || []
    const sources = extractSourcesFromUnknown(rawSearchResults, args.user)
    const searchExecuted = rawSearchResults.length > 0
    args.onSearchSources?.({
      query: args.user,
      sources,
      mode: "native_web",
      searchExecuted,
      providerRequestId: data.id,
      failureReason: searchExecuted
        ? undefined
        : "腾讯 TokenHub 未返回 search_results；请检查联网搜索资源包状态。",
    })

    if (!answer.trim()) {
      throw new Error(`${LABEL} TokenHub 返回空内容（finish_reason=${choice?.finish_reason || "unknown"}）。`)
    }
    if (args.requireWebEvidence && sources.length === 0) {
      throw new Error(`${LABEL} TokenHub 未返回可审计网页来源，已阻断模型自答。`)
    }
    return answer
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
  const config = await getAiProviderRuntimeSetting("hunyuan")
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
