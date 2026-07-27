import type { PenetrationSource } from "@/types"
import type { ChatArgs } from "./openai-compat"
import { emitPenetrationRequestAudit } from "./blind-request-audit"
import {
  dedupePenetrationSources,
  isAuditableSourceUrl,
  normalizeSourceDomain,
} from "./source-extract"

const BAIDU_AI_SEARCH_URL = "https://qianfan.baidubce.com/v2/ai_search/chat/completions"
const BAIDU_WEB_SEARCH_URL = "https://qianfan.baidubce.com/v2/ai_search/web_search"

interface BaiduAiSearchReference {
  type?: string
  title?: string
  content?: string
  url?: string
  website?: string
}

interface BaiduAiSearchResponse {
  request_id?: string
  requestId?: string
  code?: string | number
  message?: string
  choices?: Array<{
    finish_reason?: string
    message?: { content?: string; role?: string }
  }>
  references?: BaiduAiSearchReference[]
}

interface BaiduWebSearchResponse {
  request_id?: string
  requestId?: string
  code?: string | number
  message?: string
  references?: BaiduAiSearchReference[]
}

export interface BaiduAiSearchArgs extends ChatArgs {
  apiKey: string
  model: string
  label: string
  timeoutSec: number
  modelAppId?: string
}

export interface BaiduWebSearchArgs {
  apiKey: string
  query: string
  timeoutSec: number
  signal?: AbortSignal
  topK?: number
}

export interface BaiduWebSearchResult {
  query: string
  sources: PenetrationSource[]
  requestId: string
}

export class BaiduWebSearchError extends Error {
  override name = "BaiduWebSearchError"
}

function safeError(text: string): string {
  return text
    .replace(/bce-v3\/[A-Za-z0-9_\-/]+/g, "bce-v3/***")
    .replace(/Bearer\s+[A-Za-z0-9._\-/]{16,}/gi, "Bearer ***")
    .replace(/\s+/g, " ")
    .slice(0, 260)
}

function extractWebSources(
  references: BaiduAiSearchReference[],
  query: string,
): PenetrationSource[] {
  const sources = references
    .filter(reference => !reference.type || reference.type === "web")
    .map((reference): PenetrationSource | null => {
      const url = reference.url?.trim() || ""
      const title = reference.title?.trim() || reference.website?.trim() || ""
      const snippet = reference.content?.trim() || ""
      if (!isAuditableSourceUrl(url, title, snippet)) return null
      const clean = new URL(url).toString()
      return {
        title: title || normalizeSourceDomain(clean),
        snippet,
        url: clean,
        domain: normalizeSourceDomain(clean),
        query,
      }
    })
    .filter((source): source is PenetrationSource => !!source)
  return dedupePenetrationSources(sources)
}

export async function searchBaiduWeb(
  args: BaiduWebSearchArgs,
): Promise<BaiduWebSearchResult> {
  if (!args.apiKey) {
    throw new BaiduWebSearchError("严格联网需要配置百度千帆搜索 API Key。")
  }

  const query = args.query.trim()
  if (!query) throw new BaiduWebSearchError("严格联网搜索词为空。")
  const timeoutMs = Math.max(30, args.timeoutSec || 180) * 1000
  const controller = new AbortController()
  const abortFromParent = () => controller.abort(args.signal?.reason)
  if (args.signal?.aborted) abortFromParent()
  else args.signal?.addEventListener("abort", abortFromParent, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(BAIDU_WEB_SEARCH_URL, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.apiKey}`,
        "X-Appbuilder-Authorization": `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: query }],
        search_source: "baidu_search_v2",
        resource_type_filter: [{
          type: "web",
          top_k: Math.max(1, Math.min(20, Math.floor(args.topK || 20))),
        }],
      }),
    })
    const text = await response.text()
    let data: BaiduWebSearchResponse
    try {
      data = JSON.parse(text) as BaiduWebSearchResponse
    } catch (error) {
      throw new BaiduWebSearchError(
        `百度联网搜索返回体解析失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }

    const hasErrorCode = data.code !== undefined && data.code !== 0 && data.code !== "0"
    if (!response.ok || hasErrorCode) {
      throw new BaiduWebSearchError(
        `百度联网搜索调用失败 HTTP ${response.status}${data.code ? ` [${data.code}]` : ""}：${data.message || safeError(text) || "(无响应体)"}`,
      )
    }

    const sources = extractWebSources(data.references || [], query)
    const requestId = (data.request_id || data.requestId || "").trim()
    if (sources.length === 0) {
      throw new BaiduWebSearchError("百度联网搜索没有返回可点击、可读取的网页信源。")
    }
    if (!requestId) {
      throw new BaiduWebSearchError("百度联网搜索没有返回可审计请求编号。")
    }
    return { query, sources, requestId }
  } catch (error) {
    if (error instanceof BaiduWebSearchError) throw error
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new BaiduWebSearchError(
        args.signal?.aborted
          ? "百度联网搜索已随后台任务取消。"
          : `百度联网搜索请求超时 (${timeoutMs / 1000}s)。`,
      )
    }
    throw new BaiduWebSearchError(
      `百度联网搜索请求失败：${error instanceof Error ? error.message : String(error)}`,
    )
  } finally {
    clearTimeout(timer)
    args.signal?.removeEventListener("abort", abortFromParent)
  }
}

export async function chatBaiduAiSearch(args: BaiduAiSearchArgs): Promise<string> {
  if (!args.apiKey) {
    throw new Error(`${args.label} 严格联网需要配置百度千帆 API Key。`)
  }

  const timeoutMs = Math.max(30, args.timeoutSec || 180) * 1000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const body: Record<string, unknown> = {
    messages: [{ role: "user", content: args.user }],
    stream: false,
    model: args.model,
    search_source: "baidu_search_v2",
    resource_type_filter: [{ type: "web", top_k: 20 }],
    search_mode: "required",
    enable_deep_search: false,
    enable_followup_queries: false,
    enable_corner_markers: true,
    max_refer_search_items: 20,
    max_completion_tokens: args.maxTokens ?? 2048,
    temperature: 0.01,
  }
  if (args.modelAppId?.trim()) body.model_appid = args.modelAppId.trim()
  emitPenetrationRequestAudit(args, {
    endpoint: BAIDU_AI_SEARCH_URL,
    model: args.model,
    modelProvider: "baidu_qianfan",
    searchProvider: "baidu_search",
    searchMode: "native_web",
    messages: body.messages as Array<{ role: string; content: string }>,
    tools: [{ type: "web_search" }],
  })

  try {
    const response = await fetch(BAIDU_AI_SEARCH_URL, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.apiKey}`,
        "X-Appbuilder-Authorization": `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify(body),
    })
    const text = await response.text()
    let data: BaiduAiSearchResponse
    try {
      data = JSON.parse(text) as BaiduAiSearchResponse
    } catch (error) {
      throw new Error(`${args.label} 百度 AI 搜索返回体解析失败：${error instanceof Error ? error.message : String(error)}`)
    }

    const hasErrorCode = data.code !== undefined && data.code !== 0 && data.code !== "0"
    if (!response.ok || hasErrorCode) {
      throw new Error(
        `${args.label} 百度 AI 搜索调用失败 HTTP ${response.status}${data.code ? ` [${data.code}]` : ""}：${data.message || safeError(text) || "(无响应体)"}`,
      )
    }

    const choice = data.choices?.[0]
    const answer = choice?.message?.content || ""
    const references = data.references || []
    const sources = extractWebSources(references, args.user)
    const requestId = data.request_id || data.requestId
    args.onSearchSources?.({
      query: args.user,
      sources,
      mode: "native_web",
      searchExecuted: references.some(reference => reference.type === "web" || !!reference.url),
      providerRequestId: requestId,
      failureReason: sources.length > 0
        ? undefined
        : "百度 AI 搜索没有返回可读取的网页信源。",
    })

    if (!answer.trim()) {
      throw new Error(`${args.label} 百度 AI 搜索返回空内容（finish_reason=${choice?.finish_reason || "unknown"}）。`)
    }
    if (args.requireWebEvidence && sources.length === 0) {
      throw new Error(`${args.label} 百度 AI 搜索未返回可审计网页来源，已进入后台补采。`)
    }
    if (!requestId?.trim()) {
      throw new Error(`${args.label} 百度 AI 搜索未返回请求编号，已进入后台补采。`)
    }
    return answer
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`${args.label} 百度 AI 搜索请求超时 (${timeoutMs / 1000}s)。`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
