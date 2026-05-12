import { openaiCompatChat, type ChatArgs } from "./openai-compat"

const KEY = process.env.ARK_API_KEY || ""
const ENDPOINT = process.env.ARK_DOUBAO_ENDPOINT_ID || ""

export function isDoubaoConfigured(): boolean {
  return !!KEY && !!ENDPOINT
}

export async function chatDoubao(args: ChatArgs): Promise<string> {
  return openaiCompatChat({
    url: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    apiKey: KEY,
    model: ENDPOINT,
    label: "豆包",
    ...args,
  })
}
