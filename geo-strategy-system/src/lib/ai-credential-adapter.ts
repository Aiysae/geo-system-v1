import "server-only"

import { getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { shouldFailOverAiCredential } from "@/lib/ai-credential-errors"
import { estimateAiCredentialQuota } from "@/lib/ai-credential-quota"
import {
  getAiCredentialPoolCapacity,
  hasAiCredentialCandidate,
  recordAiCredentialFailure,
  recordAiCredentialSuccess,
  resolveAiCredentialModel,
  tryAcquireAiCredential,
} from "@/lib/ai-credential-router"
import { ADAPTERS } from "@/lib/llm"
import { BaiduWebSearchError } from "@/lib/llm/baidu-ai-search"
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
  fixedTargetModel?: boolean
}

function isStrictWebCall(module: AiCredentialModule, args: Partial<ChatArgs>): boolean {
  return module === "penetration"
    && args.forceWebSearch === true
    && args.officialWebOnly === true
    && args.requireWebEvidence === true
    && args.mode === "consumer"
}

function isKimiAuditableWebCall(
  model: ModelKey,
  module: AiCredentialModule,
  args: Partial<ChatArgs>,
): boolean {
  return model === "kimi" && isStrictWebCall(module, args)
}

function strictCredentialVendor(model: ModelKey): ModelKey {
  if (model === "deepseek") return "qwen"
  return model
}

async function resolveAdapterCredentialRoute(
  model: ModelKey,
  module: AiCredentialModule,
  args: Partial<ChatArgs>,
): Promise<AdapterCredentialRoute> {
  const strictWeb = isStrictWebCall(module, args)
  const vendor = strictWeb ? strictCredentialVendor(model) : model
  const config = await getAiProviderRuntimeSetting(vendor)
  let targetModel = config.model
  let selectionModel: string | undefined = targetModel
  let fixedTargetModel = false

  if (strictWeb && model === "deepseek") {
    targetModel = process.env.DEEPSEEK_WEB_SEARCH_MODEL?.trim() || "deepseek-v4-flash"
    selectionModel = undefined
    fixedTargetModel = true
  }

  return {
    vendor,
    targetModel,
    selectionModel,
    requiredCapabilities: strictWeb
      ? model === "kimi"
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
    fixedTargetModel,
  }
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

function kimiSearchSelectionRequest(
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
  return route.selectionModel
    ? hasAiCredentialCandidate(selectionRequest(route, module, undefined, null))
    : false
}

async function routePoolCapacity(
  route: AdapterCredentialRoute,
  module: AiCredentialModule,
) {
  let capacity = await getAiCredentialPoolCapacity(selectionRequest(route, module))
  if (capacity.candidateCount === 0 && route.selectionModel) {
    capacity = await getAiCredentialPoolCapacity(
      selectionRequest(route, module, undefined, null),
    )
  }
  return capacity
}

export async function hasAdapterCredentialPoolCandidate(
  model: ModelKey,
  module: AiCredentialModule,
  args: Partial<ChatArgs> = {},
): Promise<boolean> {
  const route = await resolveAdapterCredentialRoute(model, module, args)
  if (isKimiAuditableWebCall(model, module, args)) {
    const [generationReady, searchReady] = await Promise.all([
      hasRouteCandidate(route, module),
      hasAiCredentialCandidate(kimiSearchSelectionRequest(module)),
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

export async function getAdapterCredentialPoolCapacity(
  model: ModelKey,
  module: AiCredentialModule,
  args: Partial<ChatArgs> = {},
): Promise<AdapterCredentialPoolCapacity> {
  const route = await resolveAdapterCredentialRoute(model, module, args)
  if (isKimiAuditableWebCall(model, module, args)) {
    const [generationPool, searchPool] = await Promise.all([
      routePoolCapacity(route, module),
      getAiCredentialPoolCapacity(kimiSearchSelectionRequest(module)),
    ])
    const [generationFallback, searchFallback] = await Promise.all([
      generationPool.candidateCount === 0 ? ADAPTERS.kimi.configured() : false,
      searchPool.candidateCount === 0 ? ADAPTERS.ernie.configured() : false,
    ])
    const generationCount = generationPool.candidateCount || (generationFallback ? 1 : 0)
    const searchCount = searchPool.candidateCount || (searchFallback ? 1 : 0)
    const generationConcurrency = generationPool.maxConcurrency || (generationFallback ? 1 : 0)
    const searchConcurrency = searchPool.maxConcurrency || (searchFallback ? 1 : 0)
    const generationGroups = generationPool.quotaGroupCount || (generationFallback ? 1 : 0)
    const searchGroups = searchPool.quotaGroupCount || (searchFallback ? 1 : 0)
    return {
      // The auditable search pool is the shared bottleneck with Ernie jobs.
      vendor: "ernie",
      candidateCount: Math.min(generationCount, searchCount),
      maxConcurrency: Math.min(generationConcurrency, searchConcurrency),
      quotaGroupCount: Math.min(generationGroups, searchGroups),
      usesFallback: generationFallback || searchFallback,
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
  return {
    vendor: route.vendor,
    candidateCount: fallbackConfigured ? 1 : 0,
    maxConcurrency: fallbackConfigured ? 1 : 0,
    quotaGroupCount: fallbackConfigured ? 1 : 0,
    usesFallback: fallbackConfigured,
  }
}

export async function isAdapterCredentialConfigured(
  model: ModelKey,
  module: AiCredentialModule,
  args: Partial<ChatArgs> = {},
): Promise<boolean> {
  if (await hasAdapterCredentialPoolCandidate(model, module, args)) return true
  if (isKimiAuditableWebCall(model, module, args)) {
    const [kimiConfigured, searchConfigured] = await Promise.all([
      ADAPTERS.kimi.configured(),
      ADAPTERS.ernie.configured(),
    ])
    return kimiConfigured && searchConfigured
  }
  const route = await resolveAdapterCredentialRoute(model, module, args)
  return ADAPTERS[route.vendor].configured()
}

async function runKimiAuditableCredentialPoolChat(
  module: AiCredentialModule,
  args: ChatArgs,
): Promise<string> {
  const route = await resolveAdapterCredentialRoute("kimi", module, args)
  const generationExactRequest = selectionRequest(route, module)
  const generationModel = route.selectionModel
    && await hasAiCredentialCandidate(generationExactRequest)
    ? route.selectionModel
    : undefined
  const [hasGenerationPool, hasSearchPool] = await Promise.all([
    hasRouteCandidate(route, module),
    hasAiCredentialCandidate(kimiSearchSelectionRequest(module)),
  ])
  if (!hasGenerationPool || !hasSearchPool) {
    return ADAPTERS.kimi.chat(args)
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
  let lastError: unknown

  for (let attempt = 0; attempt < maxCredentialAttempts; attempt += 1) {
    const generationLease = await tryAcquireAiCredential({
      ...selectionRequest(
        route,
        module,
        excludedGenerationIds,
        generationModel ?? null,
      ),
      waitTimeoutMs,
      leaseSeconds,
      ...quotaEstimate,
    })
    if (!generationLease) {
      lastError = new Error("Kimi 生成账号池当前繁忙或暂无可用账号")
      break
    }

    let searchLease: AiCredentialLease | null = null
    try {
      searchLease = await tryAcquireAiCredential({
        ...kimiSearchSelectionRequest(module, excludedSearchIds),
        waitTimeoutMs,
        leaseSeconds,
      })
      if (!searchLease) {
        lastError = new Error("Kimi 联网搜索账号池当前繁忙或暂无可用账号")
        continue
      }

      const selectedModel = resolveAiCredentialModel(
        generationLease.credential,
        generationModel || route.targetModel,
        route.requiredCapabilities,
      )
      if (!selectedModel) throw new Error("Kimi 可用账号未配置模型")
      const startedAt = Date.now()
      try {
        const result = await ADAPTERS.kimi.chat({
          ...args,
          runtimeOverride: {
            vendor: "kimi",
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
            model: searchLease.credential.allowedModels[0] || "ernie-5.1",
            timeout: args.timeoutSec,
            extra: { enableSearch: true },
          },
        })
        const latencyMs = Date.now() - startedAt
        await Promise.all([
          recordAiCredentialSuccess(generationLease.credential.id, latencyMs),
          recordAiCredentialSuccess(searchLease.credential.id, latencyMs),
        ])
        return result
      } catch (error) {
        lastError = error
        if (error instanceof BaiduWebSearchError) {
          excludedSearchIds.push(searchLease.credential.id)
          await recordAiCredentialFailure(searchLease.credential, error)
        } else {
          excludedGenerationIds.push(generationLease.credential.id)
          await recordAiCredentialFailure(generationLease.credential, error)
        }
        if (!shouldFailOverAiCredential(error)) throw error
        console.warn(
          "[ai-credential-adapter] kimi/penetration 当前账号不可用，尝试下一账号。",
        )
      }
    } finally {
      await Promise.all([
        generationLease.release(),
        searchLease?.release(),
      ])
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Kimi 严格联网暂无可用账号")
}

export async function runAdapterCredentialPoolChat(
  model: ModelKey,
  module: AiCredentialModule,
  args: ChatArgs,
): Promise<string> {
  if (isKimiAuditableWebCall(model, module, args)) {
    return runKimiAuditableCredentialPoolChat(module, args)
  }
  const route = await resolveAdapterCredentialRoute(model, module, args)
  const excludedCredentialIds: string[] = []
  const exactRequest = selectionRequest(route, module)
  const selectionModel = route.selectionModel
    && await hasAiCredentialCandidate(exactRequest)
    ? route.selectionModel
    : undefined
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
      if (attempt === 0) return ADAPTERS[model].chat(args)
      break
    }

    excludedCredentialIds.push(lease.credential.id)
    const startedAt = Date.now()
    try {
      const credentialModel = route.fixedTargetModel
        ? route.targetModel
        : resolveAiCredentialModel(
            lease.credential,
            selectionModel || route.targetModel,
            route.requiredCapabilities,
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
      await recordAiCredentialSuccess(lease.credential.id, Date.now() - startedAt)
      return result
    } catch (error) {
      lastError = error
      await recordAiCredentialFailure(lease.credential, error)
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
