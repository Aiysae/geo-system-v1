import { createHash } from "node:crypto"
import type { PenetrationSource } from "@/types"
import { sanitizeAiUpstreamMessage } from "@/lib/ai-secrets"
import { reserveRateLimit } from "@/lib/rate-limit"
import {
  dedupePenetrationSources,
  isAuditableSourceUrl,
  normalizeSourceDomain,
} from "./source-extract"

// Kimi's official search endpoint. Unlike the $web_search builtin, which keeps
// results on Moonshot's side, it returns each page's URL, title and snippet,
// so strict question detection can audit what the answer was based on.
//   https://platform.kimi.com/docs/api/tools-search
const MOONSHOT_SEARCH_PATH = "/v1/tools/search"

interface MoonshotSearchResult {
  url?: string
  title?: string
  snippet?: string
  site_name?: string
}

interface MoonshotSearchResponse {
  search_results?: MoonshotSearchResult[]
  error?: { message?: string; type?: string; code?: string }
}

export interface MoonshotWebSearchArgs {
  apiKey: string
  baseUrl: string
  query: string
  timeoutSec: number
  signal?: AbortSignal
  limit?: number
}

export interface MoonshotWebSearchResult {
  query: string
  sources: PenetrationSource[]
  requestId: string
}

export class MoonshotWebSearchError extends Error {
  override name = "MoonshotWebSearchError"
}

// Moonshot caps search at 1 QPS on Tier0 and 3 on Tier1, separately from chat
// concurrency. A detection job starts many questions at once, and each 429
// cools the whole route, so searches queue below the Tier1 cap instead.
const SEARCH_PER_SECOND = 2
const SEARCH_QUEUE_LIMIT_MS = 30_000

async function waitForSearchSlot(apiKey: string, signal: AbortSignal): Promise<void> {
  const identifier = createHash("sha256").update(apiKey).digest("hex").slice(0, 24)
  const deadline = Date.now() + SEARCH_QUEUE_LIMIT_MS
  while (!(await reserveRateLimit("moonshot-search", identifier, 1, SEARCH_PER_SECOND, 1)).ok) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError")
    // Past the deadline, send anyway and let the provider decide.
    if (Date.now() > deadline) return
    await new Promise(resolve => setTimeout(resolve, 150 + Math.random() * 250))
  }
}

/** The search endpoint lives on the API origin, whatever chat path the account uses. */
export function moonshotSearchUrl(baseUrl: string): string {
  const origin = new URL(baseUrl)
  const host = origin.hostname.toLowerCase()
  if (host !== "moonshot.cn" && !host.endsWith(".moonshot.cn")) {
    throw new MoonshotWebSearchError("Kimi 联网搜索必须使用 Moonshot 国内官方 API 地址。")
  }
  return new URL(MOONSHOT_SEARCH_PATH, origin.origin).toString()
}

export async function searchMoonshotWeb(
  args: MoonshotWebSearchArgs,
): Promise<MoonshotWebSearchResult> {
  if (!args.apiKey) throw new MoonshotWebSearchError("Kimi 联网搜索缺少 Moonshot API Key。")
  const query = args.query.trim()
  if (!query) throw new MoonshotWebSearchError("严格联网搜索词为空。")

  const timeoutSec = Math.max(5, Math.min(60, Math.floor(args.timeoutSec || 30)))
  const controller = new AbortController()
  const abortFromParent = () => controller.abort(args.signal?.reason)
  if (args.signal?.aborted) abortFromParent()
  else args.signal?.addEventListener("abort", abortFromParent, { once: true })
  // Leave the server its own timeout before the client gives up.
  const timer = setTimeout(() => controller.abort(), (timeoutSec + 10) * 1000)

  try {
    const endpoint = moonshotSearchUrl(args.baseUrl)
    await waitForSearchSlot(args.apiKey, controller.signal)
    const response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({
        text_query: query,
        limit: Math.max(1, Math.min(20, Math.floor(args.limit || 20))),
        timeout_seconds: timeoutSec,
      }),
    })
    const text = await response.text()
    let data: MoonshotSearchResponse = {}
    try {
      data = text ? JSON.parse(text) as MoonshotSearchResponse : {}
    } catch {
      if (response.ok) throw new MoonshotWebSearchError("Kimi 联网搜索返回体解析失败。")
    }
    if (!response.ok) {
      const detail = data.error?.message || sanitizeAiUpstreamMessage(text, 260) || "(无响应体)"
      throw new MoonshotWebSearchError(`Kimi 联网搜索调用失败 HTTP ${response.status}：${detail}`)
    }

    const sources = dedupePenetrationSources((data.search_results || [])
      .map((result): PenetrationSource | null => {
        const url = result.url?.trim() || ""
        const title = result.title?.trim() || result.site_name?.trim() || ""
        const snippet = result.snippet?.trim() || ""
        if (!isAuditableSourceUrl(url, title, snippet)) return null
        const clean = new URL(url).toString()
        return { title: title || normalizeSourceDomain(clean), snippet, url: clean, domain: normalizeSourceDomain(clean), query }
      })
      .filter((source): source is PenetrationSource => !!source))
    const requestId = response.headers.get("x-msh-track-id")?.trim() || ""
    if (sources.length === 0) {
      throw new MoonshotWebSearchError("Kimi 联网搜索没有返回可点击、可读取的网页信源。")
    }
    if (!requestId) throw new MoonshotWebSearchError("Kimi 联网搜索没有返回可审计请求编号。")
    return { query, sources, requestId }
  } catch (error) {
    if (error instanceof MoonshotWebSearchError) throw error
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new MoonshotWebSearchError(
        args.signal?.aborted ? "Kimi 联网搜索已随后台任务取消。" : `Kimi 联网搜索请求超时 (${timeoutSec}s)。`,
      )
    }
    throw new MoonshotWebSearchError(
      `Kimi 联网搜索请求失败：${error instanceof Error ? error.message : String(error)}`,
    )
  } finally {
    clearTimeout(timer)
    args.signal?.removeEventListener("abort", abortFromParent)
  }
}
