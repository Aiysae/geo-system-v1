import { openaiCompatRaw, type ChatArgs } from "./openai-compat"
import { chatWithLocalWebSearchTool } from "./tool-loop"
import { extractSourcesFromUnknown } from "./source-extract"
import { withBeijingTime } from "./time-context"
import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { getChatRuntimeSetting } from "@/lib/llm/runtime-config"
import { chatWithAuditableExternalSearch } from "./auditable-external-search"

// Kimi (Moonshot) 适配器
//
// 渗透率严格联网盲测由 Kimi 负责工具选择和最终作答，由百度公开搜索
// 返回可审计的标题、摘要和网址。分析/裁判路径仍可使用 Moonshot
// 官方 $web_search；TokenHub 等路径不参与严格盲测。
// 严格按 Moonshot 文档处理 tool_calls 循环：
//   https://platform.moonshot.cn/docs/api/tool_use#web-search
//
// 关于 tools + JSON Mode 同时启用：Moonshot 偶发 400。
// openai-compat 的 jsonMode 400/422 重试兜底会自动去掉 response_format 重发，仍能返回可解析 JSON。
//
// 错误日志：所有失败一律打印【完整错误体】到终端，便于排查 401/400 等鉴权或参数错误。

const LABEL = "Kimi"
const PENETRATION_REQUEST_GAP_MS = 1500

let penetrationQueue: Promise<void> = Promise.resolve()
let lastPenetrationCompletedAt = 0

function isTokenHub(baseUrl: string): boolean {
  return /tokenhub\.tencentmaas\.com/i.test(baseUrl)
}

function shouldDisableThinking(model: string): boolean {
  return /k2|thinking/i.test(model)
}

export async function isKimiConfigured(): Promise<boolean> {
  const config = await getAiProviderRuntimeSetting("kimi")
  return !!config.apiKey
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

function isOfficialMoonshotUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === "api.moonshot.cn" || host.endsWith(".moonshot.cn")
  } catch {
    return false
  }
}

async function chatKimiDirect(args: ChatArgs): Promise<string> {
  const config = await getChatRuntimeSetting("kimi", args)
  const key = config.apiKey
  const selectedModel = config.model
  const useSearchTool = args.forceWebSearch || (args.allowWebSearch !== false && args.mode !== "consumer")

  if (!key) {
    console.warn("[Kimi] Moonshot API Key is undefined（请在后台管理页配置 Kimi 模型）")
    throw new Error(`${LABEL} 接口配置缺失：请在后台管理页配置 API Key 和模型。`)
  }

  if (isTokenHub(config.baseUrl)) {
    if (args.forceWebSearch) {
      throw new Error("Kimi TokenHub 当前不提供稳定可验证的官方 $web_search 来源；严格联网盲测已禁止本地检索兜底。")
    }
    return chatWithLocalWebSearchTool({
      url: buildAiChatUrl(config),
      apiKey: key,
      model: selectedModel,
      label: LABEL,
      extraBody: shouldDisableThinking(selectedModel) ? { thinking: { type: "disabled" } } : undefined,
      ...args,
      timeoutSec: args.timeoutSec ?? config.timeout,
    })
  }

  // 裁判/分析路径注入"当前北京时间"作为时间锚点；客观盲测 rawQuestionOnly
  // 不注入 system message，保持被测模型只收到用户疑问句本身。
  const messages: Array<Record<string, unknown>> = []
  if (!args.rawQuestionOnly && args.system.trim()) {
    messages.push({
      role: "system",
      content: withBeijingTime(args.system),
    })
  }
  messages.push({ role: "user", content: args.user })

  const MAX_ROUNDS = 4
  let officialSearchExecuted = false
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let data
    const callMoonshot = () =>
      openaiCompatRaw({
        url: buildAiChatUrl(config),
        apiKey: key,
        model: selectedModel,
        label: LABEL,
        messages,
        // Kimi K2.6 官方联网要求关闭思考；此时温度固定为 0.6。
        // 不透传盲测调用方的 temperature=0，避免先失败再重试。
        temperature: shouldDisableThinking(selectedModel) ? undefined : args.temperature,
        maxTokens: args.maxTokens,
        seed: args.seed,
        // jsonMode 透传给底层；若上游 400/422 拒绝 tools+response_format，
        // openai-compat 已有去掉 response_format 重试的兜底。
        jsonMode: args.jsonMode,
        tools: useSearchTool ? [WEB_SEARCH_TOOL] : undefined,
        toolChoice:
          args.forceWebSearch && round === 0
            ? "required"
            : undefined,
        extraBody: shouldDisableThinking(selectedModel) ? { thinking: { type: "disabled" } } : undefined,
        timeoutMs: (args.timeoutSec ?? config.timeout) * 1000,
        signal: args.signal,
      })

    try {
      data = await callMoonshot()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(
        `[${LABEL}·tool-loop] 第 ${round + 1}/${MAX_ROUNDS} 轮调用失败 | model=${selectedModel} | error=`,
        msg
      )
      throw e
    }

    if (!data) {
      console.error(
        `[${LABEL}·tool-loop] 第 ${round + 1}/${MAX_ROUNDS} 轮调用失败 | model=${selectedModel} | error=`,
        "empty response"
      )
      throw new Error(`${LABEL} 返回结构异常：空响应。`)
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
          officialSearchExecuted = true
          let parsedArguments: unknown = tc.function.arguments
          try {
            parsedArguments = JSON.parse(tc.function.arguments || "{}")
          } catch {
            parsedArguments = tc.function.arguments
          }
          const sources = extractSourcesFromUnknown(parsedArguments, args.user)
          args.onSearchSources?.({
            query: args.user,
            sources,
            mode: "native_web",
            searchExecuted: true,
            providerRequestId: data.id,
          })
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
    const nativeSources = extractSourcesFromUnknown(data, args.user)
    if (nativeSources.length > 0) officialSearchExecuted = true
    if (nativeSources.length > 0) {
      args.onSearchSources?.({
        query: args.user,
        sources: nativeSources,
        mode: "native_web",
        searchExecuted: true,
        providerRequestId: data.id,
      })
    }
    if (args.requireWebEvidence && !officialSearchExecuted) {
      throw new Error(`${LABEL} 官方 $web_search 未执行，已阻断模型自答和本地检索兜底。`)
    }
    return content
  }

  throw new Error(`${LABEL} 工具调用循环超过 ${MAX_ROUNDS} 轮仍未收敛，已阻断。`)
}

async function enqueuePenetrationRequest<T>(task: () => Promise<T>): Promise<T> {
  const previous = penetrationQueue
  let release: (() => void) | undefined
  penetrationQueue = new Promise<void>(resolve => {
    release = resolve
  })

  await previous
  const waitMs = Math.max(
    0,
    PENETRATION_REQUEST_GAP_MS - (Date.now() - lastPenetrationCompletedAt)
  )
  if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs))

  try {
    return await task()
  } finally {
    lastPenetrationCompletedAt = Date.now()
    release?.()
  }
}

async function chatKimiStrictSearch(args: ChatArgs): Promise<string> {
  const [kimiConfig, baiduConfig] = await Promise.all([
    getChatRuntimeSetting("kimi", args),
    getChatRuntimeSetting("ernie", {
      runtimeOverride: args.searchRuntimeOverride,
    }),
  ])
  const key = kimiConfig.apiKey
  const selectedModel = kimiConfig.model || "kimi-k2.6"
  const url = buildAiChatUrl(kimiConfig)
  if (!key) throw new Error("Kimi 严格联网缺少 Moonshot API Key。")
  if (!baiduConfig.apiKey) throw new Error("Kimi 严格联网缺少百度千帆搜索 API Key。")
  if (!isOfficialMoonshotUrl(url)) {
    throw new Error("Kimi 严格联网必须使用 Moonshot 国内官方 API 地址。")
  }

  return chatWithAuditableExternalSearch({
    args,
    endpoint: url,
    apiKey: key,
    model: selectedModel,
    label: LABEL,
    modelProvider: "moonshot",
    searchApiKey: baiduConfig.apiKey,
    requestTimeoutSec: args.timeoutSec ?? kimiConfig.timeout,
    searchTimeoutSec: args.timeoutSec ?? baiduConfig.timeout,
    temperature: shouldDisableThinking(selectedModel) ? undefined : args.temperature,
    extraBody: shouldDisableThinking(selectedModel)
      ? { thinking: { type: "disabled" } }
      : undefined,
  })
}

export async function chatKimi(args: ChatArgs): Promise<string> {
  const isPenetrationBlindQuery =
    args.forceWebSearch === true && args.mode === "consumer" && args.rawQuestionOnly === true
  return isPenetrationBlindQuery
    ? enqueuePenetrationRequest(() => chatKimiStrictSearch(args))
    : chatKimiDirect(args)
}
