import type { PenetrationSource } from "@/types"
import { sanitizeAiUpstreamMessage } from "@/lib/ai-secrets"
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

/**
 * Search strategy per model. Agent search runs several rounds of searching,
 * as the Qwen App does; on 2026-10-21 it halved the gap to answers sampled
 * from the App (24 to 12 points, sources 9 to 24) at the same search price.
 * Bailian offers it on Qwen 3.5 to 3.7 only, and only over a stream.
 */
export function dashScopeSearchStrategy(model: string): "agent" | "max" {
  return /^qwen3\.[5-7](?:-|$)/i.test(model.trim()) ? "agent" : "max"
}

/** Folds a DashScope SSE stream into the shape of one non-streamed response. */
export function mergeDashScopeStream(text: string): DashScopeResponse {
  let answer = ""
  let finishReason: string | undefined
  let requestId: string | undefined
  let usage: DashScopeResponse["usage"]
  let failure: { code?: string; message?: string } | undefined
  // Agent search reports each round's results; keep every distinct page.
  const results = new Map<string, Record<string, unknown>>()
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue
    let event: DashScopeResponse
    try {
      event = JSON.parse(line.slice(5)) as DashScopeResponse
    } catch {
      continue
    }
    if (event.code && !event.output) failure = { code: event.code, message: event.message }
    requestId ||= event.request_id
    const choice = event.output?.choices?.[0]
    answer += extractText(choice?.message?.content)
    if (choice?.finish_reason && choice.finish_reason !== "null") finishReason = choice.finish_reason
    for (const result of event.output?.search_info?.search_results || []) {
      const key = String(result.url || result.link || JSON.stringify(result))
      results.set(key, result)
    }
    if (event.usage) usage = event.usage
  }
  return {
    ...(failure ? { code: failure.code, message: failure.message } : {}),
    request_id: requestId,
    output: {
      choices: [{ finish_reason: finishReason, message: { role: "assistant", content: answer } }],
      search_info: { search_results: [...results.values()] },
    },
    usage,
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
  return sanitizeAiUpstreamMessage(text, 240)
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
  const strategy = dashScopeSearchStrategy(args.model)
  const streamed = strategy === "agent"
  const parameters = {
    result_format: "message",
    // Unset means the provider default, which is what app users get.
    ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
    // Agent rounds and thinking need room beyond a short answer's budget.
    max_tokens: streamed ? Math.max(args.maxTokens ?? 1200, 4096) : args.maxTokens ?? 1200,
    ...(streamed ? { incremental_output: true, enable_thinking: true } : {}),
    enable_search: true,
    search_options: {
      forced_search: true,
      search_strategy: strategy,
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
        ...(streamed ? { "X-DashScope-SSE": "enable" } : {}),
      },
      body: JSON.stringify(payload),
    })
    const text = await response.text()
    let data: DashScopeResponse
    try {
      // Errors come back as one JSON body even on a streamed request.
      data = streamed && response.ok && /^\s*(?:id:|event:|data:)/.test(text)
        ? mergeDashScopeStream(text)
        : JSON.parse(text) as DashScopeResponse
    } catch (error) {
      throw new Error(`${args.label} 百炼联网返回体解析失败：${error instanceof Error ? error.message : String(error)}`)
    }
    if (response.ok && data.code && !data.output?.choices?.[0]?.message?.content) {
      throw new Error(`${args.label} 百炼联网接口调用失败：${data.code} ${data.message || ""}`.trim())
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
