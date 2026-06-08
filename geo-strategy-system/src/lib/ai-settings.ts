import "server-only"

import { kv } from "@vercel/kv"
import type {
  AiProviderExtraField,
  AiProviderKey,
  AiProviderPublicSetting,
  AiProviderRuntimeSetting,
} from "@/types/ai-settings"

interface AiProviderDefinition {
  key: AiProviderKey
  label: string
  description: string
  defaultBaseUrl: string
  defaultChatPath: string
  defaultModel: string
  defaultTimeout: number
  apiKeyEnv: string[]
  modelEnv: string[]
  baseUrlEnv?: string[]
  urlEnv?: string[]
  chatPathEnv?: string[]
  timeoutEnv?: string[]
  extraEnv?: Record<string, string[]>
  extraDefaults?: Record<string, string | boolean>
  extraFields?: AiProviderExtraField[]
}

interface StoredAiProviderSetting {
  apiKey?: string
  baseUrl?: string
  chatPath?: string
  model?: string
  timeout?: number
  extra?: Record<string, string | boolean>
  updatedAt?: string
  updatedBy?: string
}

const SETTINGS_KEY = "system:ai-model-settings"

const DEFINITIONS: AiProviderDefinition[] = [
  {
    key: "keywordStrategy",
    label: "关键词策略生成",
    description: "用于关键词策略模块的资料抽取、优势生成、策略生成和疑问句池生成。",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
    defaultChatPath: "/v1/chat/completions",
    defaultModel: "qwen3-vl-plus",
    defaultTimeout: 900,
    apiKeyEnv: ["KEYWORD_STRATEGY_API_KEY", "DASHSCOPE_API_KEY", "OPENAI_API_KEY"],
    modelEnv: ["KEYWORD_STRATEGY_MODEL"],
    baseUrlEnv: ["KEYWORD_STRATEGY_BASE_URL"],
    chatPathEnv: ["KEYWORD_STRATEGY_CHAT_PATH"],
    timeoutEnv: ["KEYWORD_STRATEGY_TIMEOUT"],
  },
  {
    key: "doubao",
    label: "豆包",
    description: "用于疑问句生成、独立调研、竞品对比和渗透率检测。",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultChatPath: "/chat/completions",
    defaultModel: "",
    defaultTimeout: 300,
    apiKeyEnv: ["ARK_API_KEY"],
    modelEnv: ["ARK_DOUBAO_ENDPOINT_ID"],
    extraEnv: { botId: ["ARK_DOUBAO_BOT_ID"] },
    extraFields: [
      { key: "botId", label: "Bot ID（可选）", placeholder: "bot-xxxx，优先用于非强制联网场景" },
    ],
  },
  {
    key: "deepseek",
    label: "DeepSeek",
    description: "用于诊断、裁判和无原生联网模型的工具搜索兜底。",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultChatPath: "/v1/chat/completions",
    defaultModel: "deepseek-chat",
    defaultTimeout: 300,
    apiKeyEnv: ["DEEPSEEK_API_KEY"],
    modelEnv: ["DEEPSEEK_MODEL"],
  },
  {
    key: "qwen",
    label: "通义千问",
    description: "用于渗透率检测和结构化裁判，可开启 DashScope 联网搜索。",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
    defaultChatPath: "/v1/chat/completions",
    defaultModel: "qwen-plus",
    defaultTimeout: 300,
    apiKeyEnv: ["DASHSCOPE_API_KEY"],
    modelEnv: ["DASHSCOPE_MODEL"],
  },
  {
    key: "kimi",
    label: "Kimi",
    description: "用于渗透率检测和结构化裁判，支持 Moonshot 官方联网工具。",
    defaultBaseUrl: "https://api.moonshot.cn",
    defaultChatPath: "/v1/chat/completions",
    defaultModel: "moonshot-v1-8k",
    defaultTimeout: 300,
    apiKeyEnv: ["MOONSHOT_API_KEY"],
    modelEnv: ["MOONSHOT_MODEL"],
  },
  {
    key: "ernie",
    label: "文心一言",
    description: "用于渗透率检测，可配置百度千帆 V2 兼容接口。",
    defaultBaseUrl: "https://qianfan.baidubce.com",
    defaultChatPath: "/v2/chat/completions",
    defaultModel: "ernie-4.5-turbo-32k",
    defaultTimeout: 300,
    apiKeyEnv: ["BAIDU_QIANFAN_API_KEY", "QIANFAN_API_KEY"],
    modelEnv: ["BAIDU_QIANFAN_MODEL", "QIANFAN_MODEL"],
    baseUrlEnv: ["BAIDU_QIANFAN_BASE_URL", "QIANFAN_BASE_URL"],
    urlEnv: ["BAIDU_QIANFAN_CHAT_URL", "QIANFAN_CHAT_URL"],
    extraDefaults: { enableSearch: true },
    extraEnv: {
      appId: ["BAIDU_QIANFAN_APP_ID", "QIANFAN_APP_ID"],
      enableSearch: ["BAIDU_QIANFAN_ENABLE_SEARCH", "QIANFAN_ENABLE_SEARCH"],
    },
    extraFields: [
      { key: "appId", label: "App ID（可选）", placeholder: "百度千帆 appid" },
      { key: "enableSearch", label: "启用联网参数", inputType: "checkbox" },
    ],
  },
  {
    key: "hunyuan",
    label: "腾讯元宝/混元",
    description: "用于渗透率检测，可配置腾讯混元 OpenAI 兼容接口。",
    defaultBaseUrl: "https://api.hunyuan.cloud.tencent.com",
    defaultChatPath: "/v1/chat/completions",
    defaultModel: "hunyuan-turbos-latest",
    defaultTimeout: 300,
    apiKeyEnv: ["TENCENT_HUNYUAN_API_KEY", "HUNYUAN_API_KEY", "TENCENT_TOKENHUB_API_KEY"],
    modelEnv: ["TENCENT_HUNYUAN_MODEL", "HUNYUAN_MODEL", "TENCENT_TOKENHUB_MODEL"],
    baseUrlEnv: ["TENCENT_HUNYUAN_BASE_URL", "HUNYUAN_BASE_URL", "TENCENT_TOKENHUB_BASE_URL"],
    urlEnv: ["TENCENT_HUNYUAN_CHAT_URL", "HUNYUAN_CHAT_URL", "TENCENT_TOKENHUB_CHAT_URL"],
    extraDefaults: { enableEnhancement: false },
    extraEnv: { enableEnhancement: ["TENCENT_HUNYUAN_ENABLE_ENHANCEMENT"] },
    extraFields: [
      { key: "enableEnhancement", label: "启用增强联网", inputType: "checkbox" },
    ],
  },
]

const DEFINITION_BY_KEY = new Map(DEFINITIONS.map(def => [def.key, def]))

function firstEnv(names: string[] | undefined): string {
  for (const name of names || []) {
    const value = process.env[name]
    if (value && value.trim()) return value.trim()
  }
  return ""
}

function envBoolean(names: string[] | undefined, fallback = false): boolean {
  const raw = firstEnv(names)
  if (!raw) return fallback
  return raw === "true" || raw === "1" || raw.toLowerCase() === "yes"
}

function cleanUrl(value: string): string {
  return value.trim().replace(/\/+$/, "")
}

function cleanPath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return "/v1/chat/completions"
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
}

function maskKey(key: string): string {
  if (!key) return ""
  const tail = key.slice(-4)
  return `••••${tail}`
}

function splitFullChatUrl(url: string): { baseUrl: string; chatPath: string } | null {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname || "/v1/chat/completions"
    const marker = path.match(/^(.*?)(\/(?:v\d+|compatible-mode\/v\d+)\/chat\/completions)$/)
    if (marker) {
      return {
        baseUrl: `${parsed.origin}${marker[1]}`.replace(/\/+$/, ""),
        chatPath: marker[2],
      }
    }
    return {
      baseUrl: parsed.origin,
      chatPath: path,
    }
  } catch {
    return null
  }
}

async function readStoredSettings(): Promise<Partial<Record<AiProviderKey, StoredAiProviderSetting>>> {
  const data = await kv.get<Partial<Record<AiProviderKey, StoredAiProviderSetting>>>(SETTINGS_KEY)
  return data || {}
}

function mergeRuntime(
  def: AiProviderDefinition,
  stored?: StoredAiProviderSetting
): AiProviderRuntimeSetting {
  const extra: Record<string, string | boolean> = {
    ...(def.extraDefaults || {}),
  }

  for (const [key, names] of Object.entries(def.extraEnv || {})) {
    const defaultValue = def.extraDefaults?.[key]
    extra[key] =
      typeof defaultValue === "boolean"
        ? envBoolean(names, defaultValue)
        : firstEnv(names)
  }

  Object.assign(extra, stored?.extra || {})

  const fullUrl = stored?.baseUrl ? "" : firstEnv(def.urlEnv)
  const splitUrl = fullUrl ? splitFullChatUrl(fullUrl) : null
  const envBaseUrl = firstEnv(def.baseUrlEnv) || splitUrl?.baseUrl || ""
  const envChatPath = firstEnv(def.chatPathEnv) || splitUrl?.chatPath || ""

  const timeoutRaw =
    typeof stored?.timeout === "number"
      ? stored.timeout
      : Number(firstEnv(def.timeoutEnv)) || def.defaultTimeout

  return {
    key: def.key,
    label: def.label,
    baseUrl: cleanUrl(stored?.baseUrl || envBaseUrl || def.defaultBaseUrl),
    chatPath: cleanPath(stored?.chatPath || envChatPath || def.defaultChatPath),
    apiKey: stored?.apiKey || firstEnv(def.apiKeyEnv),
    model: (stored?.model || firstEnv(def.modelEnv) || def.defaultModel).trim(),
    timeout: Math.min(1800, Math.max(30, Math.round(timeoutRaw))),
    extra,
  }
}

export function buildAiChatUrl(config: Pick<AiProviderRuntimeSetting, "baseUrl" | "chatPath">): string {
  return `${cleanUrl(config.baseUrl)}${cleanPath(config.chatPath)}`
}

export async function getAiProviderRuntimeSetting(
  key: AiProviderKey
): Promise<AiProviderRuntimeSetting> {
  const def = DEFINITION_BY_KEY.get(key)
  if (!def) throw new Error(`未知模型配置：${key}`)
  const stored = await readStoredSettings()
  return mergeRuntime(def, stored[key])
}

export async function listAiProviderPublicSettings(): Promise<AiProviderPublicSetting[]> {
  const stored = await readStoredSettings()
  return DEFINITIONS.map(def => {
    const runtime = mergeRuntime(def, stored[def.key])
    return {
      key: def.key,
      label: def.label,
      description: def.description,
      baseUrl: runtime.baseUrl,
      chatPath: runtime.chatPath,
      model: runtime.model,
      timeout: runtime.timeout,
      hasApiKey: Boolean(runtime.apiKey),
      apiKeyPreview: maskKey(runtime.apiKey),
      extra: runtime.extra,
      extraFields: def.extraFields || [],
      updatedAt: stored[def.key]?.updatedAt,
    }
  })
}

export async function saveAiProviderSetting(
  key: AiProviderKey,
  input: {
    apiKey?: string
    clearApiKey?: boolean
    baseUrl: string
    chatPath: string
    model: string
    timeout: number
    extra?: Record<string, string | boolean>
  },
  adminUserId: string
): Promise<void> {
  const def = DEFINITION_BY_KEY.get(key)
  if (!def) throw new Error("未知模型配置")

  const all = await readStoredSettings()
  const prev = all[key] || {}
  const apiKey = input.clearApiKey ? undefined : (input.apiKey?.trim() || prev.apiKey)
  const extra: Record<string, string | boolean> = { ...(input.extra || {}) }
  for (const field of def.extraFields || []) {
    if (field.inputType === "checkbox" && extra[field.key] !== true) {
      extra[field.key] = false
    }
  }

  const next: StoredAiProviderSetting = {
    baseUrl: cleanUrl(input.baseUrl || def.defaultBaseUrl),
    chatPath: cleanPath(input.chatPath || def.defaultChatPath),
    model: input.model.trim() || def.defaultModel,
    timeout: Math.min(1800, Math.max(30, Math.round(input.timeout || def.defaultTimeout))),
    extra,
    updatedAt: new Date().toISOString(),
    updatedBy: adminUserId,
  }

  if (apiKey) next.apiKey = apiKey

  await kv.set(SETTINGS_KEY, {
    ...all,
    [key]: next,
  })
}
