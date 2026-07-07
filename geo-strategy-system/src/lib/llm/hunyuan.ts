import { openaiCompatChat, type ChatArgs } from "./openai-compat"
import { chatWithLocalWebSearchTool } from "./tool-loop"
import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"

// 腾讯元宝底层能力来自腾讯混元。这里接入混元 OpenAI 兼容接口，用于近似
// “腾讯元宝/混元”口径的公开回答检测。

export async function isHunyuanConfigured(): Promise<boolean> {
  const config = await getAiProviderRuntimeSetting("hunyuan")
  return !!config.apiKey
}

function isTokenHub(baseUrl: string): boolean {
  return /tokenhub\.tencentmaas\.com/i.test(baseUrl)
}

export async function chatHunyuan(args: ChatArgs): Promise<string> {
  const config = await getAiProviderRuntimeSetting("hunyuan")
  if (isTokenHub(config.baseUrl)) {
    if (args.forceWebSearch) {
      throw new Error("腾讯 TokenHub 当前不提供稳定可验证的官方联网来源；严格联网盲测已禁止本地检索兜底。")
    }
    return chatWithLocalWebSearchTool({
      url: buildAiChatUrl(config),
      apiKey: config.apiKey,
      model: config.model,
      label: "腾讯元宝/混元",
      forceSearchMode: args.forceWebSearch ? "presearch" : undefined,
      allowSpecifiedToolChoice: false,
      ...args,
      timeoutSec: args.timeoutSec ?? config.timeout,
    })
  }

  const enableEnhancement = config.extra.enableEnhancement === true
  const extraBody =
    args.forceWebSearch || (args.allowWebSearch !== false && args.mode === "consumer" && enableEnhancement)
      ? { enable_enhancement: true }
      : undefined

  return openaiCompatChat({
    url: buildAiChatUrl(config),
    apiKey: config.apiKey,
    model: config.model,
    label: "腾讯元宝/混元",
    ...args,
    extraBody,
    timeoutSec: args.timeoutSec ?? config.timeout,
  })
}
