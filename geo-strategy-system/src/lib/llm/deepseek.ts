import { openaiCompatChat, type ChatArgs } from "./openai-compat"

const KEY = process.env.DEEPSEEK_API_KEY || ""

export function isDeepSeekConfigured(): boolean {
  return !!KEY
}

export async function chatDeepSeek(args: ChatArgs): Promise<string> {
  return openaiCompatChat({
    url: "https://api.deepseek.com/v1/chat/completions",
    apiKey: KEY,
    model: "deepseek-chat",
    label: "DeepSeek",
    ...args,
  })
}
