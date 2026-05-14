import { chatWithLocalWebSearchTool } from "./tool-loop"
import type { ChatArgs } from "./openai-compat"

// DeepSeek 适配器
//
// 官方 DeepSeek API 不像千问 / Kimi 那样自带"联网开关"。本适配器在代码层为它"外挂搜索"：
// 所有调用（包括 jsonMode=true 的"裁判"路径）都强制走 search_web Function Calling 工具循环，
// 严格满足"所有 AI 调用都必须联网"的约束。jsonMode 透传给底层，
// 万一上游不接受 tools+response_format 同时启用，openai-compat 的 400 兜底会自动去掉
// response_format 重试，仍返回可被 parseJsonLoose 解析的内容。

const KEY = process.env.DEEPSEEK_API_KEY || ""
const URL = "https://api.deepseek.com/v1/chat/completions"
const MODEL = "deepseek-chat"
const LABEL = "DeepSeek"

export function isDeepSeekConfigured(): boolean {
  return !!KEY
}

export async function chatDeepSeek(args: ChatArgs): Promise<string> {
  if (!KEY) {
    console.warn("[DeepSeek] API Key is undefined（process.env.DEEPSEEK_API_KEY 为空，请检查 .env.local）")
    throw new Error(`${LABEL} 接口配置缺失：未读取到环境变量 DEEPSEEK_API_KEY。`)
  }
  return chatWithLocalWebSearchTool({
    url: URL,
    apiKey: KEY,
    model: MODEL,
    label: LABEL,
    ...args,
  })
}
