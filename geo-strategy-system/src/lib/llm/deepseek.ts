import { chatWithLocalWebSearchTool } from "./tool-loop"
import type { ChatArgs } from "./openai-compat"
import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { getChatRuntimeSetting } from "@/lib/llm/runtime-config"
import { chatWithAuditableExternalSearch } from "./auditable-external-search"

// DeepSeek 适配器
//
// 官方 DeepSeek API 不像千问 / Kimi 那样自带"联网开关"。本适配器在代码层为它"外挂搜索"。
// 渗透率严格联网盲测不再允许本地 search_web 兜底；裁判/分析路径仍可默认带工具。
// jsonMode 透传给底层，
// 万一上游不接受 tools+response_format 同时启用，openai-compat 的 400 兜底会自动去掉
// response_format 重试，仍返回可被 parseJsonLoose 解析的内容。

const LABEL = "DeepSeek"

function isTokenHub(baseUrl: string): boolean {
  return /tokenhub\.tencentmaas\.com/i.test(baseUrl)
}

function isOfficialDeepSeek(baseUrl: string): boolean {
  return /(?:^|\.)api\.deepseek\.com$/i.test(new URL(baseUrl).hostname)
}

function shouldUseToolCompatibleModel(model: string, args: ChatArgs, baseUrl: string): boolean {
  if (!isOfficialDeepSeek(baseUrl) || isTokenHub(baseUrl)) return false
  const useSearchTool =
    args.forceWebSearch === true
    || (args.allowWebSearch !== false && args.mode !== "consumer")
  return useSearchTool && /reasoner|thinking|r1/i.test(model)
}

export async function isDeepSeekConfigured(): Promise<boolean> {
  const config = await getAiProviderRuntimeSetting("deepseek")
  return !!config.apiKey
}

export async function chatDeepSeek(args: ChatArgs): Promise<string> {
  const config = await getChatRuntimeSetting("deepseek", args)
  const strictPenetrationSearch =
    args.forceWebSearch === true &&
    args.officialWebOnly === true &&
    args.requireWebEvidence === true &&
    args.mode === "consumer"

  if (strictPenetrationSearch) {
    const searchConfig = await getChatRuntimeSetting("ernie", {
      runtimeOverride: args.searchRuntimeOverride,
    })
    if (!config.apiKey) throw new Error("DeepSeek 严格联网缺少官方 API Key。")
    if (!searchConfig.apiKey) throw new Error("DeepSeek 严格联网缺少百度千帆搜索 API Key。")
    if (!isOfficialDeepSeek(config.baseUrl)) {
      throw new Error("DeepSeek 严格联网必须使用 DeepSeek 官方 API 地址。")
    }
    return chatWithAuditableExternalSearch({
      args,
      endpoint: buildAiChatUrl(config),
      apiKey: config.apiKey,
      model: process.env.DEEPSEEK_WEB_SEARCH_MODEL?.trim() || "deepseek-chat",
      label: LABEL,
      modelProvider: "deepseek",
      searchApiKey: searchConfig.apiKey,
      requestTimeoutSec: args.timeoutSec ?? config.timeout,
      searchTimeoutSec: args.timeoutSec ?? searchConfig.timeout,
      temperature: args.temperature,
    })
  }

  if (!config.apiKey) {
    console.warn("[DeepSeek] API Key is undefined（请在后台管理页配置 DeepSeek 模型）")
    throw new Error(`${LABEL} 接口配置缺失：请在后台管理页配置 API Key 和模型。`)
  }
  const model = shouldUseToolCompatibleModel(config.model, args, config.baseUrl) ? "deepseek-chat" : config.model
  if (model !== config.model) {
    console.log(`[DeepSeek·联网] ${config.model} 不支持强制工具调用，本次联网检测自动切换到 ${model}`)
  }
  return chatWithLocalWebSearchTool({
    url: buildAiChatUrl(config),
    apiKey: config.apiKey,
    model,
    label: LABEL,
    extraBody: isTokenHub(config.baseUrl) ? { thinking: { type: "disabled" } } : undefined,
    forceSearchMode: args.forceWebSearch && isTokenHub(config.baseUrl) ? "presearch" : undefined,
    allowSpecifiedToolChoice: isTokenHub(config.baseUrl) ? false : undefined,
    ...args,
    timeoutSec: args.timeoutSec ?? config.timeout,
  })
}
