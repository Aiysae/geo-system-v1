import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { hasAdapterCredentialPoolCandidate } from "@/lib/ai-credential-adapter"
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
  const poolReady = await hasAdapterCredentialPoolCandidate(model, "penetration", {
    system: "",
    user: "",
    mode: "consumer",
    forceWebSearch: true,
    rawQuestionOnly: true,
    requireWebEvidence: true,
    officialWebOnly: true,
  })
  if (poolReady) return { model, ready: true }

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
    const kimiConfig = await getAiProviderRuntimeSetting("kimi")
    if (!kimiConfig.apiKey) return { model, ready: false, reason: "Moonshot API Key 未配置" }
    if (!officialHost(buildAiChatUrl(kimiConfig), /(^|\.)moonshot\.cn$/i)) {
      return { model, ready: false, reason: "Kimi 严格联网必须使用 Moonshot 国内官方地址" }
    }
    const baiduConfig = await getAiProviderRuntimeSetting("ernie")
    if (!baiduConfig.apiKey) {
      return { model, ready: false, reason: "Kimi 严格联网需要百度千帆搜索 API Key" }
    }
    return { model, ready: true }
  }

  return { model, ready: false, reason: "未识别的检测模型" }
}
