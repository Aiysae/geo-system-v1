import type { PenetrationSource } from "@/types"
import { sanitizeAiUpstreamMessage } from "@/lib/ai-secrets"
import {
  dedupePenetrationSources,
  isAuditableSourceUrl,
  normalizeSourceDomain,
} from "./source-extract"

// DeepSeek's own search and page reader, opened to developers on 2026-10-17
// and billed to the same account and key as chat. It is the engine behind
// the DeepSeek App, so detection no longer borrows Kimi or Baidu search.
//   https://api-docs.deepseek.com/guides/search
const SEARCH_URL = "https://api.deepseek.com/v1/tools/search"
const FETCH_URL = "https://api.deepseek.com/v1/tools/fetch"
// The model reads the long summary; the report keeps the short snippet.
const SUMMARY_LIMIT = 900

interface DeepSeekSearchItem {
  title?: string
  url?: string
  snippet?: string
  summary?: string
  site_name?: string | null
}

interface DeepSeekToolError {
  error?: { message?: string; code?: string }
}

export class DeepSeekWebSearchError extends Error {
  override name = "DeepSeekWebSearchError"
}

export interface DeepSeekWebSearchArgs {
  apiKey: string
  query: string
  /** The user's question, which DeepSeek uses to understand the query. */
  question?: string
  timeoutSec: number
  signal?: AbortSignal
  count?: number
}

export interface DeepSeekWebSearchResult {
  query: string
  sources: PenetrationSource[]
  /** Longer per-page summaries, by URL, for the model to read. */
  summaries: Record<string, string>
  requestId: string
}

async function postTool(
  url: string,
  apiKey: string,
  body: unknown,
  timeoutSec: number,
  signal: AbortSignal | undefined,
  label: string,
): Promise<{ data: unknown; requestId: string }> {
  const controller = new AbortController()
  const abortFromParent = () => controller.abort(signal?.reason)
  if (signal?.aborted) abortFromParent()
  else signal?.addEventListener("abort", abortFromParent, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutSec * 1000)
  try {
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    })
    const text = await response.text()
    let data: unknown = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      if (response.ok) throw new DeepSeekWebSearchError(`${label}返回体解析失败。`)
    }
    if (!response.ok) {
      const detail = (data as DeepSeekToolError).error?.message || sanitizeAiUpstreamMessage(text, 260) || "(无响应体)"
      throw new DeepSeekWebSearchError(`${label}调用失败 HTTP ${response.status}：${detail}`)
    }
    return { data, requestId: response.headers.get("x-ds-trace-id")?.trim() || "" }
  } catch (error) {
    if (error instanceof DeepSeekWebSearchError) throw error
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new DeepSeekWebSearchError(
        signal?.aborted ? `${label}已随后台任务取消。` : `${label}请求超时 (${timeoutSec}s)。`,
      )
    }
    throw new DeepSeekWebSearchError(`${label}请求失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", abortFromParent)
  }
}

export async function searchDeepSeekWeb(args: DeepSeekWebSearchArgs): Promise<DeepSeekWebSearchResult> {
  if (!args.apiKey) throw new DeepSeekWebSearchError("DeepSeek 联网搜索缺少 API Key。")
  const query = args.query.trim().slice(0, 128)
  if (!query) throw new DeepSeekWebSearchError("严格联网搜索词为空。")
  const question = args.question?.trim().slice(0, 128)
  const { data, requestId } = await postTool(SEARCH_URL, args.apiKey, {
    query,
    count: Math.max(1, Math.min(50, Math.floor(args.count || 10))),
    ...(question ? { ori_question: question } : {}),
  }, Math.max(5, Math.min(60, Math.floor(args.timeoutSec || 30))), args.signal, "DeepSeek 联网搜索")

  const summaries: Record<string, string> = {}
  const items = (data as { results?: DeepSeekSearchItem[] }).results || []
  const sources = dedupePenetrationSources(items
    .map((item): PenetrationSource | null => {
      const url = item.url?.trim() || ""
      const title = item.title?.trim() || item.site_name?.trim() || ""
      const snippet = item.snippet?.trim() || ""
      if (!isAuditableSourceUrl(url, title, snippet)) return null
      const clean = new URL(url).toString()
      const summary = item.summary?.trim()
      if (summary) summaries[clean] = summary.slice(0, SUMMARY_LIMIT)
      return { title: title || normalizeSourceDomain(clean), snippet, url: clean, domain: normalizeSourceDomain(clean), query }
    })
    .filter((source): source is PenetrationSource => !!source))
  if (sources.length === 0) throw new DeepSeekWebSearchError("DeepSeek 联网搜索没有返回可点击、可读取的网页信源。")
  if (!requestId) throw new DeepSeekWebSearchError("DeepSeek 联网搜索没有返回可审计请求编号。")
  return { query, sources, summaries, requestId }
}

/** One page as Markdown, through DeepSeek's reader. */
export async function fetchDeepSeekPage(
  apiKey: string,
  url: string,
  signal?: AbortSignal,
): Promise<{ title: string; markdown: string }> {
  const { data } = await postTool(FETCH_URL, apiKey, { url }, 30, signal, "DeepSeek 网页读取")
  const page = data as { title?: string; content?: string }
  const markdown = page.content?.trim() || ""
  // WeChat answers a reader with its "环境异常" check page.
  if (!markdown || /^环境异常/.test(markdown)) throw new DeepSeekWebSearchError("网页无法读取。")
  return { title: page.title?.trim() || "", markdown }
}
