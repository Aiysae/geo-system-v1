import { openaiCompatRaw, type ChatArgs } from "./openai-compat"

// Kimi (Moonshot) 适配器：开启官方 builtin function "$web_search" 联网检索能力，
// 严格按 Moonshot 文档要求处理 tool_calls 循环：
//   https://platform.moonshot.cn/docs/api/tool_use#web-search
//
// 流程：
//   1) 第一次请求带 tools=[$web_search]
//   2) 若 finish_reason==="tool_calls" 且 function.name==="$web_search"，
//      把 tool_call.function.arguments 原样 echo 回去（Moonshot 在服务器端已完成搜索）
//   3) 直到 finish_reason!=="tool_calls" 时取回最终 message.content

const KEY = process.env.MOONSHOT_API_KEY || ""
// 默认使用 kimi-latest（已内置联网能力强、支持工具调用）。如需固定旧模型可通过环境变量覆盖。
const MODEL = process.env.MOONSHOT_MODEL || "kimi-latest"
const URL = "https://api.moonshot.cn/v1/chat/completions"
const LABEL = "Kimi"

export function isKimiConfigured(): boolean {
  return !!KEY
}

const WEB_SEARCH_TOOL = {
  type: "builtin_function",
  function: { name: "$web_search" },
}

export async function chatKimi(args: ChatArgs): Promise<string> {
  if (!KEY) {
    throw new Error(`${LABEL} 接口配置缺失：未读取到环境变量 MOONSHOT_API_KEY。`)
  }

  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: args.system },
    { role: "user", content: args.user },
  ]

  const MAX_ROUNDS = 4
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
      // 联网工具与 JSON Mode 一起开常被供应商拒绝；只有"非工具调用"那一轮才上 jsonMode。
      // 这里始终先不带 jsonMode 走工具循环，最后一轮模型若仍想要 JSON，会在 prompt 层被强约束。
      jsonMode: false,
      tools: [WEB_SEARCH_TOOL],
    })

    const choice = data.choices?.[0]
    if (!choice) throw new Error(`${LABEL} 返回结构异常：缺少 choices。`)

    const msg = choice.message
    const finish = choice.finish_reason

    if (finish === "tool_calls" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      // 必须把 assistant 这条带 tool_calls 的消息原样塞回 messages，再追加 tool 角色的执行结果。
      messages.push({
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: msg.tool_calls,
      })
      for (const tc of msg.tool_calls) {
        if (tc.function?.name === "$web_search") {
          // Moonshot 协议：$web_search 是 builtin，搜索已在服务器端执行完成，
          // 客户端只需把 arguments 原样作为 tool 结果回传。
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: tc.function.name,
            content: tc.function.arguments,
          })
        } else {
          // 非预期工具：塞个空结果继续，避免死循环
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
