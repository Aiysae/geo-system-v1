import "server-only"

import { buildAiChatUrl } from "@/lib/ai-settings"
import { listAiGatewayProvidersPublic } from "@/lib/ai-gateways"
import { resolveArticleModel, type ResolvedArticleModel } from "@/lib/article-models"
import { openaiCompatChat } from "@/lib/llm/openai-compat"
import type { LlmTokenUsage } from "@/lib/llm/openai-compat"
import { nativeModelChat } from "@/lib/llm/native-chat"
import { recordAiUsageQuietly } from "@/lib/ai-usage"
import type { LlmMode } from "@/types"
import {
  recordAiCredentialFailure,
  recordAiCredentialSuccess,
  tryAcquireAiCredential,
} from "@/lib/ai-credential-router"
import type { AiCredentialVendor } from "@/types/ai-credentials"

interface Waiter {
  resolve: () => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface ProviderPool {
  active: number
  waiters: Waiter[]
}

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
  usageContext?: {
    userId: string
    task: string
  }
}

export interface ArticleModelChatResult {
  content: string
  model: ResolvedArticleModel
  usedFallback: boolean
}

const pools = new Map<string, ProviderPool>()
const circuits = new Map<string, CircuitState>()
const CIRCUIT_FAILURE_THRESHOLD = 3
const CIRCUIT_COOLDOWN_MS = 60_000

function retryableFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "")
  return /(408|425|429|500|502|503|504|timeout|timed out|超时|连接失败|fetch failed|network|socket|temporar|返回空内容|恢复中)/i.test(message)
}

function credentialFailoverFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "")
  return retryableFailure(error)
    || /(401|403|invalid.*key|unauthorized|forbidden|余额不足|欠费|无权限)/i.test(message)
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

async function acquireProviderSlot(model: ResolvedArticleModel): Promise<() => void> {
  if (!model.providerId || !model.maxConcurrency) return () => undefined
  const key = model.providerId
  const limit = Math.max(1, model.maxConcurrency)
  const pool = pools.get(key) || { active: 0, waiters: [] }
  pools.set(key, pool)

  if (pool.active < limit) {
    pool.active += 1
  } else {
    await new Promise<void>((resolve, reject) => {
      const timeoutMs = Math.max(30, model.timeout) * 1000
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = pool.waiters.indexOf(waiter)
          if (index >= 0) pool.waiters.splice(index, 1)
          reject(new Error(`${model.label} 当前任务较多，排队等待超时，请稍后重试`))
        }, timeoutMs),
      }
      pool.waiters.push(waiter)
    })
  }

  let released = false
  return () => {
    if (released) return
    released = true
    pool.active = Math.max(0, pool.active - 1)
    const next = pool.waiters.shift()
    if (next) {
      clearTimeout(next.timer)
      pool.active += 1
      next.resolve()
    }
    if (pool.active === 0 && pool.waiters.length === 0) pools.delete(key)
  }
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
    release()
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const lease = await tryAcquireAiCredential({
      vendor,
      module: "article",
      model: model.model,
      requiredCapabilities: ["chat"],
      excludeCredentialIds: excludedCredentialIds,
      waitTimeoutMs: Math.min(60_000, Math.max(5_000, model.timeout * 1000)),
      leaseSeconds: Math.min(60 * 60, Math.max(60, model.timeout + 60)),
    })
    if (!lease) {
      if (attempt === 0) {
        return executeModel(model, input, usedFallback)
      }
      break
    }

    excludedCredentialIds.push(lease.credential.id)
    const pooledModel: ResolvedArticleModel = {
      ...model,
      providerId: lease.credential.id,
      label: `${model.label}·${lease.credential.accountLabel}`,
      baseUrl: lease.credential.baseUrl,
      chatPath: lease.credential.chatPath,
      apiKey: lease.credential.apiKey,
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
  const candidates = [primary, ...(await fallbackModels(primary))]
  let lastError: unknown

  for (let index = 0; index < candidates.length; index += 1) {
    const model = candidates[index]
    try {
      return {
        content: await callModel(model, input, index > 0),
        model,
        usedFallback: index > 0,
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
