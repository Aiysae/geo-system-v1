import { openaiCompatChat, type ChatArgs } from "./openai-compat"

// 通义千问 (DashScope) 适配器：始终开启官方联网搜索能力，不允许 opt-out。
// 阿里云 DashScope OpenAI 兼容模式支持在 body 顶层注入 enable_search:true。
//   https://help.aliyun.com/zh/model-studio/use-qwen-by-calling-api#section-search-on-internet

const KEY = process.env.DASHSCOPE_API_KEY || ""
const MODEL = process.env.DASHSCOPE_MODEL || "qwen-plus"

export function isQwenConfigured(): boolean {
  return !!KEY
}

export async function chatQwen(args: ChatArgs): Promise<string> {
  return openaiCompatChat({
    url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    apiKey: KEY,
    model: MODEL,
    label: "通义千问",
    ...args,
    // ★ 联网硬开关：所有调用（含裁判）一律强制联网，不读 DASHSCOPE_ENABLE_SEARCH。
    //   forced_search: true 让模型在有联网结果时优先采信网页内容，覆盖陈旧训练数据。
    extraBody: {
      enable_search: true,
      search_options: { forced_search: true },
    },
  })
}
