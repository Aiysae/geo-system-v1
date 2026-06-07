import { openaiCompatChat, type ChatArgs } from "./openai-compat"

// 腾讯元宝底层能力来自腾讯混元。这里接入混元 OpenAI 兼容接口，用于近似
// “腾讯元宝/混元”口径的公开回答检测。

function apiKey(): string {
  return (
    process.env.TENCENT_HUNYUAN_API_KEY ||
    process.env.HUNYUAN_API_KEY ||
    process.env.TENCENT_TOKENHUB_API_KEY ||
    ""
  )
}

function model(): string {
  return (
    process.env.TENCENT_HUNYUAN_MODEL ||
    process.env.HUNYUAN_MODEL ||
    process.env.TENCENT_TOKENHUB_MODEL ||
    "hunyuan-turbos-latest"
  )
}

function url(): string {
  return (
    process.env.TENCENT_HUNYUAN_CHAT_URL ||
    process.env.HUNYUAN_CHAT_URL ||
    process.env.TENCENT_TOKENHUB_CHAT_URL ||
    "https://api.hunyuan.cloud.tencent.com/v1/chat/completions"
  )
}

export function isHunyuanConfigured(): boolean {
  return !!apiKey()
}

export async function chatHunyuan(args: ChatArgs): Promise<string> {
  const enableEnhancement = process.env.TENCENT_HUNYUAN_ENABLE_ENHANCEMENT === "true"
  const extraBody =
    args.forceWebSearch || (args.mode === "consumer" && enableEnhancement)
      ? { enable_enhancement: true }
      : undefined

  return openaiCompatChat({
    url: url(),
    apiKey: apiKey(),
    model: model(),
    label: "腾讯元宝/混元",
    ...args,
    extraBody,
  })
}
