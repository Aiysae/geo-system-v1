import { openaiCompatChat, type ChatArgs } from "./openai-compat"

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
  })
}
