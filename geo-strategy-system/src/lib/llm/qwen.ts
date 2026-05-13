import { openaiCompatChat, type ChatArgs } from "./openai-compat"

// 通义千问 (DashScope) 适配器：开启官方联网搜索能力。
// 阿里云 DashScope OpenAI 兼容模式支持在 body 顶层注入 enable_search:true，
// 等价于 DashScope 原生 SDK 的 parameters.enable_search=true。
//   https://help.aliyun.com/zh/model-studio/use-qwen-by-calling-api#section-search-on-internet

const KEY = process.env.DASHSCOPE_API_KEY || ""
const MODEL = process.env.DASHSCOPE_MODEL || "qwen-plus"
// 允许通过环境变量关闭联网（默认开启）
const ENABLE_SEARCH = process.env.DASHSCOPE_ENABLE_SEARCH !== "false"

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
    extraBody: ENABLE_SEARCH
      ? {
          enable_search: true,
          // 强制要求模型在有联网结果时优先采信联网内容，避免老旧训练数据覆盖
          search_options: { forced_search: true },
        }
      : undefined,
  })
}
