import { chatWithLocalWebSearchTool } from "./tool-loop"
import { fastJudgeExtraBody, type ChatArgs } from "./openai-compat"
import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { getChatRuntimeSetting } from "@/lib/llm/runtime-config"
import {
  baiduAuditableSearch,
  chatWithAuditableExternalSearch,
  moonshotAuditableSearch,
} from "./auditable-external-search"

// DeepSeek 适配器
//
// 官方 DeepSeek API 不像千问 / Kimi 那样自带"联网开关"。本适配器在代码层为它"外挂搜索"。
// 渗透率严格联网盲测不再允许本地 search_web 兜底；检索优先用 Kimi 官方搜索，
// Kimi 账号不可用时由账号池改派百度千帆搜索，两者都返回可审计网址。
//
// 2026-10-21 对照用户在 DeepSeek App 亲测的回答校准：App 会用多组关键词搜索、
// 打开几个网页读全文。改为 Kimi 搜索、最多 4 次搜索（每次 10 条）、最多读 5 个
// 网页后，与 App 提到的公司重合度最高，百度百科这类词条也少了。
// 裁判/分析路径仍可默认带工具。
// jsonMode 透传给底层，
// 万一上游不接受 tools+response_format 同时启用，openai-compat 的 400 兜底会自动去掉
// response_format 重试，仍返回可被 parseJsonLoose 解析的内容。

const LABEL = "DeepSeek"
const MAX_SEARCHES = 4
const SEARCH_RESULTS = 10
const MAX_PAGE_READS = 5

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
    const searchVendor = args.searchRuntimeOverride?.vendor === "kimi" ? "kimi" : "ernie"
    const searchConfig = await getChatRuntimeSetting(searchVendor, {
      runtimeOverride: args.searchRuntimeOverride,
    })
    if (!config.apiKey) throw new Error("DeepSeek 严格联网缺少官方 API Key。")
    if (!searchConfig.apiKey) throw new Error("DeepSeek 严格联网缺少联网搜索 API Key。")
    if (!isOfficialDeepSeek(config.baseUrl)) {
      throw new Error("DeepSeek 严格联网必须使用 DeepSeek 官方 API 地址。")
    }
    const searchTimeoutSec = args.timeoutSec ?? searchConfig.timeout
    const search = searchVendor === "kimi"
      ? moonshotAuditableSearch(searchConfig.apiKey, searchConfig.baseUrl, searchTimeoutSec, SEARCH_RESULTS)
      : baiduAuditableSearch(searchConfig.apiKey, searchTimeoutSec, SEARCH_RESULTS)
    const requestedModel = args.runtimeOverride?.model?.trim()
      || process.env.DEEPSEEK_WEB_SEARCH_MODEL?.trim()
      || config.model
      || "deepseek-chat"
    const model = shouldUseToolCompatibleModel(requestedModel, args, config.baseUrl)
      ? "deepseek-chat"
      : requestedModel
    return chatWithAuditableExternalSearch({
      args,
      endpoint: buildAiChatUrl(config),
      apiKey: config.apiKey,
      model,
      label: LABEL,
      modelProvider: "deepseek",
      search,
      requestTimeoutSec: args.timeoutSec ?? config.timeout,
      temperature: args.temperature,
      maxSearches: MAX_SEARCHES,
      pageReads: MAX_PAGE_READS,
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
    extraBody: isTokenHub(config.baseUrl) ? { thinking: { type: "disabled" } } : fastJudgeExtraBody(args),
    forceSearchMode: args.forceWebSearch && isTokenHub(config.baseUrl) ? "presearch" : undefined,
    allowSpecifiedToolChoice: isTokenHub(config.baseUrl) ? false : undefined,
    ...args,
    timeoutSec: args.timeoutSec ?? config.timeout,
  })
}
