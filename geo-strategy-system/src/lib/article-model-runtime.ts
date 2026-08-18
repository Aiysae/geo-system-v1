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
  requestTimeoutMs?: number
  totalTimeoutMs?: number
  signal?: AbortSignal
  usageContext?: {
    userId: string
    task: string
  }
}

interface RuntimeArticleModelChatInput extends ArticleModelChatInput {
  signal: AbortSignal
  deadlineAt?: number
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

function articleAbortError(): Error {
  const error = new Error("AI 请求已停止")
  error.name = "AbortError"
  return error
}

function isAbortFailure(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

function throwIfArticleStageStopped(input: RuntimeArticleModelChatInput): void {
  if (input.signal.aborted) throw articleAbortError()
}

function remainingStageMs(input: RuntimeArticleModelChatInput): number {
  if (!input.deadlineAt) return Number.POSITIVE_INFINITY
  return Math.max(0, input.deadlineAt - Date.now())
}

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
  input: RuntimeArticleModelChatInput,
): Promise<() => Promise<void>> {
  throwIfArticleStageStopped(input)
  if (!model.providerId || !model.maxConcurrency) return async () => undefined
  return acquireDistributedConcurrency({
    scope: `article-gateway:${model.providerId}`,
    limit: model.maxConcurrency,
    waitTimeoutMs: Math.min(
      Math.max(30, model.timeout) * 1000,
      remainingStageMs(input),
    ),
    leaseSeconds: Math.max(90, model.timeout + 120),
    label: model.label,
    signal: input.signal,
  })
}

async function executeModel(
  model: ResolvedArticleModel,
  input: RuntimeArticleModelChatInput,
  usedFallback: boolean,
): Promise<string> {
  throwIfArticleStageStopped(input)
  if (circuitIsOpen(model)) {
    throw new Error(`${model.label} 线路正在短暂恢复中`)
  }
  const release = await acquireProviderSlot(model, input)
  const startedAt = Date.now()
  let usage: LlmTokenUsage | undefined
  try {
    throwIfArticleStageStopped(input)
    const requestTimeoutMs = Math.min(
      model.timeout * 1000,
      input.requestTimeoutMs && input.requestTimeoutMs > 0
        ? input.requestTimeoutMs
        : Number.POSITIVE_INFINITY,
      remainingStageMs(input),
    )
    const requestTimeoutSec = Math.max(1, Math.ceil(requestTimeoutMs / 1000))
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
          timeoutSec: requestTimeoutSec,
          signal: input.signal,
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
          timeoutSec: requestTimeoutSec,
          signal: input.signal,
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
    const stopped = input.signal.aborted || isAbortFailure(error)
    if (!stopped) recordFailure(model, error)
    if (input.usageContext && !stopped) {
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
  input: RuntimeArticleModelChatInput,
  usedFallback: boolean,
): Promise<string> {
  throwIfArticleStageStopped(input)
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
    throwIfArticleStageStopped(input)
    const lease = await tryAcquireAiCredential({
      vendor,
      module: "article",
      model: selectionModel,
      requiredCapabilities: ["chat"],
      excludeCredentialIds: excludedCredentialIds,
      waitTimeoutMs: Math.min(
        60_000,
        Math.max(5_000, model.timeout * 1000),
        remainingStageMs(input),
      ),
      leaseSeconds: Math.min(60 * 60, Math.max(60, model.timeout + 60)),
      signal: input.signal,
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
        lease.credential,
        Date.now() - startedAt,
        {
          module: "article",
          model: credentialModel,
          requiredCapabilities: ["chat"],
        },
      )
      return content
    } catch (error) {
      lastError = error
      if (input.signal.aborted || isAbortFailure(error)) throw error
      await recordAiCredentialFailure(lease.credential, error, {
        module: "article",
        model: credentialModel,
        requiredCapabilities: ["chat"],
      })
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

async function fallbackModels(
  primary: ResolvedArticleModel,
  input: RuntimeArticleModelChatInput,
): Promise<ResolvedArticleModel[]> {
  throwIfArticleStageStopped(input)
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
    throwIfArticleStageStopped(input)
    try {
      resolved.push(await resolveArticleModel(gateway.providerKey, primary.model))
    } catch (error) {
      console.warn(`[article-model-fallback] ${gateway.name} 无法加入备用线路：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return resolved
}

async function runArticleModelChatWithinBudget(
  primary: ResolvedArticleModel,
  input: RuntimeArticleModelChatInput,
): Promise<ArticleModelChatResult> {
  throwIfArticleStageStopped(input)
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
    throwIfArticleStageStopped(input)
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

  const candidates = [primary, ...(await fallbackModels(primary, input))]
  let lastError: unknown

  for (let index = 0; index < candidates.length; index += 1) {
    throwIfArticleStageStopped(input)
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
      if (input.signal.aborted || isAbortFailure(error)) throw error
      if (!retryableFailure(error) || index === candidates.length - 1) throw error
      console.warn(
        `[article-model-fallback] ${model.label}/${model.model} 暂时不可用，尝试同模型备用线路。`,
      )
    }
  }

  throw lastError instanceof Error ? lastError : new Error("文章模型调用失败")
}

export async function runArticleModelChat(
  primary: ResolvedArticleModel,
  input: ArticleModelChatInput,
): Promise<ArticleModelChatResult> {
  const controller = new AbortController()
  const totalTimeoutMs = input.totalTimeoutMs && input.totalTimeoutMs > 0
    ? Math.min(15 * 60_000, Math.max(1, Math.floor(input.totalTimeoutMs)))
    : undefined
  const deadlineAt = totalTimeoutMs ? Date.now() + totalTimeoutMs : undefined
  let timedOut = false
  const abortFromParent = () => controller.abort()
  if (input.signal?.aborted) controller.abort()
  else input.signal?.addEventListener("abort", abortFromParent, { once: true })
  const timeout = totalTimeoutMs
    ? setTimeout(() => {
        timedOut = true
        controller.abort()
      }, totalTimeoutMs)
    : undefined

  try {
    const result = await runArticleModelChatWithinBudget(primary, {
      ...input,
      signal: controller.signal,
      deadlineAt,
    })
    if (timedOut) throw articleAbortError()
    return result
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error(
        `${input.label}处理超时（超过 ${Math.ceil((totalTimeoutMs || 0) / 1000)} 秒），已停止当前阶段的排队与线路重试`,
      )
      timeoutError.name = "ArticleStageTimeoutError"
      throw timeoutError
    }
    if (input.signal?.aborted) throw articleAbortError()
    throw error
  } finally {
    if (timeout) clearTimeout(timeout)
    input.signal?.removeEventListener("abort", abortFromParent)
  }
}
