import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { ADAPTERS } from "@/lib/llm"
import type { ModelKey } from "@/types"

export interface PenetrationModelReadiness {
  model: ModelKey
  ready: boolean
  reason?: string
}

function officialHost(value: string, expected: RegExp): boolean {
  try {
    return expected.test(new URL(value).hostname)
  } catch {
    return false
  }
}

export async function getPenetrationModelReadiness(
  model: ModelKey,
): Promise<PenetrationModelReadiness> {
  if (model === "doubao") {
    const config = await getAiProviderRuntimeSetting("doubao")
    if (!config.apiKey) return { model, ready: false, reason: "火山方舟 API Key 未配置" }
    if (!/^(?:doubao-|ep-)/i.test(config.model)) {
      return { model, ready: false, reason: "严格联网需要 doubao- 或 ep- 开头的火山方舟模型" }
    }
    return { model, ready: true }
  }

  if (model === "qwen" || model === "deepseek") {
    const config = await getAiProviderRuntimeSetting("qwen")
    if (!config.apiKey) {
      return { model, ready: false, reason: "严格联网需要阿里云百炼 API Key" }
    }
    if (!officialHost(config.baseUrl, /(^|\.)dashscope\.aliyuncs\.com$/i)) {
      return { model, ready: false, reason: "严格联网必须使用阿里云百炼官方地址" }
    }
    if (model === "qwen" && config.extra.enableSearch !== true) {
      return { model, ready: false, reason: "百炼官方联网搜索开关未开启" }
    }
    return { model, ready: true }
  }

  if (model === "ernie") {
    const config = await getAiProviderRuntimeSetting("ernie")
    if (!config.apiKey) return { model, ready: false, reason: "百度千帆 API Key 未配置" }
    return { model, ready: true }
  }

  if (model === "hunyuan") {
    const config = await getAiProviderRuntimeSetting("hunyuan")
    if (!config.apiKey) return { model, ready: false, reason: "腾讯 TokenHub API Key 未配置" }
    if (!officialHost(buildAiChatUrl(config), /(^|\.)tokenhub\.tencentmaas\.com$/i)) {
      return { model, ready: false, reason: "严格联网必须使用腾讯 TokenHub HY3 官方地址" }
    }
    return { model, ready: true }
  }

  if (model === "kimi") {
    const generalConfigured = await ADAPTERS.kimi.configured()
    if (!generalConfigured) return { model, ready: false, reason: "Moonshot API Key 未配置" }
    if (process.env.KIMI_STRICT_WEB_ENABLED !== "true") {
      return {
        model,
        ready: false,
        reason: "Kimi K2.6 当前无法稳定同时保证强制联网和返回可审计网址，已在任务开始前停用",
      }
    }
    const baiduConfig = await getAiProviderRuntimeSetting("ernie")
    if (!baiduConfig.apiKey) {
      return { model, ready: false, reason: "Kimi 严格联网需要已验证的百度千帆 AI 搜索配置" }
    }
    return { model, ready: true }
  }

  return { model, ready: false, reason: "未识别的检测模型" }
}
