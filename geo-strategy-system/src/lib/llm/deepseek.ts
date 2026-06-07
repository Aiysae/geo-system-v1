import { chatWithLocalWebSearchTool } from "./tool-loop"
import type { ChatArgs } from "./openai-compat"

// DeepSeek 适配器
//
// 官方 DeepSeek API 不像千问 / Kimi 那样自带"联网开关"。本适配器在代码层为它"外挂搜索"。
// 渗透率客观盲测会在第一轮强制 search_web Function Calling；裁判/分析路径默认带工具。
// jsonMode 透传给底层，
// 万一上游不接受 tools+response_format 同时启用，openai-compat 的 400 兜底会自动去掉
// response_format 重试，仍返回可被 parseJsonLoose 解析的内容。

const URL = "https://api.deepseek.com/v1/chat/completions"
const LABEL = "DeepSeek"

function apiKey(): string {
  return process.env.DEEPSEEK_API_KEY || ""
}

function model(): string {
  return process.env.DEEPSEEK_MODEL || "deepseek-chat"
}

export function isDeepSeekConfigured(): boolean {
  return !!apiKey()
}

export async function chatDeepSeek(args: ChatArgs): Promise<string> {
  const key = apiKey()
  if (!key) {
    console.warn("[DeepSeek] API Key is undefined（process.env.DEEPSEEK_API_KEY 为空，请检查 .env.local）")
    throw new Error(`${LABEL} 接口配置缺失：未读取到环境变量 DEEPSEEK_API_KEY。`)
  }
  return chatWithLocalWebSearchTool({
    url: URL,
    apiKey: key,
    model: model(),
    label: LABEL,
    ...args,
  })
}
