import { openaiCompatRaw, type ChatArgs } from "./openai-compat"
import { withBeijingTime } from "./time-context"

// Kimi (Moonshot) 适配器
//
// 渗透率客观盲测会通过 forceWebSearch 强制开启官方 builtin function "$web_search"；
// 分析/裁判路径默认带联网工具。
// 严格按 Moonshot 文档处理 tool_calls 循环：
//   https://platform.moonshot.cn/docs/api/tool_use#web-search
//
// 关于 tools + JSON Mode 同时启用：Moonshot 偶发 400。
// openai-compat 的 jsonMode 400/422 重试兜底会自动去掉 response_format 重发，仍能返回可解析 JSON。
//
// 错误日志：所有失败一律打印【完整错误体】到终端，便于排查 401/400 等鉴权或参数错误。

const URL = "https://api.moonshot.cn/v1/chat/completions"
const LABEL = "Kimi"

function apiKey(): string {
  return process.env.MOONSHOT_API_KEY || ""
}

function model(): string {
  return process.env.MOONSHOT_MODEL || "moonshot-v1-8k"
}

export function isKimiConfigured(): boolean {
  return !!apiKey()
}

const WEB_SEARCH_TOOL = {
  type: "builtin_function",
  function: { name: "$web_search" },
}

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

export async function chatKimi(args: ChatArgs): Promise<string> {
  const key = apiKey()
  const selectedModel = model()
  const useSearchTool = args.forceWebSearch || args.mode !== "consumer"

  if (!key) {
    console.warn("[Kimi] Moonshot API Key is undefined（process.env.MOONSHOT_API_KEY 为空，请检查 .env.local 是否已加载）")
    throw new Error(`${LABEL} 接口配置缺失：未读取到环境变量 MOONSHOT_API_KEY。`)
  }

  // 裁判/分析路径注入"当前北京时间"作为时间锚点；客观盲测 rawQuestionOnly
  // 不注入 system message，保持被测模型只收到用户疑问句本身。
  const messages: Array<Record<string, unknown>> = []
  if (!args.rawQuestionOnly || args.system.trim()) {
    messages.push({
      role: "system",
      content: args.rawQuestionOnly ? args.system : withBeijingTime(args.system),
    })
  }
  messages.push({ role: "user", content: args.user })

  const MAX_ROUNDS = 4
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let data
    try {
      data = await openaiCompatRaw({
        url: URL,
        apiKey: key,
        model: selectedModel,
        label: LABEL,
        messages,
        temperature: args.temperature,
        maxTokens: args.maxTokens,
        seed: args.seed,
        // jsonMode 透传给底层；若上游 400/422 拒绝 tools+response_format，
        // openai-compat 已有去掉 response_format 重试的兜底。
        jsonMode: args.jsonMode,
        tools: useSearchTool ? [WEB_SEARCH_TOOL] : undefined,
        toolChoice:
          args.forceWebSearch && round === 0
            ? { type: "builtin_function", function: { name: "$web_search" } }
            : undefined,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(
        `[${LABEL}·tool-loop] 第 ${round + 1}/${MAX_ROUNDS} 轮调用失败 | model=${selectedModel} | error=`,
        msg
      )
      throw e
    }

    const choice = data.choices?.[0]
    if (!choice) throw new Error(`${LABEL} 返回结构异常：缺少 choices。`)

    const msg = choice.message
    const finish = choice.finish_reason

    if (finish === "tool_calls" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      messages.push({
        role: "assistant",
        content: messageText(msg.content),
        tool_calls: msg.tool_calls,
      })
      for (const tc of msg.tool_calls) {
        if (tc.function?.name === "$web_search") {
          // Moonshot 协议：$web_search 是 builtin，搜索已在服务器端执行，
          // 客户端只需把 arguments 原样作为 tool 结果回传。
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: tc.function.name,
            content: tc.function.arguments,
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
      throw new Error(`${LABEL} 返回空内容（finish_reason=${finish || "unknown"}），请检查模型名、联网工具或上游额度。`)
    }
    return content
  }

  throw new Error(`${LABEL} 工具调用循环超过 ${MAX_ROUNDS} 轮仍未收敛，已阻断。`)
}
