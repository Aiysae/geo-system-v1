import { openaiCompatChat, type ChatArgs } from "./openai-compat"
import { chatWithLocalWebSearchTool } from "./tool-loop"
import { getAiProviderRuntimeSetting } from "@/lib/ai-settings"

// 豆包 (Volcengine Ark) 适配器
//
// 两套对话入口：
//   1) Bot/Agent（推荐）—— /api/v3/bots/chat/completions，model=bot-xxxx。
//      在火山方舟控制台为 Bot 挂载"联网搜索"插件后，调用即享原生联网。
//   2) Endpoint Inference —— /api/v3/chat/completions，model=ep-xxxx。
//      本身没有联网插件；为满足"所有 AI 调用必须联网"的硬约束，
//      此路径强制接入本地 search_web Function Calling 兜底（与 DeepSeek 同款）。
//
// 因此：
//   - 渗透率客观盲测：只走纯净 Endpoint / 原始模型 ID + 本地 search_web 工具，严禁使用 Bot。
//   - 非盲测调研/分析：优先走 Bot，吃 Bot 的原生联网插件。
//
// 参考文档：
//   - https://www.volcengine.com/docs/82379/1099475 (Bot 调用)
//   - https://www.volcengine.com/docs/82379/1298454 (联网搜索插件)

const ENDPOINT_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions"
const BOT_URL = "https://ark.cn-beijing.volces.com/api/v3/bots/chat/completions"

let endpointFallbackInfoOnce = false
function logEndpointFallbackOnce() {
  if (endpointFallbackInfoOnce) return
  endpointFallbackInfoOnce = true
  console.log(
    [
      "[豆包·联网] 当前未配置 Bot ID，Endpoint 模式将使用本地 search_web 工具兜底联网。",
      "若希望启用豆包官方联网搜索，建议：",
      "  1) 在火山方舟控制台创建 Bot 并挂载『联网搜索』插件；",
      "  2) 在后台管理页的豆包模型中填写 Bot ID；",
      "  3) 保存后本适配器会自动切到 /bots/chat/completions。",
    ].join("\n")
  )
}

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
    if (!isRawArkModel(endpoint)) {
      throw new Error(
        `豆包客观盲测需要纯净模型：请在后台豆包「模型 / Endpoint」填写 ep- 开头的 Endpoint ID，或官方 doubao- 开头的模型 ID。当前值：「${endpoint || "空"}」。Bot ID 可能带知识库，模块一不会使用。`
      )
    }
    return chatWithLocalWebSearchTool({
      url: ENDPOINT_URL,
      apiKey: key,
      model: endpoint,
      label: "豆包",
      ...args,
      timeoutSec: args.timeoutSec ?? config.timeout,
    })
  }

  if (bot) {
    // Bot 模式仅用于非盲测调研/分析；模块一 forceWebSearch 会在上方提前返回。
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

  logEndpointFallbackOnce()
  return chatWithLocalWebSearchTool({
    url: ENDPOINT_URL,
    apiKey: key,
    model: endpoint,
    label: "豆包",
    ...args,
    timeoutSec: args.timeoutSec ?? config.timeout,
  })
}
