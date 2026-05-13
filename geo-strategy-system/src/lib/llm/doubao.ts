import { openaiCompatChat, type ChatArgs } from "./openai-compat"

// 豆包 (Volcengine Ark) 适配器
//
// 火山方舟有两套对话入口：
//   1) Endpoint Inference（基础模型推理）—— /api/v3/chat/completions，model 填 ep-xxxx
//      本身不挂插件，无内置联网。
//   2) Bot/Agent（智能体）—— /api/v3/bots/chat/completions，model 填 bot-xxxx
//      可在控制台为 Bot 挂载"联网搜索"插件，调用即享联网。
//
// 因此：
//   - 若设置了 ARK_DOUBAO_BOT_ID（推荐），自动走 bots 入口 → 真正联网。
//   - 否则继续走 endpoint，但每个进程会在首次调用时打印一次警告，
//     提醒用户去控制台创建挂载搜索插件的 Bot，并把环境变量替换为 Bot ID。
//
// 参考文档：
//   - https://www.volcengine.com/docs/82379/1099475 (Bot 调用)
//   - https://www.volcengine.com/docs/82379/1298454 (联网搜索插件)

const KEY = process.env.ARK_API_KEY || ""
const ENDPOINT = process.env.ARK_DOUBAO_ENDPOINT_ID || ""
const BOT_ID = process.env.ARK_DOUBAO_BOT_ID || ""

const ENDPOINT_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions"
const BOT_URL = "https://ark.cn-beijing.volces.com/api/v3/bots/chat/completions"

let endpointFallbackWarned = false
function warnEndpointFallbackOnce() {
  if (endpointFallbackWarned) return
  endpointFallbackWarned = true
  console.warn(
    [
      "[豆包·联网] ⚠️  当前使用的是基础 Endpoint Inference (ARK_DOUBAO_ENDPOINT_ID)，",
      "该入口本身没有内置联网搜索能力。",
      "若需要让豆包获取最新资讯，请到火山方舟控制台：",
      "  1) 创建一个智能体 (Bot) 并挂载 '联网搜索' 插件；",
      "  2) 在 .env.local 中新增 ARK_DOUBAO_BOT_ID=bot-xxxx；",
      "  3) 重启服务后本适配器会自动切到 /bots/chat/completions 走联网。",
    ].join("\n")
  )
}

export function isDoubaoConfigured(): boolean {
  return !!KEY && (!!BOT_ID || !!ENDPOINT)
}

export async function chatDoubao(args: ChatArgs): Promise<string> {
  if (BOT_ID) {
    return openaiCompatChat({
      url: BOT_URL,
      apiKey: KEY,
      model: BOT_ID,
      label: "豆包",
      ...args,
    })
  }

  warnEndpointFallbackOnce()
  return openaiCompatChat({
    url: ENDPOINT_URL,
    apiKey: KEY,
    model: ENDPOINT,
    label: "豆包",
    ...args,
  })
}
