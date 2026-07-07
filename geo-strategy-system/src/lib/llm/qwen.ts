import { openaiCompatChat, type ChatArgs } from "./openai-compat"
import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import {
  dedupePenetrationSources,
  extractSourcesFromUnknown,
  isAuditableSourceUrl,
  normalizeSourceDomain,
} from "./source-extract"
import type { PenetrationSource } from "@/types"

// 通义千问 (DashScope) 适配器。
// 默认启用阿里百炼官方联网插件，确保疑问句检测直接请求官方联网回答。
// 疑问句检测严格模式下，如果后台关闭 enableSearch，会直接报错，不再退回本地预检索。
//   https://help.aliyun.com/zh/model-studio/use-qwen-by-calling-api#section-search-on-internet

export async function isQwenConfigured(): Promise<boolean> {
  const config = await getAiProviderRuntimeSetting("qwen")
  return !!config.apiKey
}

type DashScopeContent =
  | string
  | Array<{
      text?: string
      content?: string
    }>
  | undefined

interface DashScopeResponse {
  code?: string
  message?: string
  output?: {
    text?: string
    choices?: Array<{
      finish_reason?: string
      message?: {
        role?: string
        content?: DashScopeContent
      }
    }>
    search_info?: {
      search_results?: Array<Record<string, unknown>>
    }
  }
}

function dashScopeNativeEndpoint(baseUrl: string): string {
  const parsed = new URL(baseUrl)
  if (!/(\.|^)dashscope\.aliyuncs\.com$/i.test(parsed.hostname)) {
    throw new Error("通义千问严格联网盲测需要使用 DashScope 官方 Base URL，当前地址无法返回官方可审计来源。")
  }
  return `${parsed.origin}/api/v1/services/aigc/text-generation/generation`
}

function extractTextContent(content: DashScopeContent): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map(part => part.text || part.content || "")
      .filter(Boolean)
      .join("\n")
  }
  return ""
}

function sourceFromDashResult(result: Record<string, unknown>, query: string): PenetrationSource | null {
  const urlValue = result.url || result.link || result.source_url || result.citation_url
  if (typeof urlValue !== "string") return null
  const titleValue = result.title || result.name || result.source_name || result.site_name
  const snippetValue = result.snippet || result.summary || result.description || result.content || result.text
  const title = typeof titleValue === "string" ? titleValue.trim() : ""
  const snippet = typeof snippetValue === "string" ? snippetValue.trim() : ""
  try {
    const clean = new URL(urlValue.trim()).toString()
    if (!isAuditableSourceUrl(clean, title, snippet)) return null
    return {
      title: title || clean,
      snippet,
      url: clean,
      domain: normalizeSourceDomain(clean),
      query,
    }
  } catch {
    return null
  }
}

function extractDashSources(data: DashScopeResponse, query: string): PenetrationSource[] {
  const direct = (data.output?.search_info?.search_results || [])
    .map(result => sourceFromDashResult(result, query))
    .filter((source): source is PenetrationSource => !!source)
  return dedupePenetrationSources([
    ...direct,
    ...extractSourcesFromUnknown(data, query),
  ])
}

function redactError(text: string): string {
  return text.replace(/Bearer\s+[A-Za-z0-9._\-]{16,}/gi, "Bearer ***")
}

async function chatQwenNativeSearch(args: ChatArgs & {
  apiKey: string
  baseUrl: string
  model: string
  timeoutSec: number
}): Promise<string> {
  if (!args.apiKey) {
    console.warn("[通义千问] API Key is undefined（请检查后台管理页中的模型配置）")
    throw new Error("通义千问 API Key 未配置，请在后台管理页补全后重试。")
  }

  const endpoint = dashScopeNativeEndpoint(args.baseUrl)
  const timeoutMs = Math.max(30, args.timeoutSec || 300) * 1000
  const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined
  const timer = setTimeout(() => controller?.abort(), timeoutMs)
  const messages: Array<{ role: "system" | "user"; content: string }> = []
  if (!args.rawQuestionOnly && args.system.trim()) {
    messages.push({ role: "system", content: args.system })
  }
  messages.push({ role: "user", content: args.user })

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      signal: controller?.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({
        model: args.model,
        input: { messages },
        parameters: {
          result_format: "message",
          temperature: args.temperature ?? 0,
          max_tokens: args.maxTokens ?? 1200,
          enable_search: true,
          search_options: {
            enable_source: true,
            forced_search: true,
          },
        },
      }),
    })
    clearTimeout(timer)

    const text = await response.text()
    let data: DashScopeResponse
    try {
      data = JSON.parse(text) as DashScopeResponse
    } catch (error) {
      throw new Error(`通义千问原生联网返回体解析失败：${error instanceof Error ? error.message : String(error)}`)
    }

    if (!response.ok) {
      const message = data.message || redactError(text).slice(0, 240) || "(无响应体)"
      throw new Error(`通义千问原生联网接口调用失败 HTTP ${response.status}：${message}`)
    }

    const choice = data.output?.choices?.[0]
    const answer = extractTextContent(choice?.message?.content) || data.output?.text || ""
    const sources = extractDashSources(data, args.user)
    args.onSearchSources?.({
      query: args.user,
      sources,
      mode: "native_web",
      failureReason: sources.length === 0 ? "DashScope 原生联网没有返回可审计来源。" : undefined,
    })

    if (!answer.trim()) {
      const finish = choice?.finish_reason || "unknown"
      throw new Error(`通义千问原生联网返回空内容（finish_reason=${finish}），请检查模型名或上游额度。`)
    }
    if (args.requireWebEvidence && sources.length === 0) {
      throw new Error("通义千问原生联网未返回可审计来源，已阻断模型自答。")
    }
    return answer
  } catch (error) {
    clearTimeout(timer)
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`通义千问原生联网请求超时 (${timeoutMs / 1000}s)，请稍后重试或增加后台超时时间。`)
    }
    throw error
  }
}

export async function chatQwen(args: ChatArgs): Promise<string> {
  const config = await getAiProviderRuntimeSetting("qwen")
  const enableOfficialSearch = config.extra.enableSearch === true
  const shouldSearch =
    args.forceWebSearch || (args.allowWebSearch !== false && args.mode !== "consumer")

  if (args.forceWebSearch && !enableOfficialSearch) {
    throw new Error("通义千问严格联网盲测需要在后台开启百炼官方联网搜索插件，当前已禁止本地检索兜底。")
  }

  if (
    args.forceWebSearch &&
    args.officialWebOnly &&
    args.requireWebEvidence &&
    args.mode === "consumer"
  ) {
    return chatQwenNativeSearch({
      ...args,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      timeoutSec: args.timeoutSec ?? config.timeout,
    })
  }

  const extraBody =
    shouldSearch && enableOfficialSearch
      ? {
          enable_search: true,
          search_options: { forced_search: true },
        }
      : undefined

  return openaiCompatChat({
    url: buildAiChatUrl(config),
    apiKey: config.apiKey,
    model: config.model,
    label: "通义千问",
    ...args,
    extraBody,
    timeoutSec: args.timeoutSec ?? config.timeout,
  })
}
