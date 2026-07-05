import { openaiCompatChat, type ChatArgs } from "./openai-compat"
import { chatWithLocalWebSearchTool } from "./tool-loop"
import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"

// 通义千问 (DashScope) 适配器。
// 默认不启用阿里百炼官方联网插件，避免 DashScope enable_search 产生独立插件费用。
// 需要可审计联网时，默认走本地公开网页预检索；如确实要使用官方插件，可在后台打开 enableSearch。
//   https://help.aliyun.com/zh/model-studio/use-qwen-by-calling-api#section-search-on-internet

export async function isQwenConfigured(): Promise<boolean> {
  const config = await getAiProviderRuntimeSetting("qwen")
  return !!config.apiKey
}

export async function chatQwen(args: ChatArgs): Promise<string> {
  const config = await getAiProviderRuntimeSetting("qwen")
  const enableOfficialSearch = config.extra.enableSearch === true
  const shouldSearch =
    args.forceWebSearch || (args.allowWebSearch !== false && args.mode !== "consumer")

  if (args.forceWebSearch && !enableOfficialSearch) {
    return chatWithLocalWebSearchTool({
      url: buildAiChatUrl(config),
      apiKey: config.apiKey,
      model: config.model,
      label: "通义千问",
      forceSearchMode: "presearch",
      allowSpecifiedToolChoice: false,
      ...args,
      timeoutSec: args.timeoutSec ?? config.timeout,
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
