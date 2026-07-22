import "server-only"

import { getAiProviderRuntimeSetting, listAiProviderPublicSettings } from "@/lib/ai-settings"
import {
  getAiGatewayProviderRuntime,
  listAiGatewayProvidersPublic,
  parseGatewayProviderKey,
} from "@/lib/ai-gateways"
import type { ArticleModelProviderKey } from "@/types"
import type { AiProviderKey, AiProviderPublicSetting } from "@/types/ai-settings"
import type {
  AiGatewayAuthType,
  AiGatewayArticleOption,
} from "@/types/ai-gateway"

export const LEGACY_ARTICLE_MODEL_PROVIDERS: AiProviderKey[] = [
  "article",
  "deepseek",
  "qwen",
  "doubao",
  "kimi",
  "ernie",
  "hunyuan",
]

const LEGACY_PROVIDER_SET = new Set<string>(LEGACY_ARTICLE_MODEL_PROVIDERS)

export interface ResolvedArticleModel {
  providerKey: ArticleModelProviderKey
  providerId?: string
  label: string
  baseUrl: string
  chatPath: string
  apiKey: string
  model: string
  timeout: number
  authType: AiGatewayAuthType
  maxConcurrency?: number
}

export interface ArticleModelCatalog {
  providers: AiProviderPublicSetting[]
  gateways: AiGatewayArticleOption[]
}

export function normalizeArticleModelProviderKey(value: unknown): ArticleModelProviderKey {
  const key = String(value || "")
  if (LEGACY_PROVIDER_SET.has(key)) return key as ArticleModelProviderKey
  if (parseGatewayProviderKey(key)) return key as ArticleModelProviderKey
  return "article"
}

export function isRecognizedArticleModelProviderKey(value: unknown): boolean {
  const key = String(value || "")
  return LEGACY_PROVIDER_SET.has(key) || Boolean(parseGatewayProviderKey(key))
}

export async function listArticleModelCatalog(): Promise<ArticleModelCatalog> {
  const [settings, gateways] = await Promise.all([
    listAiProviderPublicSettings(),
    listAiGatewayProvidersPublic(),
  ])
  return {
    providers: LEGACY_ARTICLE_MODEL_PROVIDERS
      .map(key => settings.find(item => item.key === key))
      .filter((item): item is AiProviderPublicSetting => Boolean(item)),
    gateways: gateways
      .filter(gateway =>
        gateway.enabled
        && gateway.hasApiKey
        && gateway.models.some(model => model.enabled),
      )
      .map(gateway => ({
        id: gateway.id,
        providerKey: gateway.providerKey,
        name: gateway.name,
        models: gateway.models.filter(model => model.enabled),
      })),
  }
}

export async function resolveArticleModel(
  providerValue: unknown,
  requestedModel?: unknown,
): Promise<ResolvedArticleModel> {
  const providerKey = normalizeArticleModelProviderKey(providerValue)
  const gatewayId = parseGatewayProviderKey(providerKey)
  const requested = String(requestedModel || "").trim().slice(0, 200)

  if (!gatewayId) {
    const config = await getAiProviderRuntimeSetting(providerKey as AiProviderKey)
    return {
      providerKey,
      label: config.label,
      baseUrl: config.baseUrl,
      chatPath: config.chatPath,
      apiKey: config.apiKey,
      model: requested || config.model,
      timeout: config.timeout,
      authType: "bearer",
    }
  }

  const gateway = await getAiGatewayProviderRuntime(gatewayId)
  if (!gateway.enabled) throw new Error(`${gateway.name} 当前已停用，请选择其他模型`)
  const enabledModels = gateway.models.filter(model => model.enabled)
  const model = requested || enabledModels[0]?.id || ""
  if (gateway.models.length > 0 && model && !enabledModels.some(item => item.id === model)) {
    throw new Error(`${gateway.name} 中的模型 ${model} 未开放，请重新选择`)
  }

  return {
    providerKey,
    providerId: gateway.id,
    label: gateway.name,
    baseUrl: gateway.baseUrl,
    chatPath: gateway.chatPath,
    apiKey: gateway.apiKey,
    model,
    timeout: gateway.timeout,
    authType: gateway.authType,
    maxConcurrency: gateway.maxConcurrency,
  }
}
