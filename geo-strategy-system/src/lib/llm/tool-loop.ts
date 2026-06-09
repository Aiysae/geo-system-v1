// 共享 Function Calling 工具循环：给没有"原生联网"的 OpenAI 兼容模型外挂 search_web。
//
// 适用模型：
//   - DeepSeek 官方 API（无原生联网）
//   - 豆包 Endpoint 模式（未配 BOT_ID 时走这里兜底）
//
// 设计要点：
// 1) 普通分析/裁判路径会带 search_web 工具；渗透率客观盲测路径会在第一轮
//    通过 tool_choice 强制调用 search_web，确保回答确实来自联网检索。
// 2) 把"当前北京时间"注入 system 头部，减少不必要的搜索、稳住"今天"锚点。
// 3) System 末尾追加搜索纪律：涉及最新资讯/不熟悉品牌必须先搜。
// 4) 工具循环捕获 search_web 调用，本地 webSearch() 抓真实网页喂回，最多 MAX_ROUNDS 轮。

import { openaiCompatRaw, type ChatArgs } from "./openai-compat"
import { webSearch, formatHitsForLLM, type SearchHit } from "./web-search"
import { normalizeSourceDomain } from "./source-extract"
import { withBeijingTime } from "./time-context"

const SEARCH_RESULTS_PER_CALL = 12

const SEARCH_WEB_TOOL = {
  type: "function",
  function: {
    name: "search_web",
    description:
      "后台联网搜索工具。仅用于获取公开网页资料；最终回答必须像普通直接问答，不要提及 search_web、工具、搜索结果、检索过程，也不要说『搜索结果没有直接给出』。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "要搜索的关键词，应简洁、聚焦、便于检索；中文场景请用中文。",
        },
      },
      required: ["query"],
    },
  },
}

const SEARCH_DIRECTIVE = `

【联网工具使用纪律】
- 你现在可调用名为 search_web 的工具。
- 当用户问题涉及"最新行业资讯""今天/最近的事件""你不了解的具体公司/品牌"时，**必须**先调用 search_web 拿到真实结果再回答。
- 严禁在不调用 search_web 的情况下编造任何品牌、公司或日期信息。
- 一次问题最多调用 search_web 3 次，每次 query 要聚焦。
- 拿到 tool 结果后，要客观引用其中事实，不要逐条复读链接。`

const CONSUMER_TOOL_STYLE_DIRECTIVE =
  "Final answer style: answer the user's question directly. Do not mention search tools, search results, retrieved pages, or whether the results directly contain the answer."

function messageText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text
          return typeof text === "string" ? text : ""
        }
        return ""
      })
      .filter(Boolean)
      .join("\n")
  }
  return ""
}

function emitSearchSources(args: ToolLoopArgs, query: string, hits: SearchHit[]) {
  if (!args.onSearchSources) return
  args.onSearchSources({
    query,
    sources: hits.map(hit => ({
      title: hit.title,
      snippet: hit.snippet,
      url: hit.url,
      domain: normalizeSourceDomain(hit.url),
      query,
    })),
  })
}

interface ToolLoopArgs extends ChatArgs {
  url: string
  apiKey: string
  model: string
  label: string
  extraBody?: Record<string, unknown>
  extraHeaders?: Record<string, string>
  /**
   * Some OpenAI-compatible gateways do not allow a specified tool_choice.
   * For those providers, run the web search locally first and pass only the
   * question plus public search results into the final model call.
   */
  forceSearchMode?: "tool" | "presearch"
  allowSpecifiedToolChoice?: boolean
}

async function chatWithPresearchedContext(args: ToolLoopArgs): Promise<string> {
  const t0 = Date.now()
  const hits = await webSearch(args.user, SEARCH_RESULTS_PER_CALL)
  emitSearchSources(args, args.user, hits)
  console.log(
    `[${args.label}·presearch] q="${args.user.slice(0, 80)}" hits=${hits.length} ${Date.now() - t0}ms`
  )

  const messages: Array<Record<string, unknown>> = []
  const system = args.system || ""
  if (!args.rawQuestionOnly || system.trim()) {
    messages.push({
      role: "system",
      content: args.rawQuestionOnly ? system : withBeijingTime(system),
    })
  }

  const formatted = formatHitsForLLM(args.user, hits)
  messages.push({
    role: "user",
    content: `${args.user}\n\n${formatted}`,
  })

  const data = await openaiCompatRaw({
    url: args.url,
    apiKey: args.apiKey,
    model: args.model,
    label: args.label,
    messages,
    temperature: args.temperature,
    maxTokens: args.maxTokens,
    seed: args.seed,
    jsonMode: args.jsonMode,
    extraBody: args.extraBody,
    extraHeaders: args.extraHeaders,
  })

  const content = messageText(data.choices?.[0]?.message?.content)
  if (!content.trim()) {
    throw new Error(`${args.label} 预联网后返回空内容，请检查模型名、上游额度或搜索结果。`)
  }
  return content
}

export async function chatWithLocalWebSearchTool(args: ToolLoopArgs): Promise<string> {
  if (args.forceWebSearch && args.forceSearchMode === "presearch") {
    return chatWithPresearchedContext(args)
  }

  const useSearchTool = args.forceWebSearch || (args.allowWebSearch !== false && args.mode !== "consumer")
  const shouldAddSearchDirective =
    !args.rawQuestionOnly && args.allowWebSearch !== false && args.mode !== "consumer"
  const finalSystem = shouldAddSearchDirective
    ? (args.system || "") + SEARCH_DIRECTIVE
    : args.system || ""
  const allowSpecifiedToolChoice = args.allowSpecifiedToolChoice !== false
  const consumerForcedSearch = args.forceWebSearch && args.mode === "consumer"

  const messages: Array<Record<string, unknown>> = []
  if (!args.rawQuestionOnly || finalSystem.trim()) {
    messages.push({
      role: "system",
      content: args.rawQuestionOnly ? finalSystem : withBeijingTime(finalSystem),
    })
  }
  messages.push({ role: "user", content: args.user })

  const MAX_ROUNDS = 4 // 1 轮原始 + 最多 3 轮工具
  const searchCache = new Map<string, SearchHit[]>()
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const data = await openaiCompatRaw({
      url: args.url,
      apiKey: args.apiKey,
      model: args.model,
      label: args.label,
      messages,
      temperature: args.temperature,
      maxTokens: args.maxTokens,
      seed: args.seed,
      // ★ 关键：jsonMode 透传，让"裁判"路径也照常拿 JSON 输出，
      //    若供应商不接受 tools+response_format 同时启用，openai-compat 已带 400 重试兜底。
      jsonMode: args.jsonMode,
      tools: useSearchTool && !(consumerForcedSearch && round > 0) ? [SEARCH_WEB_TOOL] : undefined,
      toolChoice:
        args.forceWebSearch && allowSpecifiedToolChoice && round === 0
          ? { type: "function", function: { name: "search_web" } }
          : undefined,
      extraBody: args.extraBody,
      extraHeaders: args.extraHeaders,
    })

    const choice = data.choices?.[0]
    if (!choice) throw new Error(`${args.label} 返回结构异常：缺少 choices。`)
    const msg = choice.message
    const finish = choice.finish_reason

    if (finish === "tool_calls" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      messages.push({
        role: "assistant",
        content: messageText(msg.content),
        tool_calls: msg.tool_calls,
      })
      for (const tc of msg.tool_calls) {
        if (tc.function?.name === "search_web") {
          let query = consumerForcedSearch && round === 0 ? args.user : ""
          try {
            const parsed = JSON.parse(tc.function.arguments || "{}") as { query?: unknown }
            if (!query) query = typeof parsed.query === "string" ? parsed.query : ""
          } catch {
            if (!query) query = ""
          }
          if (!query.trim()) query = args.user
          const t0 = Date.now()
          let hits = searchCache.get(query)
          if (!hits) {
            hits = await webSearch(query, SEARCH_RESULTS_PER_CALL)
            searchCache.set(query, hits)
            emitSearchSources(args, query, hits)
            console.log(
              `[${args.label}·search_web] q="${query}" hits=${hits.length} ${Date.now() - t0}ms`
            )
          }
          const formatted = formatHitsForLLM(query, hits)
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: "search_web",
            content: args.mode === "consumer" ? `${formatted}\n\n${CONSUMER_TOOL_STYLE_DIRECTIVE}` : formatted,
          })
        } else {
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: tc.function?.name ?? "unknown",
            content: "{}",
          })
        }
      }
      continue
    }

    const content = messageText(msg.content)
    if (!content.trim()) {
      throw new Error(`${args.label} 返回空内容（finish_reason=${finish || "unknown"}），请检查模型名、联网工具或上游额度。`)
    }
    return content
  }

  messages.push({
    role: "user",
    content: "请基于上面的联网搜索结果直接回答原问题，不要再调用工具。",
  })

  const finalData = await openaiCompatRaw({
    url: args.url,
    apiKey: args.apiKey,
    model: args.model,
    label: args.label,
    messages,
    temperature: args.temperature,
    maxTokens: args.maxTokens,
    seed: args.seed,
    jsonMode: args.jsonMode,
    extraBody: args.extraBody,
    extraHeaders: args.extraHeaders,
  })

  const finalContent = messageText(finalData.choices?.[0]?.message?.content)
  if (finalContent.trim()) return finalContent

  throw new Error(`${args.label} 工具调用循环超过 ${MAX_ROUNDS} 轮后仍返回空内容，已阻断。`)
}
