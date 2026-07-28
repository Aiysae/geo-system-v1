import "server-only"

import { buildAiChatUrl } from "@/lib/ai-settings"
import { shouldFailOverAiCredential } from "@/lib/ai-credential-errors"
import { estimateAiCredentialQuota } from "@/lib/ai-credential-quota"
import { listAiGatewayProvidersPublic } from "@/lib/ai-gateways"
import { acquireDistributedConcurrency } from "@/lib/distributed-concurrency"
import { resolveArticleModel, type ResolvedArticleModel } from "@/lib/article-models"
import { openaiCompatChat } from "@/lib/llm/openai-compat"
import type { LlmTokenUsage } from "@/lib/llm/openai-compat"
import { nativeModelChat } from "@/lib/llm/native-chat"
import { recordAiUsageQuietly } from "@/lib/ai-usage"
import {
  buildArticleWebEnhancedPrompt,
  collectArticleWebContext,
} from "@/lib/article-web-context"
import type {
  ArticleGenerationConnectivity,
  LlmMode,
} from "@/types"
import {
  hasAiCredentialCandidate,
  recordAiCredentialFailure,
  recordAiCredentialSuccess,
  resolveAiCredentialModel,
  tryAcquireAiCredential,
} from "@/lib/ai-credential-router"
import type { AiCredentialVendor } from "@/types/ai-credentials"

interface CircuitState {
  failures: number
  openedUntil: number
}

export interface ArticleModelChatInput {
  system: string
  user: string
  label: string
  temperature?: number
  maxTokens?: number
  jsonMode?: boolean
  mode?: LlmMode
  webPolicy?: "disabled" | "required_with_fallback"
  webSearchQueries?: string[]
  usageContext?: {
    userId: string
    task: string
  }
}

export interface ArticleModelChatResult {
  content: string
  model: ResolvedArticleModel
  usedFallback: boolean
  connectivity?: ArticleGenerationConnectivity
}

const circuits = new Map<string, CircuitState>()
const CIRCUIT_FAILURE_THRESHOLD = 3
const CIRCUIT_COOLDOWN_MS = 60_000

function retryableFailure(error: unknown): boolean {
  return shouldFailOverAiCredential(error)
}

function credentialFailoverFailure(error: unknown): boolean {
  return shouldFailOverAiCredential(error)
}

function credentialVendor(model: ResolvedArticleModel): AiCredentialVendor | null {
  if (model.providerId) return null
  const providerKey = String(model.providerKey)
  return ([
    "doubao",
    "qwen",
    "hunyuan",
    "deepseek",
    "kimi",
    "ernie",
  ] as AiCredentialVendor[]).includes(providerKey as AiCredentialVendor)
    ? providerKey as AiCredentialVendor
    : null
}

function circuitKey(model: ResolvedArticleModel): string {
  return model.providerId || String(model.providerKey)
}

function circuitIsOpen(model: ResolvedArticleModel): boolean {
  const state = circuits.get(circuitKey(model))
  if (!state?.openedUntil) return false
  if (state.openedUntil > Date.now()) return true
  circuits.delete(circuitKey(model))
  return false
}

function recordSuccess(model: ResolvedArticleModel): void {
  circuits.delete(circuitKey(model))
}

function recordFailure(model: ResolvedArticleModel, error: unknown): void {
  if (!retryableFailure(error)) return
  const key = circuitKey(model)
  const current = circuits.get(key) || { failures: 0, openedUntil: 0 }
  const failures = current.failures + 1
  circuits.set(key, {
    failures,
    openedUntil: failures >= CIRCUIT_FAILURE_THRESHOLD
      ? Date.now() + CIRCUIT_COOLDOWN_MS
      : 0,
  })
}

async function acquireProviderSlot(
  model: ResolvedArticleModel,
): Promise<() => Promise<void>> {
  if (!model.providerId || !model.maxConcurrency) return async () => undefined
  return acquireDistributedConcurrency({
    scope: `article-gateway:${model.providerId}`,
    limit: model.maxConcurrency,
    waitTimeoutMs: Math.max(30, model.timeout) * 1000,
    leaseSeconds: Math.max(90, model.timeout + 120),
    label: model.label,
  })
}

async function executeModel(
  model: ResolvedArticleModel,
  input: ArticleModelChatInput,
  usedFallback: boolean,
): Promise<string> {
  if (circuitIsOpen(model)) {
    throw new Error(`${model.label} 线路正在短暂恢复中`)
  }
  const release = await acquireProviderSlot(model)
  const startedAt = Date.now()
  let usage: LlmTokenUsage | undefined
  try {
    const onUsage = (value: LlmTokenUsage) => {
      usage = usage
        ? {
            promptTokens: usage.promptTokens + value.promptTokens,
            completionTokens: usage.completionTokens + value.completionTokens,
            totalTokens: usage.totalTokens + value.totalTokens,
          }
        : value
    }
    const content = model.protocol === "openai_chat"
      ? await openaiCompatChat({
          url: buildAiChatUrl(model),
          apiKey: model.apiKey,
          authType: model.authType === "query-key" ? "bearer" : model.authType,
          model: model.model,
          system: input.system,
          user: input.user,
          temperature: input.temperature,
          maxTokens: input.maxTokens,
          jsonMode: input.jsonMode,
          mode: input.mode,
          timeoutSec: model.timeout,
          label: `${model.label}·${input.label}`,
          onUsage,
        })
      : await nativeModelChat({
          protocol: model.protocol,
          baseUrl: model.baseUrl,
          chatPath: model.chatPath,
          apiKey: model.apiKey,
          model: model.model,
          system: input.system,
          user: input.user,
          temperature: input.temperature,
          maxTokens: input.maxTokens,
          jsonMode: input.jsonMode,
          timeoutSec: model.timeout,
          label: `${model.label}·${input.label}`,
          onUsage,
        })
    recordSuccess(model)
    if (input.usageContext) {
      await recordAiUsageQuietly({
        userId: input.usageContext.userId,
        task: input.usageContext.task,
        providerKey: model.providerKey,
        providerName: model.label,
        modelId: model.model,
        promptTokens: usage?.promptTokens,
        completionTokens: usage?.completionTokens,
        totalTokens: usage?.totalTokens,
        latencyMs: Date.now() - startedAt,
        success: true,
        usedFallback,
      })
    }
    return content
  } catch (error) {
    recordFailure(model, error)
    if (input.usageContext) {
      await recordAiUsageQuietly({
        userId: input.usageContext.userId,
        task: input.usageContext.task,
        providerKey: model.providerKey,
        providerName: model.label,
        modelId: model.model,
        promptTokens: usage?.promptTokens,
        completionTokens: usage?.completionTokens,
        totalTokens: usage?.totalTokens,
        latencyMs: Date.now() - startedAt,
        success: false,
        usedFallback,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    throw error
  } finally {
    await release()
  }
}

async function callModel(
  model: ResolvedArticleModel,
  input: ArticleModelChatInput,
  usedFallback: boolean,
): Promise<string> {
  const vendor = credentialVendor(model)
  if (!vendor) return executeModel(model, input, usedFallback)

  const excludedCredentialIds: string[] = []
  let lastError: unknown
  const quotaEstimate = estimateAiCredentialQuota(input)
  const preferredRequest = {
    vendor,
    module: "article" as const,
    model: model.model,
    requiredCapabilities: ["chat" as const],
  }
  const selectionModel = model.model
    && await hasAiCredentialCandidate(preferredRequest)
    ? model.model
    : undefined
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const lease = await tryAcquireAiCredential({
      vendor,
      module: "article",
      model: selectionModel,
      requiredCapabilities: ["chat"],
      excludeCredentialIds: excludedCredentialIds,
      waitTimeoutMs: Math.min(60_000, Math.max(5_000, model.timeout * 1000)),
      leaseSeconds: Math.min(60 * 60, Math.max(60, model.timeout + 60)),
      ...quotaEstimate,
    })
    if (!lease) {
      if (attempt === 0) {
        return executeModel(model, input, usedFallback)
      }
      break
    }

    excludedCredentialIds.push(lease.credential.id)
    const credentialModel = resolveAiCredentialModel(
      lease.credential,
      selectionModel || model.model,
      ["chat"],
    )
    if (!credentialModel) {
      await lease.release()
      throw new Error(`${model.label} 可用账号未配置模型`)
    }
    const pooledModel: ResolvedArticleModel = {
      ...model,
      providerId: lease.credential.id,
      label: `${model.label}·${lease.credential.accountLabel}`,
      baseUrl: lease.credential.baseUrl,
      chatPath: lease.credential.chatPath,
      apiKey: lease.credential.apiKey,
      model: credentialModel,
      authType: "bearer",
      protocol: "openai_chat",
      maxConcurrency: undefined,
    }
    const startedAt = Date.now()
    try {
      const content = await executeModel(
        pooledModel,
        input,
        usedFallback || attempt > 0,
      )
      await recordAiCredentialSuccess(
        lease.credential.id,
        Date.now() - startedAt,
      )
      return content
    } catch (error) {
      lastError = error
      await recordAiCredentialFailure(lease.credential, error)
      if (!credentialFailoverFailure(error)) throw error
      console.warn(
        `[article-credential-pool] ${model.label}/${model.model} 当前账号不可用，尝试同模型下一账号。`,
      )
    } finally {
      await lease.release()
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${model.label} 暂无可用账号`)
}

async function fallbackModels(primary: ResolvedArticleModel): Promise<ResolvedArticleModel[]> {
  if (!primary.providerId || !primary.model) return []
  const gateways = await listAiGatewayProvidersPublic()
  const candidates = gateways.filter(gateway =>
    gateway.enabled
    && gateway.hasApiKey
    && gateway.id !== primary.providerId
    && gateway.models.some(model => model.enabled && model.status === "available" && model.id === primary.model),
  )
  const resolved: ResolvedArticleModel[] = []
  for (const gateway of candidates) {
    try {
      resolved.push(await resolveArticleModel(gateway.providerKey, primary.model))
    } catch (error) {
      console.warn(`[article-model-fallback] ${gateway.name} 无法加入备用线路：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return resolved
}

export async function runArticleModelChat(
  primary: ResolvedArticleModel,
  input: ArticleModelChatInput,
): Promise<ArticleModelChatResult> {
  let effectiveInput = input
  let connectivity: ArticleGenerationConnectivity | undefined
  if (input.webPolicy === "required_with_fallback") {
    const context = await collectArticleWebContext({
      queries: input.webSearchQueries?.length
        ? input.webSearchQueries
        : [input.user],
      maxAttempts: Math.max(
        1,
        Math.min(4, Math.floor(Number(process.env.ARTICLE_WEB_SEARCH_ATTEMPTS) || 3)),
      ),
      maxResults: Math.max(
        3,
        Math.min(12, Math.floor(Number(process.env.ARTICLE_WEB_SEARCH_RESULTS) || 8)),
      ),
    })
    if (context.sourceCount > 0) {
      effectiveInput = {
        ...input,
        user: buildArticleWebEnhancedPrompt(input.user, context),
      }
      connectivity = {
        requested: true,
        mode: "web",
        webAttempts: context.attempts,
        sourceCount: context.sourceCount,
      }
    } else {
      connectivity = {
        requested: true,
        mode: "standard_fallback",
        webAttempts: context.attempts,
        sourceCount: 0,
        fallbackReason: context.fallbackReason,
      }
    }
  }

  const candidates = [primary, ...(await fallbackModels(primary))]
  let lastError: unknown

  for (let index = 0; index < candidates.length; index += 1) {
    const model = candidates[index]
    try {
      return {
        content: await callModel(model, effectiveInput, index > 0),
        model,
        usedFallback: index > 0,
        connectivity,
      }
    } catch (error) {
      lastError = error
      if (!retryableFailure(error) || index === candidates.length - 1) throw error
      console.warn(
        `[article-model-fallback] ${model.label}/${model.model} 暂时不可用，尝试同模型备用线路。`,
      )
    }
  }

  throw lastError instanceof Error ? lastError : new Error("文章模型调用失败")
}
