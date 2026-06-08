import { openaiCompatChat, type ChatArgs } from "./openai-compat"
import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"

// 文心一言 / 百度千帆 V2 适配器（OpenAI 兼容接口）。
// 生产上建议使用支持联网搜索的 ERNIE 4.5 系列模型；若所选模型不支持 web_search，
// 可在后台管理页关闭联网参数。

export async function isErnieConfigured(): Promise<boolean> {
  const config = await getAiProviderRuntimeSetting("ernie")
  return !!config.apiKey
}

export async function chatErnie(args: ChatArgs): Promise<string> {
  const config = await getAiProviderRuntimeSetting("ernie")
  const enableSearch = config.extra.enableSearch !== false
  const appId = typeof config.extra.appId === "string" ? config.extra.appId : ""
  const extraBody =
    args.forceWebSearch || (args.mode === "consumer" && enableSearch)
      ? { web_search: { enable: true, enable_trace: false } }
      : undefined
  const extraHeaders = appId ? { appid: appId } : undefined

  return openaiCompatChat({
    url: buildAiChatUrl(config),
    apiKey: config.apiKey,
    model: config.model,
    label: "文心一言",
    ...args,
    extraBody,
    extraHeaders,
  })
}
