import { openaiCompatRaw, openaiCompatChat, type ChatArgs } from "./openai-compat"
import { webSearch, formatHitsForLLM } from "./web-search"

// DeepSeek 适配器
//
// 官方 DeepSeek API 不像千问 / Kimi 那样自带"联网开关"。本适配器在代码层为它"外挂搜索"：
//   1) 当调用方需要"自由文本回答" (jsonMode=false) 时：
//      - 向 deepseek 注册 OpenAI 标准的 search_web tool；
//      - System prompt 中追加"涉及最新资讯/不熟悉品牌必须调用 search_web"指令；
//      - 拦截 tool_calls，调用本地 webSearch() 抓取真实结果，原样回喂；
//      - 直至模型给出 final content。
//   2) 当调用方是"裁判"等需要严格 JSON 输出 (jsonMode=true) 时：
//      - 跳过工具循环，因为裁判只审阅别的模型已给出的文本，不需要联网。
//      - 直接走最普通的 single-shot chat。
//
// 这样 Stage A (盲测) DeepSeek 拿到真实最新搜索结果再答，
// Stage B (裁判) DeepSeek 走快路径不浪费一次 LLM 调用。

const KEY = process.env.DEEPSEEK_API_KEY || ""
const URL = "https://api.deepseek.com/v1/chat/completions"
const MODEL = "deepseek-chat"
const LABEL = "DeepSeek"

export function isDeepSeekConfigured(): boolean {
  return !!KEY
}

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

export async function chatDeepSeek(args: ChatArgs): Promise<string> {
  if (!KEY) {
    throw new Error(`${LABEL} 接口配置缺失：未读取到环境变量 DEEPSEEK_API_KEY。`)
  }

  // 裁判等严格 JSON 场景：跳过工具循环
  if (args.jsonMode) {
    return openaiCompatChat({
      url: URL,
      apiKey: KEY,
      model: MODEL,
      label: LABEL,
      ...args,
    })
  }

  // 自由文本场景：开启 search_web 工具循环
  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: (args.system || "") + SEARCH_DIRECTIVE },
    { role: "user", content: args.user },
  ]

  const MAX_ROUNDS = 4 // 1 轮原始 + 最多 3 轮工具
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const data = await openaiCompatRaw({
      url: URL,
      apiKey: KEY,
      model: MODEL,
      label: LABEL,
      messages,
      temperature: args.temperature,
      maxTokens: args.maxTokens,
      seed: args.seed,
      jsonMode: false,
      tools: [SEARCH_WEB_TOOL],
    })

    const choice = data.choices?.[0]
    if (!choice) throw new Error(`${LABEL} 返回结构异常：缺少 choices。`)
    const msg = choice.message
    const finish = choice.finish_reason

    if (finish === "tool_calls" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      messages.push({
        role: "assistant",
        content: msg.content ?? "",
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
            `[deepseek·search_web] q="${query}" hits=${hits.length} ${Date.now() - t0}ms`
          )
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: "search_web",
            content: formatHitsForLLM(query, hits),
          })
        } else {
          // 其他工具名一律塞空结果，避免死循环
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

    return msg.content ?? ""
  }

  throw new Error(`${LABEL} 工具调用循环超过 ${MAX_ROUNDS} 轮仍未收敛，已阻断。`)
}
