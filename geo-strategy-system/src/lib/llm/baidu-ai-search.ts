import type { PenetrationSource } from "@/types"
import type { ChatArgs } from "./openai-compat"
import {
  dedupePenetrationSources,
  isAuditableSourceUrl,
  normalizeSourceDomain,
} from "./source-extract"

const BAIDU_AI_SEARCH_URL = "https://qianfan.baidubce.com/v2/ai_search/chat/completions"

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

export interface BaiduAiSearchArgs extends ChatArgs {
  apiKey: string
  model: string
  label: string
  timeoutSec: number
  modelAppId?: string
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
