import { createHash } from "node:crypto"
import type { PenetrationSource } from "@/types"
import { sanitizeAiUpstreamMessage } from "@/lib/ai-secrets"
import { reserveRateLimit } from "@/lib/rate-limit"
import {
  dedupePenetrationSources,
  isAuditableSourceUrl,
  normalizeSourceDomain,
} from "./source-extract"

// Tencent's Yuanbao search, opened on Tencent Cloud on 2026-10-20: the engine
// the Yuanbao App searches with. Hunyuan's TokenHub web_search ran one search
// of about 8 pages per answer, where the App cites about 21, so detection
// searches here itself, several times per answer, as with DeepSeek.
//   https://cloud.tencent.com/document/product/1806/121811
// It carries no WeChat articles (copyright), which the App does cite.
export const YUANBAO_SEARCH_BASE_URL = "https://api.wsa.cloud.tencent.com"
const SEARCH_PATH = "/SearchPro"
// Standard and Lite allow 20 requests a second, Flagship 5; stay below.
const SEARCH_PER_SECOND = 12
const SEARCH_QUEUE_LIMIT_MS = 30_000
const SUMMARY_LIMIT = 900

interface YuanbaoPage {
  title?: string
  url?: string
  passage?: string
  content?: string
  site?: string
  date?: string
}

interface YuanbaoSearchResponse {
  Response?: {
    Pages?: string[]
    RequestId?: string
    Version?: string
    Error?: { Code?: string; Message?: string }
  }
}

export class YuanbaoWebSearchError extends Error {
  override name = "YuanbaoWebSearchError"
}

export interface YuanbaoWebSearchArgs {
  apiKey: string
  baseUrl?: string
  query: string
  timeoutSec: number
  signal?: AbortSignal
  /** Results per search: 10, 20, 30, 40 or 50 (not on the Lite plan). */
  count?: number
}

export interface YuanbaoWebSearchResult {
  query: string
  sources: PenetrationSource[]
  summaries: Record<string, string>
  requestId: string
}

// Tencent Cloud error codes, worded so the failure classifier sorts them.
function errorMessage(code: string, message: string): string {
  if (/ResourceUnavailable/i.test(code)) return `元宝搜索账号欠费或已停用（${code}）：${message}`
  if (/UnauthorizedOperation|AuthFailure/i.test(code)) return `元宝搜索鉴权失败 HTTP 401（${code}），请检查 API Key：${message}`
  if (/ResourceNotFound/i.test(code)) return `元宝搜索联网搜索服务未开通（${code}）：${message}`
  if (/RequestLimitExceeded|LimitExceeded/i.test(code)) return `元宝搜索请求频率超限 HTTP 429（${code}）：${message}`
  return `元宝搜索调用失败（${code}）：${message}`
}

async function waitForSearchSlot(apiKey: string, signal: AbortSignal): Promise<void> {
  const identifier = createHash("sha256").update(apiKey).digest("hex").slice(0, 24)
  const deadline = Date.now() + SEARCH_QUEUE_LIMIT_MS
  while (!(await reserveRateLimit("yuanbao-search", identifier, 1, SEARCH_PER_SECOND, 1)).ok) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError")
    if (Date.now() > deadline) return
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200))
  }
}

function validCount(count: number | undefined): number {
  const steps = [10, 20, 30, 40, 50]
  const wanted = Math.floor(count || 20)
  return steps.find(step => step >= wanted) ?? 50
}

export async function searchYuanbaoWeb(args: YuanbaoWebSearchArgs): Promise<YuanbaoWebSearchResult> {
  if (!args.apiKey) throw new YuanbaoWebSearchError("元宝搜索缺少 API Key。")
  const query = args.query.trim()
  if (!query) throw new YuanbaoWebSearchError("严格联网搜索词为空。")
  const timeoutSec = Math.max(5, Math.min(60, Math.floor(args.timeoutSec || 30)))
  const endpoint = new URL(SEARCH_PATH, new URL(args.baseUrl || YUANBAO_SEARCH_BASE_URL).origin).toString()
  const controller = new AbortController()
  const abortFromParent = () => controller.abort(args.signal?.reason)
  if (args.signal?.aborted) abortFromParent()
  else args.signal?.addEventListener("abort", abortFromParent, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutSec * 1000)

  const call = async (body: Record<string, unknown>) => {
    await waitForSearchSlot(args.apiKey, controller.signal)
    const response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: { "Content-Type": "application/json; charset=UTF-8", Authorization: `Bearer ${args.apiKey}` },
      body: JSON.stringify(body),
    })
    const text = await response.text()
    let data: YuanbaoSearchResponse = {}
    try {
      data = text ? JSON.parse(text) as YuanbaoSearchResponse : {}
    } catch {
      if (response.ok) throw new YuanbaoWebSearchError("元宝搜索返回体解析失败。")
    }
    const failure = data.Response?.Error
    if (failure?.Code) return { data, failure }
    if (!response.ok) {
      throw new YuanbaoWebSearchError(`元宝搜索调用失败 HTTP ${response.status}：${sanitizeAiUpstreamMessage(text, 260) || "(无响应体)"}`)
    }
    return { data, failure: undefined }
  }

  try {
    // Mixed results (open web plus Tencent's vetted sources), as the App shows.
    let result = await call({ Query: query, Mode: 2, Cnt: validCount(args.count) })
    // The Lite plan takes neither parameter.
    if (result.failure && /InvalidParameter/i.test(result.failure.Code || "")) {
      result = await call({ Query: query })
    }
    if (result.failure) {
      throw new YuanbaoWebSearchError(errorMessage(result.failure.Code || "", result.failure.Message || ""))
    }
    const summaries: Record<string, string> = {}
    const pages = (result.data.Response?.Pages || []).map(raw => {
      try {
        return JSON.parse(raw) as YuanbaoPage
      } catch {
        return null
      }
    })
    const sources = dedupePenetrationSources(pages
      .map((page): PenetrationSource | null => {
        if (!page) return null
        const url = page.url?.trim() || ""
        const title = page.title?.trim() || page.site?.trim() || ""
        const snippet = page.passage?.trim() || ""
        if (!isAuditableSourceUrl(url, title, snippet)) return null
        const clean = new URL(url).toString()
        const summary = (page.content?.trim() || snippet).slice(0, SUMMARY_LIMIT)
        if (summary) summaries[clean] = page.date ? `${page.date} ${summary}` : summary
        return { title: title || normalizeSourceDomain(clean), snippet: snippet.slice(0, 300), url: clean, domain: normalizeSourceDomain(clean), query }
      })
      .filter((source): source is PenetrationSource => !!source))
    const requestId = result.data.Response?.RequestId?.trim() || ""
    if (sources.length === 0) throw new YuanbaoWebSearchError("元宝搜索没有返回可点击、可读取的网页信源。")
    if (!requestId) throw new YuanbaoWebSearchError("元宝搜索没有返回可审计请求编号。")
    return { query, sources, summaries, requestId }
  } catch (error) {
    if (error instanceof YuanbaoWebSearchError) throw error
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new YuanbaoWebSearchError(
        args.signal?.aborted ? "元宝搜索已随后台任务取消。" : `元宝搜索请求超时 (${timeoutSec}s)。`,
      )
    }
    throw new YuanbaoWebSearchError(`元宝搜索请求失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
    args.signal?.removeEventListener("abort", abortFromParent)
  }
}
