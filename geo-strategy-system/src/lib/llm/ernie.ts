import { openaiCompatChat, type ChatArgs } from "./openai-compat"

// 文心一言 / 百度千帆 V2 适配器（OpenAI 兼容接口）。
// 生产上建议使用支持联网搜索的 ERNIE 4.5 系列模型；若所选模型不支持 web_search，
// 可通过 BAIDU_QIANFAN_ENABLE_SEARCH=false 关闭联网参数。

function apiKey(): string {
  return process.env.BAIDU_QIANFAN_API_KEY || process.env.QIANFAN_API_KEY || ""
}

function model(): string {
  return process.env.BAIDU_QIANFAN_MODEL || process.env.QIANFAN_MODEL || "ernie-4.5-turbo-32k"
}

function url(): string {
  return (
    process.env.BAIDU_QIANFAN_CHAT_URL ||
    process.env.QIANFAN_CHAT_URL ||
    "https://qianfan.baidubce.com/v2/chat/completions"
  )
}

export function isErnieConfigured(): boolean {
  return !!apiKey()
}

export async function chatErnie(args: ChatArgs): Promise<string> {
  const enableSearch = process.env.BAIDU_QIANFAN_ENABLE_SEARCH !== "false"
  const appId = process.env.BAIDU_QIANFAN_APP_ID || process.env.QIANFAN_APP_ID || ""
  const extraBody =
    args.mode === "consumer" && enableSearch
      ? { web_search: { enable: true, enable_trace: false } }
      : undefined
  const extraHeaders = appId ? { appid: appId } : undefined

  return openaiCompatChat({
    url: url(),
    apiKey: apiKey(),
    model: model(),
    label: "文心一言",
    ...args,
    extraBody,
    extraHeaders,
  })
}
