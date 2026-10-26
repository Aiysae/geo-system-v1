import type {
  AiCredentialCapability,
  AiCredentialModule,
  AiCredentialVendor,
} from "@/types/ai-credentials"

export interface AiCredentialVendorPreset {
  vendor: AiCredentialVendor
  label: string
  baseUrl: string
  chatPath: string
  defaultModels: string[]
  allowedModules: AiCredentialModule[]
  declaredCapabilities: AiCredentialCapability[]
  defaultConcurrency: number
}

export const AI_CREDENTIAL_VENDOR_PRESETS: AiCredentialVendorPreset[] = [
  {
    vendor: "doubao",
    label: "豆包 / 火山方舟",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    chatPath: "/chat/completions",
    defaultModels: ["doubao-seed-2-0-lite-260428"],
    allowedModules: [
      "article",
      "question",
      "research",
      "diagnosis",
      "difficulty",
      "penetration",
    ],
    declaredCapabilities: ["chat", "json", "long_text", "native_web", "auditable_sources"],
    defaultConcurrency: 1,
  },
  {
    vendor: "qwen",
    label: "通义千问 / 阿里云百炼",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    chatPath: "/chat/completions",
    defaultModels: ["qwen-plus"],
    allowedModules: [
      "article",
      "question",
      "keywordStrategy",
      "research",
      "diagnosis",
      "difficulty",
      "penetration",
      "judge",
    ],
    declaredCapabilities: ["chat", "json", "long_text", "vision", "native_web", "auditable_sources"],
    defaultConcurrency: 3,
  },
  {
    vendor: "hunyuan",
    label: "腾讯混元",
    baseUrl: "https://tokenhub.tencentmaas.com",
    chatPath: "/v1/chat/completions",
    defaultModels: ["hy3"],
    allowedModules: [
      "article",
      "question",
      "research",
      "diagnosis",
      "difficulty",
      "penetration",
      "judge",
    ],
    declaredCapabilities: ["chat", "json", "long_text", "vision", "native_web", "auditable_sources"],
    defaultConcurrency: 2,
  },
  {
    vendor: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    chatPath: "/chat/completions",
    defaultModels: ["deepseek-v4-flash", "deepseek-v4-pro"],
    allowedModules: ["article", "question", "keywordStrategy", "research", "diagnosis", "difficulty", "penetration", "judge"],
    declaredCapabilities: ["chat", "json", "long_text"],
    defaultConcurrency: 3,
  },
  {
    vendor: "kimi",
    label: "Kimi / Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    chatPath: "/chat/completions",
    defaultModels: ["kimi-k2.6"],
    allowedModules: ["article", "question", "research", "diagnosis", "difficulty", "penetration", "judge"],
    declaredCapabilities: ["chat", "json", "long_text", "vision", "native_web"],
    defaultConcurrency: 1,
  },
  {
    vendor: "ernie",
    label: "文心一言 / 百度千帆",
    baseUrl: "https://qianfan.baidubce.com/v2",
    chatPath: "/chat/completions",
    defaultModels: ["ernie-4.5-turbo-32k"],
    allowedModules: [
      "article",
      "question",
      "research",
      "diagnosis",
      "difficulty",
      "penetration",
      "judge",
    ],
    declaredCapabilities: ["chat", "json", "long_text", "vision", "native_web", "auditable_sources"],
    defaultConcurrency: 2,
  },
  {
    vendor: "minimax",
    label: "MiniMax",
    baseUrl: "https://api.minimaxi.com",
    chatPath: "/v1/text/chatcompletion_v2",
    defaultModels: ["MiniMax-M3"],
    allowedModules: ["article", "question", "research", "diagnosis", "difficulty"],
    declaredCapabilities: ["chat", "json", "long_text", "vision"],
    defaultConcurrency: 2,
  },
  {
    vendor: "zhipu",
    label: "智谱 AI",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    chatPath: "/chat/completions",
    defaultModels: ["glm-5.1"],
    allowedModules: ["article", "question", "research", "diagnosis", "difficulty", "penetration", "judge"],
    declaredCapabilities: ["chat", "json", "long_text", "vision", "native_web", "auditable_sources"],
    defaultConcurrency: 2,
  },
  {
    // Search only. Hunyuan question detection searches through it, as the
    // Yuanbao App does; the API Key comes from Tencent Cloud's Yuanbao search.
    vendor: "yuanbao_search",
    label: "元宝搜索（腾讯云）",
    baseUrl: "https://api.wsa.cloud.tencent.com",
    chatPath: "/SearchPro",
    defaultModels: ["SearchPro"],
    allowedModules: ["penetration"],
    declaredCapabilities: ["native_web", "auditable_sources"],
    // Each answer runs a few searches at under a second each; 20 per second
    // is the plan's cap.
    defaultConcurrency: 20,
  },
]

/** Accounts that only search, for another vendor's model to answer from. */
export const SEARCH_ONLY_CREDENTIAL_VENDORS = new Set<AiCredentialVendor>(["yuanbao_search"])

export function isSearchOnlyCredentialVendor(vendor: AiCredentialVendor): boolean {
  return SEARCH_ONLY_CREDENTIAL_VENDORS.has(vendor)
}

export const AI_CREDENTIAL_PRESET_BY_VENDOR = new Map(
  AI_CREDENTIAL_VENDOR_PRESETS.map(preset => [preset.vendor, preset]),
)
