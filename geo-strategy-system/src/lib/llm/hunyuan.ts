import { openaiCompatChat, type ChatArgs } from "./openai-compat"
import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"

// 腾讯元宝底层能力来自腾讯混元。这里接入混元 OpenAI 兼容接口，用于近似
// “腾讯元宝/混元”口径的公开回答检测。

export async function isHunyuanConfigured(): Promise<boolean> {
  const config = await getAiProviderRuntimeSetting("hunyuan")
  return !!config.apiKey
}

export async function chatHunyuan(args: ChatArgs): Promise<string> {
  const config = await getAiProviderRuntimeSetting("hunyuan")
  const enableEnhancement = config.extra.enableEnhancement === true
  const extraBody =
    args.forceWebSearch || (args.mode === "consumer" && enableEnhancement)
      ? { enable_enhancement: true }
      : undefined

  return openaiCompatChat({
    url: buildAiChatUrl(config),
    apiKey: config.apiKey,
    model: config.model,
    label: "腾讯元宝/混元",
    ...args,
    extraBody,
  })
}
