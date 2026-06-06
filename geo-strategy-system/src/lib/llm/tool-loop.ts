// 共享 Function Calling 工具循环：给没有"原生联网"的 OpenAI 兼容模型外挂 search_web。
//
// 适用模型：
//   - DeepSeek 官方 API（无原生联网）
//   - 豆包 Endpoint 模式（未配 BOT_ID 时走这里兜底）
//
// 设计要点：
// 1) 永远开启 search_web 工具，连"裁判"等 jsonMode=true 的场景也带着，
//    满足"所有 AI 调用都必须联网"的硬约束。
// 2) 把"当前北京时间"注入 system 头部，减少不必要的搜索、稳住"今天"锚点。
// 3) System 末尾追加搜索纪律：涉及最新资讯/不熟悉品牌必须先搜。
// 4) 工具循环捕获 search_web 调用，本地 webSearch() 抓真实网页喂回，最多 MAX_ROUNDS 轮。

import { openaiCompatRaw, type ChatArgs } from "./openai-compat"
import { webSearch, formatHitsForLLM } from "./web-search"
import { withBeijingTime } from "./time-context"

const SEARCH_WEB_TOOL = {
  type: "function",
  function: {
    name: "search_web",
    description:
      "联网搜索引擎。当用户提问涉及『最新资讯/今天日期/近期事件/你不熟悉的具体公司或品牌』时，必须调用此工具获取真实网页结果，严禁凭空猜测。",
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

interface ToolLoopArgs extends ChatArgs {
  url: string
  apiKey: string
  model: string
  label: string
}

export async function chatWithLocalWebSearchTool(args: ToolLoopArgs): Promise<string> {
  const finalSystem = args.mode === 'consumer'
    ? args.system || ""
    : (args.system || "") + SEARCH_DIRECTIVE;

  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: withBeijingTime(finalSystem) },
    { role: "user", content: args.user },
  ]

  const MAX_ROUNDS = 4 // 1 轮原始 + 最多 3 轮工具
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
      tools: args.mode === 'consumer' ? undefined : [SEARCH_WEB_TOOL],
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
          let query = ""
          try {
            const parsed = JSON.parse(tc.function.arguments || "{}") as { query?: unknown }
            query = typeof parsed.query === "string" ? parsed.query : ""
          } catch {
            query = ""
          }
          const t0 = Date.now()
          const hits = await webSearch(query, 5)
          console.log(
            `[${args.label}·search_web] q="${query}" hits=${hits.length} ${Date.now() - t0}ms`
          )
          const formatted = formatHitsForLLM(query, hits)
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: "search_web",
            content:
              args.mode === "consumer"
                ? `${formatted}\n\n【要求】请保留关键事实、品牌名、时间、价格、数据与来源细节，不要过度压缩搜索结果。`
                : formatted,
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

  throw new Error(`${args.label} 工具调用循环超过 ${MAX_ROUNDS} 轮仍未收敛，已阻断。`)
}
