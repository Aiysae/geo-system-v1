import { openaiCompatChat, type ChatArgs } from "./openai-compat"

const KEY = process.env.MOONSHOT_API_KEY || ""
const MODEL = process.env.MOONSHOT_MODEL || "moonshot-v1-8k"

export function isKimiConfigured(): boolean {
  return !!KEY
}

export async function chatKimi(args: ChatArgs): Promise<string> {
  return openaiCompatChat({
    url: "https://api.moonshot.cn/v1/chat/completions",
    apiKey: KEY,
    model: MODEL,
    label: "Kimi",
    ...args,
  })
}
