import { openaiCompatChat, type ChatArgs } from "./openai-compat"

// 通义千问 (DashScope) 适配器。
// 渗透率客观盲测会通过 forceWebSearch 强制开启官方联网搜索；分析/裁判路径默认联网。
// 阿里云 DashScope OpenAI 兼容模式支持在 body 顶层注入 enable_search:true。
//   https://help.aliyun.com/zh/model-studio/use-qwen-by-calling-api#section-search-on-internet

function apiKey(): string {
  return process.env.DASHSCOPE_API_KEY || ""
}

function model(): string {
  return process.env.DASHSCOPE_MODEL || "qwen-plus"
}

export function isQwenConfigured(): boolean {
  return !!apiKey()
}

export async function chatQwen(args: ChatArgs): Promise<string> {
  const extraBody =
    args.forceWebSearch || args.mode !== "consumer"
      ? {
          enable_search: true,
          search_options: { forced_search: true },
        }
      : undefined

  return openaiCompatChat({
    url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    apiKey: apiKey(),
    model: model(),
    label: "通义千问",
    ...args,
    extraBody,
  })
}
