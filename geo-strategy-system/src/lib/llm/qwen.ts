import { openaiCompatChat, type ChatArgs } from "./openai-compat"
import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"

// 通义千问 (DashScope) 适配器。
// 渗透率客观盲测会通过 forceWebSearch 强制开启官方联网搜索；分析/裁判路径默认联网。
// 阿里云 DashScope OpenAI 兼容模式支持在 body 顶层注入 enable_search:true。
//   https://help.aliyun.com/zh/model-studio/use-qwen-by-calling-api#section-search-on-internet

export async function isQwenConfigured(): Promise<boolean> {
  const config = await getAiProviderRuntimeSetting("qwen")
  return !!config.apiKey
}

export async function chatQwen(args: ChatArgs): Promise<string> {
  const config = await getAiProviderRuntimeSetting("qwen")
  const extraBody =
    args.forceWebSearch || args.mode !== "consumer"
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
  })
}
