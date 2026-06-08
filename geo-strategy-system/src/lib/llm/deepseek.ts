import { chatWithLocalWebSearchTool } from "./tool-loop"
import type { ChatArgs } from "./openai-compat"
import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"

// DeepSeek 适配器
//
// 官方 DeepSeek API 不像千问 / Kimi 那样自带"联网开关"。本适配器在代码层为它"外挂搜索"。
// 渗透率客观盲测会在第一轮强制 search_web Function Calling；裁判/分析路径默认带工具。
// jsonMode 透传给底层，
// 万一上游不接受 tools+response_format 同时启用，openai-compat 的 400 兜底会自动去掉
// response_format 重试，仍返回可被 parseJsonLoose 解析的内容。

const LABEL = "DeepSeek"

function isTokenHub(baseUrl: string): boolean {
  return /tokenhub\.tencentmaas\.com/i.test(baseUrl)
}

function shouldUseToolCompatibleModel(model: string, args: ChatArgs, baseUrl: string): boolean {
  if (isTokenHub(baseUrl)) return false
  if (!args.forceWebSearch && args.mode === "consumer") return false
  return args.forceWebSearch || /reasoner|thinking|r1|v4/i.test(model)
}

export async function isDeepSeekConfigured(): Promise<boolean> {
  const config = await getAiProviderRuntimeSetting("deepseek")
  return !!config.apiKey
}

export async function chatDeepSeek(args: ChatArgs): Promise<string> {
  const config = await getAiProviderRuntimeSetting("deepseek")
  if (!config.apiKey) {
    console.warn("[DeepSeek] API Key is undefined（请在后台管理页配置 DeepSeek 模型）")
    throw new Error(`${LABEL} 接口配置缺失：请在后台管理页配置 API Key 和模型。`)
  }
  const model = shouldUseToolCompatibleModel(config.model, args, config.baseUrl) ? "deepseek-chat" : config.model
  if (model !== config.model) {
    console.log(`[DeepSeek·联网] ${config.model} 不支持强制工具调用，本次联网检测自动切换到 ${model}`)
  }
  return chatWithLocalWebSearchTool({
    url: buildAiChatUrl(config),
    apiKey: config.apiKey,
    model,
    label: LABEL,
    extraBody: isTokenHub(config.baseUrl) ? { thinking: { type: "disabled" } } : undefined,
    ...args,
  })
}
