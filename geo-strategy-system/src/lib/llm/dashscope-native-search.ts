import type { PenetrationSource } from "@/types"
import type { ChatArgs } from "./openai-compat"
import {
  dedupePenetrationSources,
  extractSourcesFromUnknown,
  isAuditableSourceUrl,
  normalizeSourceDomain,
} from "./source-extract"
import { emitPenetrationRequestAudit } from "./blind-request-audit"

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
  request_id?: string
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
  usage?: {
    plugins?: {
      search?: { count?: number }
    }
  }
}

export interface DashScopeNativeSearchArgs extends ChatArgs {
  apiKey: string
  baseUrl: string
  model: string
  timeoutSec: number
  label: string
  searchMode?: "native_web" | "provider_hosted_web"
  modelProvider?: string
}

function nativeEndpoint(baseUrl: string): string {
  const parsed = new URL(baseUrl)
  if (!/(\.|^)dashscope\.aliyuncs\.com$/i.test(parsed.hostname)) {
    throw new Error(`${parsed.hostname} 不是百炼官方地址，无法执行严格联网盲测。`)
  }
  return `${parsed.origin}/api/v1/services/aigc/text-generation/generation`
}

function extractText(content: DashScopeContent): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map(part => part.text || part.content || "")
    .filter(Boolean)
    .join("\n")
}

function sourceFromResult(
  result: Record<string, unknown>,
  query: string,
): PenetrationSource | null {
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

function extractSources(data: DashScopeResponse, query: string): PenetrationSource[] {
  const direct = (data.output?.search_info?.search_results || [])
    .map(result => sourceFromResult(result, query))
    .filter((source): source is PenetrationSource => !!source)
  return dedupePenetrationSources([
    ...direct,
    ...extractSourcesFromUnknown(data, query),
  ])
}

function safeError(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._\-]{16,}/gi, "Bearer ***")
    .replace(/\s+/g, " ")
    .slice(0, 240)
}

export async function chatDashScopeNativeSearch(
  args: DashScopeNativeSearchArgs,
): Promise<string> {
  if (!args.apiKey) {
    throw new Error(`${args.label} 严格联网需要配置阿里云百炼 API Key。`)
  }

  const endpoint = nativeEndpoint(args.baseUrl)
  const timeoutMs = Math.max(30, args.timeoutSec || 300) * 1000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const messages: Array<{ role: "system" | "user"; content: string }> = []
  if (!args.rawQuestionOnly && args.system.trim()) {
    messages.push({ role: "system", content: args.system })
  }
  messages.push({ role: "user", content: args.user })
  const searchMode = args.searchMode ?? "native_web"
  const parameters = {
    result_format: "message",
    temperature: args.temperature ?? 0,
    max_tokens: args.maxTokens ?? 1200,
    enable_search: true,
    search_options: {
      forced_search: true,
      search_strategy: "max",
      enable_source: true,
      enable_citation: true,
      citation_format: "[<number>]",
    },
  }
  const payload = {
    model: args.model,
    input: { messages },
    parameters,
  }
  emitPenetrationRequestAudit(args, {
    endpoint,
    model: args.model,
    modelProvider: args.modelProvider ?? "alibaba_dashscope",
    searchProvider: "alibaba_dashscope",
    searchMode,
    messages,
    tools: [{ type: "web_search" }],
  })

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify(payload),
    })
    const text = await response.text()
    let data: DashScopeResponse
    try {
      data = JSON.parse(text) as DashScopeResponse
    } catch (error) {
      throw new Error(`${args.label} 百炼联网返回体解析失败：${error instanceof Error ? error.message : String(error)}`)
    }

    if (!response.ok) {
      throw new Error(
        `${args.label} 百炼联网接口调用失败 HTTP ${response.status}：${data.message || safeError(text) || "(无响应体)"}`,
      )
    }

    const choice = data.output?.choices?.[0]
    const answer = extractText(choice?.message?.content) || data.output?.text || ""
    const sources = extractSources(data, args.user)
    const searchExecuted =
      sources.length > 0 || Number(data.usage?.plugins?.search?.count || 0) > 0
    args.onSearchSources?.({
      query: args.user,
      sources,
      mode: searchMode,
      searchExecuted,
      providerRequestId: data.request_id,
      failureReason: searchExecuted
        ? undefined
        : "百炼强制联网请求没有返回搜索执行证据。",
    })

    if (!answer.trim()) {
      const finish = choice?.finish_reason || "unknown"
      throw new Error(`${args.label} 百炼联网返回空内容（finish_reason=${finish}）。`)
    }
    if (args.requireWebEvidence && sources.length === 0) {
      const searchResultCount = data.output?.search_info?.search_results?.length || 0
      throw new Error(
        `${args.label} 百炼联网未返回可审计来源（search_results=${searchResultCount}），已阻断模型自答。`,
      )
    }
    return answer
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`${args.label} 百炼联网请求超时 (${timeoutMs / 1000}s)。`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
