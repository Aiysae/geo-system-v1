import { openaiCompatChat, type ChatArgs } from "./openai-compat"
import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { getChatRuntimeSetting } from "@/lib/llm/runtime-config"
import { chatDashScopeNativeSearch } from "./dashscope-native-search"

// 通义千问 (DashScope) 适配器。
// 疑问句检测严格模式使用 DashScope 原生接口强制联网并返回结构化信源。

export async function isQwenConfigured(): Promise<boolean> {
  const config = await getAiProviderRuntimeSetting("qwen")
  return !!config.apiKey
}

export async function chatQwen(args: ChatArgs): Promise<string> {
  const config = await getChatRuntimeSetting("qwen", args)
  const enableOfficialSearch = config.extra.enableSearch === true
  const shouldSearch =
    args.forceWebSearch || (args.allowWebSearch !== false && args.mode !== "consumer")

  if (args.forceWebSearch && !enableOfficialSearch) {
    throw new Error("通义千问严格联网盲测需要在后台开启百炼官方联网搜索插件，当前已禁止本地检索兜底。")
  }

  if (
    args.forceWebSearch &&
    args.officialWebOnly &&
    args.requireWebEvidence &&
    args.mode === "consumer"
  ) {
    return chatDashScopeNativeSearch({
      ...args,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      timeoutSec: args.timeoutSec ?? config.timeout,
      label: "通义千问",
    })
  }

  const extraBody =
    shouldSearch && enableOfficialSearch
      ? {
          enable_search: true,
          search_options: { forced_search: true },
        }
      : undefined

  return openaiCompatChat({
    url: buildAiChatUrl(config),
    apiKey: config.apiKey,
    model: config.model,
    label: "通义千问",
    ...args,
    extraBody,
    timeoutSec: args.timeoutSec ?? config.timeout,
  })
}
