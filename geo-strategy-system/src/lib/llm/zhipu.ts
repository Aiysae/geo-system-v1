import type { PenetrationSource } from "@/types"
import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { getChatRuntimeSetting } from "@/lib/llm/runtime-config"
import { emitPenetrationRequestAudit } from "./blind-request-audit"
import {
  emitTokenUsage,
  openaiCompatChat,
  openaiCompatRaw,
  type ChatArgs,
  type RawChatCompletion,
} from "./openai-compat"
import {
  dedupePenetrationSources,
  isAuditableSourceUrl,
  normalizeSourceDomain,
} from "./source-extract"

// 智谱（智谱清言 / GLM）适配器。
//
// 疑问句严格检测使用智谱开放平台 chat/completions 的官方 web_search 工具，
// 响应顶层 web_search 数组逐条返回标题、网址、摘要和发布时间，可审计。
//   https://docs.bigmodel.cn/cn/guide/tools/web-search
// 关闭深度思考：思考模型会把输出额度耗在推理上，返回空正文。

const LABEL = "智谱清言"
// 2026-10-21 用同一批 22 个问题对照外部检测工具校准：夸克搜索 + 30 条结果
// 最接近智谱清言 App 的回答（平均差距 26 点降到 18 点），耗时不变；
// 开深度思考没有帮助，反而慢 3 倍。
const SEARCH_ENGINE = "search_pro_quark"
const SEARCH_RESULT_COUNT = 30

interface ZhipuWebSearchResult {
  title?: string
  link?: string
  content?: string
  media?: string
  publish_date?: string
}

type ZhipuChatCompletion = RawChatCompletion & {
  request_id?: string
  web_search?: ZhipuWebSearchResult[]
}

function isOfficialZhipuUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === "open.bigmodel.cn" || host.endsWith(".bigmodel.cn")
  } catch {
    return false
  }
}

function messageText(content: RawChatCompletion["choices"][number]["message"]["content"]): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.map(part => (typeof part.text === "string" ? part.text : "")).filter(Boolean).join("\n")
}

export function extractZhipuWebSources(
  results: ZhipuWebSearchResult[] | undefined,
  query: string,
): PenetrationSource[] {
  return dedupePenetrationSources((results || [])
    .map((result): PenetrationSource | null => {
      const url = result.link?.trim() || ""
      const title = result.title?.trim() || result.media?.trim() || ""
      const snippet = result.content?.trim() || ""
      if (!isAuditableSourceUrl(url, title, snippet)) return null
      const clean = new URL(url).toString()
      return { title: title || normalizeSourceDomain(clean), snippet, url: clean, domain: normalizeSourceDomain(clean), query }
    })
    .filter((source): source is PenetrationSource => !!source))
}

function webSearchTool(searchResult: boolean) {
  return {
    type: "web_search",
    web_search: {
      enable: true,
      search_engine: SEARCH_ENGINE,
      search_result: searchResult,
      count: SEARCH_RESULT_COUNT,
    },
  }
}

export async function isZhipuConfigured(): Promise<boolean> {
  const config = await getAiProviderRuntimeSetting("zhipu")
  return !!config.apiKey
}

async function chatZhipuStrictSearch(args: ChatArgs): Promise<string> {
  const config = await getChatRuntimeSetting("zhipu", args)
  if (!config.apiKey) throw new Error(`${LABEL} 严格联网缺少智谱开放平台 API Key。`)
  const url = buildAiChatUrl(config)
  if (!isOfficialZhipuUrl(url)) {
    throw new Error(`${LABEL} 严格联网必须使用智谱开放平台官方 API 地址。`)
  }
  const tools = [webSearchTool(true)]
  const messages = [{ role: "user", content: args.user }]
  emitPenetrationRequestAudit(args, {
    endpoint: url,
    model: config.model,
    modelProvider: "zhipu",
    searchProvider: "zhipu_search",
    searchMode: "native_web",
    messages,
    tools,
  })

  const data = await openaiCompatRaw({
    url,
    apiKey: config.apiKey,
    model: config.model,
    label: LABEL,
    messages,
    temperature: args.temperature,
    maxTokens: args.maxTokens,
    seed: args.seed,
    tools,
    extraBody: { thinking: { type: "disabled" } },
    timeoutMs: (args.timeoutSec ?? config.timeout) * 1000,
    signal: args.signal,
    transportRetries: args.transportRetries,
  }) as ZhipuChatCompletion
  emitTokenUsage(data, args.onUsage)

  const sources = extractZhipuWebSources(data.web_search, args.user)
  const requestId = (data.request_id || data.id || "").trim()
  args.onSearchSources?.({
    query: args.user,
    sources,
    mode: "native_web",
    searchExecuted: (data.web_search?.length || 0) > 0,
    providerRequestId: requestId || undefined,
    failureReason: sources.length > 0 ? undefined : "智谱联网搜索没有返回可读取的网页信源。",
  })

  const choice = data.choices?.[0]
  const content = messageText(choice?.message?.content ?? "")
  if (!content.trim()) {
    throw new Error(`${LABEL} 联网返回空内容（finish_reason=${choice?.finish_reason || "unknown"}）。`)
  }
  if (args.requireWebEvidence && sources.length === 0) {
    throw new Error(`${LABEL} 联网搜索未返回可审计网页来源，已阻断模型自答。`)
  }
  if (!requestId) throw new Error(`${LABEL} 联网搜索未返回请求编号。`)
  return content
}

export async function chatZhipu(args: ChatArgs): Promise<string> {
  const strictPenetrationSearch =
    args.forceWebSearch === true
    && args.officialWebOnly === true
    && args.requireWebEvidence === true
    && args.mode === "consumer"
  if (strictPenetrationSearch) return chatZhipuStrictSearch(args)

  const config = await getChatRuntimeSetting("zhipu", args)
  const useSearch = args.forceWebSearch || (args.allowWebSearch !== false && args.mode === "consumer")
  return openaiCompatChat({
    url: buildAiChatUrl(config),
    apiKey: config.apiKey,
    model: config.model,
    label: LABEL,
    ...args,
    extraBody: {
      thinking: { type: "disabled" },
      ...(useSearch ? { tools: [webSearchTool(false)] } : {}),
    },
    timeoutSec: args.timeoutSec ?? config.timeout,
  })
}
