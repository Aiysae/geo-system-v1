import type { PenetrationSource } from "@/types"
import { searchBaiduWeb } from "./baidu-ai-search"
import { searchMoonshotWeb } from "./moonshot-web-search"
import { fetchDeepSeekPage, searchDeepSeekWeb } from "./deepseek-web-search"
import { searchYuanbaoWeb } from "./yuanbao-web-search"
import { emitPenetrationRequestAudit } from "./blind-request-audit"
import { extractArticleFromUrl } from "@/lib/article-extract"
import { openaiCompatRaw, type ChatArgs } from "./openai-compat"

const SEARCH_TOOL = {
  type: "function",
  function: {
    name: "search_web",
    description: "搜索公开互联网中的实时信息，并返回网页标题、摘要和网址。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "需要在公开互联网中检索的内容。",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
}

const OPEN_PAGE_TOOL = {
  type: "function",
  function: {
    name: "open_page",
    description: "打开一个搜索结果网页，读取它的正文内容。",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "要打开的网页地址，必须来自搜索结果。",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
}

// Enough of a page for a ranking list or a company profile.
const PAGE_TEXT_LIMIT = 6_000

export interface AuditableWebSearchResult {
  query: string
  sources: PenetrationSource[]
  /** Longer per-page summaries, by URL, given to the model instead of the snippet. */
  summaries?: Record<string, string>
  requestId: string
}

/** A search engine that returns every result's URL and an auditable request id. */
export interface AuditableWebSearch {
  provider: "baidu_search" | "moonshot_search" | "deepseek_search" | "yuanbao_search"
  run(query: string, signal?: AbortSignal): Promise<AuditableWebSearchResult>
  /** The engine's own page reader, when it has one. */
  readPage?(url: string, signal?: AbortSignal): Promise<{ title: string; markdown: string }>
}

export function baiduAuditableSearch(
  apiKey: string,
  timeoutSec: number,
  limit = 20,
): AuditableWebSearch {
  return {
    provider: "baidu_search",
    run: (query, signal) => searchBaiduWeb({ apiKey, query, timeoutSec, signal, topK: limit }),
  }
}

export function moonshotAuditableSearch(
  apiKey: string,
  baseUrl: string,
  timeoutSec: number,
  limit = 20,
): AuditableWebSearch {
  return {
    provider: "moonshot_search",
    run: (query, signal) => searchMoonshotWeb({ apiKey, baseUrl, query, timeoutSec, signal, limit }),
  }
}

/** DeepSeek's own engine, on the account that answers. */
export function deepseekAuditableSearch(
  apiKey: string,
  timeoutSec: number,
  limit: number,
  question: string,
): AuditableWebSearch {
  return {
    provider: "deepseek_search",
    run: (query, signal) => searchDeepSeekWeb({ apiKey, query, question, timeoutSec, signal, count: limit }),
    // Its reader, then ours for the sites it is turned away from.
    readPage: (url, signal) => fetchDeepSeekPage(apiKey, url, signal).catch(() => extractArticleFromUrl(url)),
  }
}

export function yuanbaoAuditableSearch(
  apiKey: string,
  baseUrl: string,
  timeoutSec: number,
  limit: number,
): AuditableWebSearch {
  return {
    provider: "yuanbao_search",
    run: (query, signal) => searchYuanbaoWeb({ apiKey, baseUrl, query, timeoutSec, signal, count: limit }),
  }
}

interface AuditableExternalSearchArgs {
  args: ChatArgs
  endpoint: string
  apiKey: string
  model: string
  label: string
  modelProvider: string
  search: AuditableWebSearch
  requestTimeoutSec: number
  temperature?: number
  extraBody?: Record<string, unknown>
  /** Distinct searches one answer may run (default 2). */
  maxSearches?: number
  /** Search results the model may open and read in full (default none). */
  pageReads?: number
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map(part => {
      if (!part || typeof part !== "object" || !("text" in part)) return ""
      const text = (part as { text?: unknown }).text
      return typeof text === "string" ? text : ""
    })
    .filter(Boolean)
    .join("\n")
}

function searchQuery(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback
  try {
    const parsed = JSON.parse(raw) as { query?: unknown }
    if (typeof parsed.query === "string" && parsed.query.trim()) {
      return parsed.query.trim()
    }
  } catch {
    // The untouched question remains the safe fallback for malformed arguments.
  }
  return fallback
}

function pageUrl(raw: unknown): string {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw || "{}") : raw
    const value = parsed && typeof parsed === "object" ? (parsed as { url?: unknown }).url : undefined
    return typeof value === "string" && value.trim() ? new URL(value.trim()).toString() : ""
  } catch {
    return ""
  }
}

function searchQueryKey(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLocaleLowerCase()
}

// A final turn that only announces more searching ("让我再搜索一些……") when no
// tool may run. It is not an answer, and it names no brands.
const SEARCH_INTENT_TAIL_RE =
  /(?:让我|我(?:需要|将|会|来|再)|接下来|继续|再)[^。！？\n]{0,12}(?:搜索|查询|检索|查找|执行)|(?:搜索|查询)\s*\d+\s*[:：]|让我执行/u

export function isUnfinishedSearchAnswer(content: string): boolean {
  const text = content.trim()
  if (!text) return false
  const tail = text.slice(-160)
  if (!SEARCH_INTENT_TAIL_RE.test(tail)) return false
  // A complete answer may close by offering to search more; it ends on a
  // question or a full stop, while a stalled turn ends on a colon or mid-plan.
  return /[:：]\s*$/u.test(text) || text.length < 200 || /(?:搜索|查询)\s*\d+\s*[:：]/u.test(tail)
}

export async function chatWithAuditableExternalSearch(
  input: AuditableExternalSearchArgs,
): Promise<string> {
  const { args } = input
  const messages: Array<Record<string, unknown>> = [
    { role: "user", content: args.user },
  ]
  // The consumer apps search more than once for list questions; one search
  // and a forced answer left the model announcing searches it could not run.
  // The DeepSeek App also opens a few results and reads them in full.
  const maxUniqueSearches = Math.max(1, input.maxSearches ?? 2)
  const maxPageReads = Math.max(0, input.pageReads ?? 0)
  const tools = maxPageReads > 0 ? [SEARCH_TOOL, OPEN_PAGE_TOOL] : [SEARCH_TOOL]
  // Each round is a chat request, which the router's per-minute budget counts.
  const maxRounds = maxPageReads > 0 ? 6 : 4
  emitPenetrationRequestAudit(args, {
    endpoint: input.endpoint,
    model: input.model,
    modelProvider: input.modelProvider,
    searchProvider: input.search.provider,
    searchMode: "external_tool_web",
    messages,
    tools,
  })

  const auditableUrls = new Set<string>()
  // Promises, so the same query twice in one turn runs one search.
  const searchPayloads = new Map<string, Promise<string>>()
  const openedPages = new Map<string, Promise<string>>()
  let searchExecuted = false
  let forceFinalAnswer = false

  for (let round = 0; round < maxRounds; round += 1) {
    const data = await openaiCompatRaw({
      url: input.endpoint,
      apiKey: input.apiKey,
      model: input.model,
      label: input.label,
      messages,
      temperature: input.temperature,
      maxTokens: args.maxTokens,
      seed: args.seed,
      jsonMode: false,
      tools,
      toolChoice: forceFinalAnswer || round === maxRounds - 1
        ? "none"
        : searchExecuted ? "auto" : "required",
      extraBody: input.extraBody,
      timeoutMs: Math.max(30, input.requestTimeoutSec) * 1000,
      signal: args.signal,
    })
    const choice = data.choices?.[0]
    if (!choice) throw new Error(`${input.label} 返回结构异常：缺少 choices。`)
    const message = choice.message

    if (data.id?.trim()) {
      args.onSearchSources?.({
        query: args.user,
        sources: [],
        mode: "external_tool_web",
        searchExecuted: false,
        providerRequestId: data.id.trim(),
      })
    }

    // hy3 can mark a turn that calls tools as finished ("stop"); the calls
    // are what count.
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      if (forceFinalAnswer) {
        throw new Error(`${input.label} 已取得联网证据但仍未返回最终回答。`)
      }
      messages.push({
        role: "assistant",
        content: messageText(message.content),
        tool_calls: message.tool_calls,
        // Thinking models expect their reasoning back alongside the calls.
        ...(typeof message.reasoning_content === "string" && message.reasoning_content
          ? { reasoning_content: message.reasoning_content }
          : {}),
      })
      // Budgets are assigned in call order, then the calls run together, as
      // the App runs several searches at once.
      let searchBudget = maxUniqueSearches - searchPayloads.size
      let pageBudget = maxPageReads - openedPages.size
      const results = await Promise.all(message.tool_calls.map(async toolCall => {
        const name = toolCall.function?.name ?? "unknown"
        if (name === "search_web") {
          const query = searchQuery(toolCall.function.arguments, args.user)
          const queryKey = searchQueryKey(query)
          const pending = searchPayloads.get(queryKey)
          if (pending) return { toolCall, name, content: await pending }
          if (searchBudget <= 0) {
            return {
              toolCall,
              name,
              content: JSON.stringify({
                query,
                error: `本次回答最多执行 ${maxUniqueSearches} 条唯一联网检索，请使用已有证据直接回答。`,
              }),
            }
          }
          searchBudget -= 1
          const run = (async () => {
            const search = await input.search.run(query, args.signal)
            searchExecuted = true
            for (const source of search.sources) auditableUrls.add(source.url)
            args.onSearchSources?.({
              query: search.query,
              sources: search.sources,
              mode: "external_tool_web",
              searchExecuted: true,
              providerRequestId: search.requestId,
            })
            return JSON.stringify({
              query: search.query,
              results: search.sources.map(source => ({
                title: source.title,
                url: source.url,
                snippet: search.summaries?.[source.url] || source.snippet,
                domain: source.domain,
              })),
            })
          })()
          searchPayloads.set(queryKey, run)
          return { toolCall, name, content: await run }
        }
        if (name === "open_page" && maxPageReads > 0) {
          const url = pageUrl(toolCall.function.arguments)
          const pending = url ? openedPages.get(url) : undefined
          if (pending) return { toolCall, name, content: await pending }
          // Only pages the search returned, so every page read stays auditable.
          if (!url || !auditableUrls.has(url)) {
            return { toolCall, name, content: JSON.stringify({ error: "只能打开本次搜索结果中的网页。" }) }
          }
          if (pageBudget <= 0) {
            return { toolCall, name, content: JSON.stringify({ error: `本次回答最多打开 ${maxPageReads} 个网页，请直接作答。` }) }
          }
          pageBudget -= 1
          const read = (input.search.readPage?.(url, args.signal) ?? extractArticleFromUrl(url))
            .then(page => JSON.stringify({ url, title: page.title, text: page.markdown.slice(0, PAGE_TEXT_LIMIT) }))
            .catch(error => JSON.stringify({
              url,
              error: `网页无法读取：${error instanceof Error ? error.message : String(error)}`.slice(0, 160),
            }))
          openedPages.set(url, read)
          return { toolCall, name, content: await read }
        }
        return { toolCall, name, content: JSON.stringify({ error: "unsupported tool" }) }
      }))
      for (const { toolCall, name, content } of results) {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name,
          content,
        })
      }
      forceFinalAnswer = auditableUrls.size > 0
        && searchPayloads.size >= maxUniqueSearches
        && openedPages.size >= maxPageReads
      continue
    }

    const content = messageText(message.content)
    if (!content.trim()) {
      throw new Error(
        `${input.label} 返回空内容（finish_reason=${choice.finish_reason || "unknown"}）。`,
      )
    }
    if (args.requireWebEvidence && (!searchExecuted || auditableUrls.size === 0)) {
      throw new Error(
        `${input.label} 没有完成带可审计网址的联网搜索，已阻断模型自答。`,
      )
    }
    if (isUnfinishedSearchAnswer(content)) {
      throw new Error(`${input.label} 回答停在“继续搜索”，没有给出最终回答，已改为重新提问。`)
    }
    return content
  }

  if (!searchExecuted || auditableUrls.size === 0) {
    throw new Error(`${input.label} 严格联网未取得可审计网址。`)
  }
  throw new Error(`${input.label} 已取得联网证据但仍未返回最终回答。`)
}
