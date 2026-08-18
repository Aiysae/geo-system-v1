import "server-only"

import { getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { shouldFailOverAiCredential } from "@/lib/ai-credential-errors"
import { classifyAiCredentialFailure } from "@/lib/ai-credential-failure-classifier"
import { estimateAiCredentialQuota } from "@/lib/ai-credential-quota"
import {
  getAiCredentialPoolCapacity,
  getAiCredentialPoolSnapshot,
  hasAiCredentialCandidate,
  recordAiCredentialFailure,
  recordAiCredentialSuccess,
  resolveAiCredentialModel,
  tryAcquireAiCredential,
} from "@/lib/ai-credential-router"
import { ADAPTERS } from "@/lib/llm"
import { BaiduWebSearchError } from "@/lib/llm/baidu-ai-search"
import { assertStrictPenetrationBlindArgs } from "@/lib/llm/blind-request-audit"
import type { ChatArgs } from "@/lib/llm/openai-compat"
import type { ModelKey } from "@/types"
import type {
  AiCredentialCapability,
  AiCredentialLease,
  AiCredentialModule,
  AiCredentialSelectionRequest,
} from "@/types/ai-credentials"

interface AdapterCredentialRoute {
  vendor: ModelKey
  targetModel: string
  selectionModel?: string
  requiredCapabilities: AiCredentialCapability[]
  extra?: Record<string, string | boolean>
  exactModelRequired?: boolean
  verifiedWebModelRequired?: boolean
}

function isStrictWebCall(module: AiCredentialModule, args: Partial<ChatArgs>): boolean {
  return module === "penetration"
    && args.forceWebSearch === true
    && args.officialWebOnly === true
    && args.requireWebEvidence === true
    && args.mode === "consumer"
}

function requiresNativeWebCredential(
  model: ModelKey,
  args: Partial<ChatArgs>,
): boolean {
  return model === "doubao"
    && args.forceWebSearch === true
    && args.requireWebEvidence === true
    && args.officialWebOnly === true
}

function usesAuditableExternalSearch(
  model: ModelKey,
  module: AiCredentialModule,
  args: Partial<ChatArgs>,
): boolean {
  return (model === "kimi" || model === "deepseek")
    && isStrictWebCall(module, args)
}

function strictCredentialVendor(model: ModelKey): ModelKey {
  return model
}

async function resolveAdapterCredentialRoute(
  model: ModelKey,
  module: AiCredentialModule,
  args: Partial<ChatArgs>,
): Promise<AdapterCredentialRoute> {
  const strictWeb = isStrictWebCall(module, args)
  const nativeWeb = strictWeb || requiresNativeWebCredential(model, args)
  const strictNativeWeb = strictWeb && model !== "kimi" && model !== "deepseek"
  const vendor = strictWeb ? strictCredentialVendor(model) : model
  const config = await getAiProviderRuntimeSetting(vendor)
  let targetModel = config.model
  let selectionModel: string | undefined = targetModel

  if (strictWeb && model === "deepseek") {
    targetModel = "deepseek-chat"
    selectionModel = targetModel
  }
  if (strictNativeWeb) selectionModel = undefined

  return {
    vendor,
    targetModel,
    selectionModel,
    requiredCapabilities: nativeWeb
      ? model === "kimi" || model === "deepseek"
        ? ["chat"]
        : ["native_web", "auditable_sources"]
      : args.jsonMode
        ? ["json"]
        : ["chat"],
    extra: strictWeb && (vendor === "qwen" || vendor === "ernie")
      ? { enableSearch: true }
      : vendor === "doubao"
        ? { botId: "" }
        : undefined,
    exactModelRequired: strictWeb,
    verifiedWebModelRequired: strictNativeWeb,
  }
}

function resolveRouteCredentialModel(
  route: AdapterCredentialRoute,
  credential: AiCredentialLease["credential"],
  selectedModel: string | undefined,
): string {
  if (route.verifiedWebModelRequired) {
    const allowed = new Set(credential.allowedModels)
    const verified = credential.verifiedWebModels.filter(model =>
      allowed.size === 0 || allowed.has(model),
    )
    if (verified.includes(route.targetModel)) return route.targetModel
    return verified[0] || ""
  }
  return resolveAiCredentialModel(
    credential,
    selectedModel || route.targetModel,
    route.requiredCapabilities,
  )
}

function selectionRequest(
  route: AdapterCredentialRoute,
  module: AiCredentialModule,
  excludeCredentialIds?: string[],
  model: string | null | undefined = route.selectionModel,
): AiCredentialSelectionRequest {
  return {
    vendor: route.vendor,
    module,
    model: model === null ? undefined : model,
    requiredCapabilities: route.requiredCapabilities,
    excludeCredentialIds,
  }
}

function externalSearchSelectionRequest(
  module: AiCredentialModule,
  excludeCredentialIds?: string[],
): AiCredentialSelectionRequest {
  return {
    vendor: "ernie",
    module,
    requiredCapabilities: ["native_web", "auditable_sources"],
    excludeCredentialIds,
  }
}

async function hasRouteCandidate(
  route: AdapterCredentialRoute,
  module: AiCredentialModule,
): Promise<boolean> {
  if (await hasAiCredentialCandidate(selectionRequest(route, module))) return true
  if (route.exactModelRequired) return false
  return route.selectionModel
    ? hasAiCredentialCandidate(selectionRequest(route, module, undefined, null))
    : false
}

async function routePoolCapacity(
  route: AdapterCredentialRoute,
  module: AiCredentialModule,
) {
  let capacity = await getAiCredentialPoolCapacity(selectionRequest(route, module))
  if (route.exactModelRequired) return capacity
  if (capacity.candidateCount === 0 && route.selectionModel) {
    capacity = await getAiCredentialPoolCapacity(
      selectionRequest(route, module, undefined, null),
    )
  }
  return capacity
}

async function routePoolSnapshot(
  route: AdapterCredentialRoute,
  module: AiCredentialModule,
) {
  let snapshot = await getAiCredentialPoolSnapshot(selectionRequest(route, module))
  if (route.exactModelRequired) return snapshot
  if (snapshot.candidateCount === 0 && route.selectionModel) {
    snapshot = await getAiCredentialPoolSnapshot(
      selectionRequest(route, module, undefined, null),
    )
  }
  return snapshot
}

export async function hasAdapterCredentialPoolCandidate(
  model: ModelKey,
  module: AiCredentialModule,
  args: Partial<ChatArgs> = {},
): Promise<boolean> {
  const route = await resolveAdapterCredentialRoute(model, module, args)
  if (usesAuditableExternalSearch(model, module, args)) {
    const [generationReady, searchReady] = await Promise.all([
      hasAiCredentialCandidate(selectionRequest(route, module, undefined, null)),
      hasAiCredentialCandidate(externalSearchSelectionRequest(module)),
    ])
    return generationReady && searchReady
  }
  return hasRouteCandidate(route, module)
}

export interface AdapterCredentialPoolCapacity {
  vendor: ModelKey
  candidateCount: number
  maxConcurrency: number
  quotaGroupCount: number
  usesFallback: boolean
}

export interface AdapterCredentialPoolSnapshot
  extends AdapterCredentialPoolCapacity {
  activeConcurrency: number
  availableConcurrency: number
}

export async function getAdapterCredentialPoolCapacity(
  model: ModelKey,
  module: AiCredentialModule,
  args: Partial<ChatArgs> = {},
): Promise<AdapterCredentialPoolCapacity> {
  const route = await resolveAdapterCredentialRoute(model, module, args)
  if (usesAuditableExternalSearch(model, module, args)) {
    const [generationPool, searchPool] = await Promise.all([
      getAiCredentialPoolCapacity(selectionRequest(route, module, undefined, null)),
      getAiCredentialPoolCapacity(externalSearchSelectionRequest(module)),
    ])
    return {
      // The auditable search pool is the shared bottleneck with Ernie jobs.
      vendor: "ernie",
      candidateCount: Math.min(generationPool.candidateCount, searchPool.candidateCount),
      maxConcurrency: Math.min(generationPool.maxConcurrency, searchPool.maxConcurrency),
      quotaGroupCount: Math.min(generationPool.quotaGroupCount, searchPool.quotaGroupCount),
      usesFallback: false,
    }
  }

  const capacity = await routePoolCapacity(route, module)
  if (capacity.candidateCount > 0) {
    return {
      vendor: route.vendor,
      ...capacity,
      usesFallback: false,
    }
  }
  const fallbackConfigured = await ADAPTERS[route.vendor].configured()
  if (route.exactModelRequired) {
    return {
      vendor: route.vendor,
      candidateCount: 0,
      maxConcurrency: 0,
      quotaGroupCount: 0,
      usesFallback: false,
    }
  }
  return {
    vendor: route.vendor,
    candidateCount: fallbackConfigured ? 1 : 0,
    maxConcurrency: fallbackConfigured ? 1 : 0,
    quotaGroupCount: fallbackConfigured ? 1 : 0,
    usesFallback: fallbackConfigured,
  }
}

export async function getAdapterCredentialPoolSnapshot(
  model: ModelKey,
  module: AiCredentialModule,
  args: Partial<ChatArgs> = {},
): Promise<AdapterCredentialPoolSnapshot> {
  const route = await resolveAdapterCredentialRoute(model, module, args)
  if (usesAuditableExternalSearch(model, module, args)) {
    const [generationPool, searchPool] = await Promise.all([
      getAiCredentialPoolSnapshot(selectionRequest(route, module, undefined, null)),
      getAiCredentialPoolSnapshot(externalSearchSelectionRequest(module)),
    ])
    const maxConcurrency = Math.min(generationPool.maxConcurrency, searchPool.maxConcurrency)
    const availableConcurrency = Math.min(
      generationPool.availableConcurrency,
      searchPool.availableConcurrency,
    )
    return {
      vendor: "ernie",
      candidateCount: Math.min(generationPool.candidateCount, searchPool.candidateCount),
      maxConcurrency,
      quotaGroupCount: Math.min(generationPool.quotaGroupCount, searchPool.quotaGroupCount),
      activeConcurrency: Math.max(0, maxConcurrency - availableConcurrency),
      availableConcurrency,
      usesFallback: false,
    }
  }

  const snapshot = await routePoolSnapshot(route, module)
  if (snapshot.candidateCount > 0) {
    return {
      vendor: route.vendor,
      ...snapshot,
      usesFallback: false,
    }
  }
  if (route.exactModelRequired) {
    return {
      vendor: route.vendor,
      candidateCount: 0,
      maxConcurrency: 0,
      quotaGroupCount: 0,
      activeConcurrency: 0,
      availableConcurrency: 0,
      usesFallback: false,
    }
  }
  const fallbackConfigured = await ADAPTERS[route.vendor].configured()
  return {
    vendor: route.vendor,
    candidateCount: fallbackConfigured ? 1 : 0,
    maxConcurrency: fallbackConfigured ? 1 : 0,
    quotaGroupCount: fallbackConfigured ? 1 : 0,
    activeConcurrency: 0,
    availableConcurrency: fallbackConfigured ? 1 : 0,
    usesFallback: fallbackConfigured,
  }
}

export async function isAdapterCredentialConfigured(
  model: ModelKey,
  module: AiCredentialModule,
  args: Partial<ChatArgs> = {},
): Promise<boolean> {
  if (await hasAdapterCredentialPoolCandidate(model, module, args)) return true
  const route = await resolveAdapterCredentialRoute(model, module, args)
  if (route.exactModelRequired) return false
  return ADAPTERS[route.vendor].configured()
}

async function runAuditableExternalCredentialPoolChat(
  model: ModelKey,
  module: AiCredentialModule,
  args: ChatArgs,
): Promise<string> {
  const route = await resolveAdapterCredentialRoute(model, module, args)
  const label = ADAPTERS[model].label
  // Prefer the configured model while an exact account is available, then
  // widen failover to each relay account's verified model name.
  let generationModel = route.selectionModel
    && await hasAiCredentialCandidate(selectionRequest(route, module))
    ? route.selectionModel
    : undefined
  const [hasGenerationPool, hasSearchPool] = await Promise.all([
    hasAiCredentialCandidate(selectionRequest(route, module, undefined, null)),
    hasAiCredentialCandidate(externalSearchSelectionRequest(module)),
  ])
  if (!hasGenerationPool || !hasSearchPool) {
    throw new Error(`${label} 严格联网账号池未配置完整或当前模型尚未通过验证`)
  }

  const excludedGenerationIds: string[] = []
  const excludedSearchIds: string[] = []
  const quotaEstimate = estimateAiCredentialQuota(args)
  const maxCredentialAttempts = Math.max(
    3,
    Math.min(8, Math.floor(Number(process.env.AI_CREDENTIAL_FAILOVER_ATTEMPTS) || 6)),
  )
  const waitTimeoutMs = Math.max(
    1_000,
    Math.min(30_000, Number(process.env.PENETRATION_CREDENTIAL_WAIT_MS) || 8_000),
  )
  const leaseSeconds = Math.min(
    60 * 60,
    Math.max(60, (args.timeoutSec ?? 60) + 60),
  )
  const pairWaitTimeoutMs = Math.max(
    250,
    Math.min(
      waitTimeoutMs,
      Number(process.env.PENETRATION_DUAL_POOL_PAIR_WAIT_MS) || 1_500,
    ),
  )
  let lastError: unknown

  for (let attempt = 0; attempt < maxCredentialAttempts; attempt += 1) {
    let searchLease: AiCredentialLease | null = null
    let generationLease: AiCredentialLease | null = null
    try {
      // Search is the shared bottleneck for Kimi and DeepSeek strict audits.
      // Acquire it first, then pair a generation lane with a short wait. This
      // avoids occupying a scarce generation account while waiting on search.
      searchLease = await tryAcquireAiCredential({
        ...externalSearchSelectionRequest(module, excludedSearchIds),
        waitTimeoutMs,
        leaseSeconds,
      })
      if (!searchLease) {
        if (!lastError || excludedSearchIds.length === 0) {
          lastError = new Error(`${label} 联网搜索账号池当前繁忙或暂无可用账号`)
        }
        break
      }

      generationLease = await tryAcquireAiCredential({
        ...selectionRequest(
          route,
          module,
          excludedGenerationIds,
          generationModel ?? null,
        ),
        waitTimeoutMs: pairWaitTimeoutMs,
        leaseSeconds,
        ...quotaEstimate,
      })
      if (!generationLease) {
        if (!lastError || excludedGenerationIds.length === 0) {
          lastError = new Error(`${label} 生成账号池当前繁忙或暂无可用账号`)
        }
        break
      }

      const selectedModel = resolveAiCredentialModel(
        generationLease.credential,
        generationModel || route.targetModel,
        route.requiredCapabilities,
      )
      if (!selectedModel) throw new Error(`${label} 可用账号未配置模型`)
      const searchModel = searchLease.credential.allowedModels[0] || "ernie-5.1"
      const startedAt = Date.now()
      try {
        const result = await ADAPTERS[model].chat({
          ...args,
          runtimeOverride: {
            vendor: model,
            baseUrl: generationLease.credential.baseUrl,
            chatPath: generationLease.credential.chatPath,
            apiKey: generationLease.credential.apiKey,
            model: selectedModel,
            timeout: args.timeoutSec,
          },
          searchRuntimeOverride: {
            vendor: "ernie",
            baseUrl: searchLease.credential.baseUrl,
            chatPath: searchLease.credential.chatPath,
            apiKey: searchLease.credential.apiKey,
            model: searchModel,
            timeout: args.timeoutSec,
            extra: { enableSearch: true },
          },
        })
        const latencyMs = Date.now() - startedAt
        await Promise.all([
          recordAiCredentialSuccess(generationLease.credential, latencyMs, {
            module,
            model: selectedModel,
            requiredCapabilities: route.requiredCapabilities,
          }),
          recordAiCredentialSuccess(searchLease.credential, latencyMs, {
            module,
            model: searchModel,
            requiredCapabilities: ["native_web", "auditable_sources"],
          }),
        ])
        return result
      } catch (error) {
        lastError = error
        if (error instanceof BaiduWebSearchError) {
          excludedSearchIds.push(searchLease.credential.id)
          await recordAiCredentialFailure(searchLease.credential, error, {
            module,
            model: searchModel,
            requiredCapabilities: ["native_web", "auditable_sources"],
          })
        } else {
          excludedGenerationIds.push(generationLease.credential.id)
          await recordAiCredentialFailure(generationLease.credential, error, {
            module,
            model: selectedModel,
            requiredCapabilities: route.requiredCapabilities,
          })
          if (
            generationModel
            && classifyAiCredentialFailure(error).scope !== "ignored"
            && !(await hasAiCredentialCandidate(selectionRequest(
              route,
              module,
              excludedGenerationIds,
              generationModel,
            )))
          ) {
            generationModel = undefined
          }
        }
        if (!shouldFailOverAiCredential(error)) throw error
        console.warn(
          `[ai-credential-adapter] ${model}/penetration 当前账号不可用，尝试下一账号。`,
        )
      }
    } finally {
      await Promise.all([
        generationLease?.release(),
        searchLease?.release(),
      ])
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${label} 严格联网暂无可用账号`)
}

export async function runAdapterCredentialPoolChat(
  model: ModelKey,
  module: AiCredentialModule,
  args: ChatArgs,
): Promise<string> {
  if (module === "penetration") assertStrictPenetrationBlindArgs(args)
  if (usesAuditableExternalSearch(model, module, args)) {
    return runAuditableExternalCredentialPoolChat(model, module, args)
  }
  const route = await resolveAdapterCredentialRoute(model, module, args)
  const hasPoolCandidate = await hasRouteCandidate(route, module)
  if (!hasPoolCandidate && !route.exactModelRequired) {
    return ADAPTERS[model].chat(args)
  }
  const excludedCredentialIds: string[] = []
  const exactRequest = selectionRequest(route, module)
  const selectionModel = route.selectionModel
    && await hasAiCredentialCandidate(exactRequest)
    ? route.selectionModel
    : undefined
  if (
    route.exactModelRequired
    && !route.verifiedWebModelRequired
    && !selectionModel
  ) {
    throw new Error(`${ADAPTERS[model].label} 当前模型尚未通过严格联网验证`)
  }
  let lastError: unknown
  const quotaEstimate = estimateAiCredentialQuota(args)
  const maxCredentialAttempts = Math.max(
    3,
    Math.min(8, Math.floor(Number(process.env.AI_CREDENTIAL_FAILOVER_ATTEMPTS) || 6)),
  )
  const waitTimeoutMs = module === "penetration"
    ? Math.max(1_000, Math.min(30_000, Number(process.env.PENETRATION_CREDENTIAL_WAIT_MS) || 8_000))
    : Math.min(60_000, Math.max(5_000, (args.timeoutSec ?? 60) * 1000))

  for (let attempt = 0; attempt < maxCredentialAttempts; attempt += 1) {
    const lease = await tryAcquireAiCredential({
      ...selectionRequest(route, module, excludedCredentialIds, selectionModel ?? null),
      waitTimeoutMs,
      leaseSeconds: Math.min(60 * 60, Math.max(60, (args.timeoutSec ?? 60) + 60)),
      ...quotaEstimate,
    })
    if (!lease) {
      if (route.exactModelRequired) {
        throw new Error(`${ADAPTERS[model].label} 当前独立账号并发已满，请等待空闲通道`)
      }
      if (attempt === 0) return ADAPTERS[model].chat(args)
      break
    }

    excludedCredentialIds.push(lease.credential.id)
    const startedAt = Date.now()
    try {
      const credentialModel = resolveRouteCredentialModel(
        route,
        lease.credential,
        selectionModel,
      )
      if (!credentialModel) throw new Error(`${ADAPTERS[model].label} 可用账号未配置模型`)
      const result = await ADAPTERS[model].chat({
        ...args,
        runtimeOverride: {
          vendor: route.vendor,
          baseUrl: lease.credential.baseUrl,
          chatPath: lease.credential.chatPath,
          apiKey: lease.credential.apiKey,
          model: credentialModel,
          timeout: args.timeoutSec,
          extra: route.extra,
        },
      })
      await recordAiCredentialSuccess(lease.credential, Date.now() - startedAt, {
        module,
        model: credentialModel,
        requiredCapabilities: route.requiredCapabilities,
      })
      return result
    } catch (error) {
      lastError = error
      await recordAiCredentialFailure(lease.credential, error, {
        module,
        model: resolveRouteCredentialModel(route, lease.credential, selectionModel),
        requiredCapabilities: route.requiredCapabilities,
      })
      if (!shouldFailOverAiCredential(error)) throw error
      console.warn(
        `[ai-credential-adapter] ${model}/${module} 当前账号不可用，尝试下一账号。`,
      )
    } finally {
      await lease.release()
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${ADAPTERS[model].label} 暂无可用账号`)
}
