import { searchBaiduWeb } from "./baidu-ai-search"
import { emitPenetrationRequestAudit } from "./blind-request-audit"
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

interface AuditableExternalSearchArgs {
  args: ChatArgs
  endpoint: string
  apiKey: string
  model: string
  label: string
  modelProvider: string
  searchApiKey: string
  requestTimeoutSec: number
  searchTimeoutSec: number
  temperature?: number
  extraBody?: Record<string, unknown>
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

export async function chatWithAuditableExternalSearch(
  input: AuditableExternalSearchArgs,
): Promise<string> {
  const { args } = input
  const messages: Array<Record<string, unknown>> = [
    { role: "user", content: args.user },
  ]
  emitPenetrationRequestAudit(args, {
    endpoint: input.endpoint,
    model: input.model,
    modelProvider: input.modelProvider,
    searchProvider: "baidu_search",
    searchMode: "external_tool_web",
    messages,
    tools: [SEARCH_TOOL],
  })

  const auditableUrls = new Set<string>()
  let searchExecuted = false
  const maxRounds = 4

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
      tools: [SEARCH_TOOL],
      toolChoice: round === 0 ? "required" : undefined,
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

    if (
      choice.finish_reason === "tool_calls"
      && Array.isArray(message.tool_calls)
      && message.tool_calls.length > 0
    ) {
      messages.push({
        role: "assistant",
        content: messageText(message.content),
        tool_calls: message.tool_calls,
      })
      for (const toolCall of message.tool_calls) {
        if (toolCall.function?.name !== "search_web") {
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolCall.function?.name ?? "unknown",
            content: JSON.stringify({ error: "unsupported tool" }),
          })
          continue
        }

        const query = searchQuery(toolCall.function.arguments, args.user)
        const search = await searchBaiduWeb({
          apiKey: input.searchApiKey,
          query,
          timeoutSec: input.searchTimeoutSec,
          signal: args.signal,
          topK: 20,
        })
        searchExecuted = true
        for (const source of search.sources) auditableUrls.add(source.url)
        args.onSearchSources?.({
          query: search.query,
          sources: search.sources,
          mode: "external_tool_web",
          searchExecuted: true,
          providerRequestId: search.requestId,
        })
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: JSON.stringify({
            query: search.query,
            results: search.sources.map(source => ({
              title: source.title,
              url: source.url,
              snippet: source.snippet,
              domain: source.domain,
            })),
          }),
        })
      }
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
    return content
  }

  throw new Error(`${input.label} 严格联网工具调用超过 ${maxRounds} 轮仍未收敛。`)
}
