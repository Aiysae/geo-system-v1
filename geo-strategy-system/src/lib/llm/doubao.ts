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
//   - 在后台配置了 Bot ID：走 bots 入口，吃 Bot 的原生联网插件。
//   - 否则：走 endpoint + search_web 工具循环外挂，保证依然联网。
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

export async function chatDoubao(args: ChatArgs): Promise<string> {
  const config = await getAiProviderRuntimeSetting("doubao")
  const key = config.apiKey
  const bot = typeof config.extra.botId === "string" ? config.extra.botId : ""
  const endpoint = config.model

  if (args.forceWebSearch && endpoint) {
    // 渗透率客观盲测要求"必须联网搜索"。Endpoint + 本地 search_web 工具
    // 可以在第一轮强制 tool_choice，便于审计搜索是否真实发生。
    return chatWithLocalWebSearchTool({
      url: ENDPOINT_URL,
      apiKey: key,
      model: endpoint,
      label: "豆包",
      ...args,
    })
  }

  if (bot) {
    // Bot 模式：原生联网插件，single-shot 即可。
    return openaiCompatChat({
      url: BOT_URL,
      apiKey: key,
      model: bot,
      label: "豆包",
      ...args,
    })
  }

  logEndpointFallbackOnce()
  return chatWithLocalWebSearchTool({
    url: ENDPOINT_URL,
    apiKey: key,
    model: endpoint,
    label: "豆包",
    ...args,
  })
}
