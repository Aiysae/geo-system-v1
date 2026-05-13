import { openaiCompatRaw, openaiCompatChat, type ChatArgs } from "./openai-compat"

// Kimi (Moonshot) 适配器
//
// 设计要点（与 DeepSeek 保持一致的"双轨"策略）：
//   1) 当调用方是"裁判"等需要严格 JSON 输出 (jsonMode=true) 时：
//      - 跳过 $web_search 工具循环，直接走 single-shot chat（带 JSON Mode）
//      - 工具调用 + JSON Mode 同时启用经常被供应商拒绝（400），所以严格分离两路。
//   2) 当调用方是"自由文本回答" (jsonMode=false) 时：
//      - 开启官方 builtin function "$web_search" 联网检索能力
//      - 严格按 Moonshot 文档要求处理 tool_calls 循环：
//        https://platform.moonshot.cn/docs/api/tool_use#web-search
//
// 错误日志：所有失败一律打印【完整错误体】到终端，便于排查 401/400 等鉴权或参数错误。

const KEY = process.env.MOONSHOT_API_KEY || ""
// 默认使用官方规范模型名 moonshot-v1-8k（最稳、支持 tool use 与 JSON Mode）。
// 如需切换可通过环境变量 MOONSHOT_MODEL 覆盖（例如 moonshot-v1-32k / moonshot-v1-128k / kimi-latest）。
const MODEL = process.env.MOONSHOT_MODEL || "moonshot-v1-8k"
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

  // 裁判等严格 JSON 场景：跳过工具循环，直接 single-shot（JSON Mode）
  if (args.jsonMode) {
    try {
      return await openaiCompatChat({
        url: URL,
        apiKey: KEY,
        model: MODEL,
        label: LABEL,
        ...args,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[${LABEL}·json-mode] 调用失败 | model=${MODEL} | error=`, msg)
      throw e
    }
  }

  // 自由文本场景：开启 $web_search 工具循环
  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: args.system },
    { role: "user", content: args.user },
  ]

  const MAX_ROUNDS = 4
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let data
    try {
      data = await openaiCompatRaw({
        url: URL,
        apiKey: KEY,
        model: MODEL,
        label: LABEL,
        messages,
        temperature: args.temperature,
        maxTokens: args.maxTokens,
        seed: args.seed,
        jsonMode: false,
        tools: [WEB_SEARCH_TOOL],
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(
        `[${LABEL}·tool-loop] 第 ${round + 1}/${MAX_ROUNDS} 轮调用失败 | model=${MODEL} | error=`,
        msg
      )
      throw e
    }

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
