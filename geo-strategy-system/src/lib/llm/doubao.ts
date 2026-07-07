import { openaiCompatChat, type ChatArgs } from "./openai-compat"
import { getAiProviderRuntimeSetting } from "@/lib/ai-settings"

// 豆包 (Volcengine Ark) 适配器
//
// 两套对话入口：
//   1) Bot/Agent（推荐）—— /api/v3/bots/chat/completions，model=bot-xxxx。
//      在火山方舟控制台为 Bot 挂载"联网搜索"插件后，调用即享原生联网。
//   2) Endpoint Inference —— /api/v3/chat/completions，model=ep-xxxx。
//      Endpoint 本身没有官方联网插件。疑问句检测严格模式禁止再用本地 search_web 兜底。
//
// 因此：
//   - 渗透率客观盲测：只走挂载官方联网搜索插件的干净 Bot/Agent。
//   - 非盲测调研/分析：优先走 Bot，吃 Bot 的原生联网插件。
//
// 参考文档：
//   - https://www.volcengine.com/docs/82379/1099475 (Bot 调用)
//   - https://www.volcengine.com/docs/82379/1298454 (联网搜索插件)

const ENDPOINT_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions"
const BOT_URL = "https://ark.cn-beijing.volces.com/api/v3/bots/chat/completions"

export async function isDoubaoConfigured(): Promise<boolean> {
  const config = await getAiProviderRuntimeSetting("doubao")
  const botId = typeof config.extra.botId === "string" ? config.extra.botId : ""
  return !!config.apiKey && (!!botId || !!config.model)
}

function isRawArkModel(model: string): boolean {
  return model.startsWith("ep-") || model.startsWith("doubao-")
}

export async function chatDoubao(args: ChatArgs): Promise<string> {
  const config = await getAiProviderRuntimeSetting("doubao")
  const key = config.apiKey
  const bot = typeof config.extra.botId === "string" ? config.extra.botId : ""
  const endpoint = config.model

  if (args.forceWebSearch) {
    if (!bot) {
      throw new Error(
        "豆包严格联网盲测需要在火山方舟配置挂载『联网搜索』插件的干净 Bot ID。当前已禁止 Endpoint 本地检索兜底。"
      )
    }
    return openaiCompatChat({
      url: BOT_URL,
      apiKey: key,
      model: bot,
      label: "豆包",
      ...args,
      timeoutSec: args.timeoutSec ?? config.timeout,
    })
  }

  if (bot) {
    // Bot 模式仅用于非盲测调研/分析；渗透率盲测 forceWebSearch 会在上方提前返回。
    return openaiCompatChat({
      url: BOT_URL,
      apiKey: key,
      model: bot,
      label: "豆包",
      ...args,
      timeoutSec: args.timeoutSec ?? config.timeout,
    })
  }

  if (!isRawArkModel(endpoint)) {
    throw new Error(
      `豆包 Endpoint/模型配置错误：当前填写的是「${endpoint || "空"}」。火山方舟 /chat/completions 需要 ep- 开头的 Endpoint ID，或官方 doubao- 开头的模型 ID；如果你有 bot- 开头的 Bot，请填到后台豆包配置的 Bot ID 字段。`
    )
  }

  return openaiCompatChat({
    url: ENDPOINT_URL,
    apiKey: key,
    model: endpoint,
    label: "豆包",
    ...args,
    timeoutSec: args.timeoutSec ?? config.timeout,
  })
}
