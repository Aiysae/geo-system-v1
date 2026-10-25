import "server-only"

import { getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { listAiCredentialRuntimes } from "@/lib/ai-credential-store"
import { listAiCredentialRouteHealth } from "@/lib/ai-credential-route-health"
import { shouldFailOverAiCredential } from "@/lib/ai-credential-errors"
import { classifyAiCredentialFailure } from "@/lib/ai-credential-failure-classifier"
import { estimateAiCredentialQuota } from "@/lib/ai-credential-quota"
import { observeAiUsage } from "@/lib/ai-usage"
import {
  getAiCredentialPoolCapacity,
  getAiCredentialPoolSnapshot,
  hasAiCredentialCandidate,
  hasConfiguredAiCredential,
  recordAiCredentialFailure,
  recordAiCredentialSuccess,
  resolveAiCredentialModel,
  tryAcquireAiCredential,
} from "@/lib/ai-credential-router"
import { ADAPTERS } from "@/lib/llm"
import { BaiduWebSearchError } from "@/lib/llm/baidu-ai-search"
import { MoonshotWebSearchError } from "@/lib/llm/moonshot-web-search"
import { YuanbaoWebSearchError } from "@/lib/llm/yuanbao-web-search"
import { deepSeekSearchesOwnEngine } from "@/lib/llm/deepseek"
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
  healthCapabilities: AiCredentialCapability[]
  spreadAcrossCredentials: boolean
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

async function usesAuditableExternalSearch(
  model: ModelKey,
  module: AiCredentialModule,
  args: Partial<ChatArgs>,
): Promise<boolean> {
  if (!isStrictWebCall(module, args)) return false
  // DeepSeek searches with its own engine, or a borrowed Kimi or Baidu
  // account. Hunyuan searches through a Yuanbao search account once one is in
  // the pool, and otherwise keeps TokenHub's built-in search. Kimi searches
  // with its own endpoint on the same account.
  if (model === "deepseek") return true
  if (model === "hunyuan") return hasExternalSearchCandidate(model, module)
  return false
}

function strictCredentialVendor(model: ModelKey): ModelKey {
  return model
}

// Question detection should hear what a real user hears in the vendor's app,
// which runs the flagship model. Earlier patterns rank higher; a vendor not
// listed keeps the configured model.
const DETECTION_MODEL_PREFERENCE: Partial<Record<ModelKey, RegExp[]>> = {
  doubao: [/seed-2-1-pro/i, /seed-\d+-\d+-pro/i, /-pro\b/i, /turbo/i],
  qwen: [/max/i, /qwen3\.\d+-plus/i, /plus/i],
  ernie: [/ernie-5/i, /ernie-4\.5/i],
  zhipu: [/^glm-5\.\d+$/i, /^glm-5/i],
}

/**
 * The strongest web-verified model that currently has a free, healthy account,
 * so one detection run keeps using the flagship and only falls back to a
 * lighter model when no flagship account can serve.
 */
async function detectionFlagshipModel(
  model: ModelKey,
  module: AiCredentialModule,
): Promise<string | undefined> {
  const patterns = DETECTION_MODEL_PREFERENCE[model]
  if (!patterns) return undefined
  const credentials = (await listAiCredentialRuntimes(model)).filter(credential => credential.enabled)
  const verified = [...new Set(credentials.flatMap(credential => credential.verifiedWebModels
    .filter(webModel => credential.allowedModels.includes(webModel))))]
  for (const pattern of patterns) {
    for (const candidate of verified.filter(webModel => pattern.test(webModel)).sort().reverse()) {
      if (await hasAiCredentialCandidate({
        vendor: model,
        module,
        model: candidate,
        requiredCapabilities: ["native_web", "auditable_sources"],
      })) return candidate
    }
  }
  return undefined
}

async function resolveAdapterCredentialRoute(
  model: ModelKey,
  module: AiCredentialModule,
  args: Partial<ChatArgs>,
): Promise<AdapterCredentialRoute> {
  const strictWeb = isStrictWebCall(module, args)
  const nativeWeb = strictWeb || requiresNativeWebCredential(model, args)
  // The strategy report's web research picks its model as question detection
  // does, a web-verified flagship first: the turbo model in the global setting
  // answered it empty without searching five times in six.
  const webResearch = module === "keywordStrategy" && requiresNativeWebCredential(model, args)
  const strictNativeWeb = (strictWeb || webResearch) && model !== "kimi" && model !== "deepseek"
  const vendor = strictWeb ? strictCredentialVendor(model) : model
  const config = await getAiProviderRuntimeSetting(vendor)
  let targetModel = String(args.preferredModel || "").trim() || config.model
  let selectionModel: string | undefined = targetModel

  // DeepSeek detection runs the same model on any account (see chatDeepSeek),
  // so every account serves, whichever models it lists.
  if (strictWeb && model === "deepseek") {
    targetModel = "deepseek-chat"
    selectionModel = undefined
  }
  // Kimi accounts often allow only an older model than the global default;
  // any account's own model can run the search, as on the DeepSeek path.
  if (strictNativeWeb || (strictWeb && model === "kimi")) selectionModel = undefined
  if (strictNativeWeb && !String(args.preferredModel || "").trim()) {
    const flagship = await detectionFlagshipModel(model, module)
    if (flagship) {
      targetModel = flagship
      selectionModel = flagship
    }
  }

  const requiredCapabilities: AiCredentialCapability[] = nativeWeb
    ? model === "kimi" || model === "deepseek"
      ? ["chat"]
      : ["native_web", "auditable_sources"]
    : args.jsonMode
      ? ["json"]
      : ["chat"]
  const healthCapabilities = args.workloadClass === "long" && !nativeWeb
    ? Array.from(new Set<AiCredentialCapability>([...requiredCapabilities, "long_text"]))
    : requiredCapabilities

  return {
    vendor,
    targetModel,
    selectionModel,
    requiredCapabilities,
    healthCapabilities,
    spreadAcrossCredentials: args.spreadAcrossCredentials === true
      || args.workloadClass === "long",
    extra: strictWeb && (vendor === "qwen" || vendor === "ernie")
      ? { enableSearch: true }
      : vendor === "doubao"
        ? { botId: "" }
        : undefined,
    exactModelRequired: strictWeb || Boolean(String(args.preferredModel || "").trim()),
    verifiedWebModelRequired: strictNativeWeb,
  }
}

function resolveRouteCredentialModel(
  route: AdapterCredentialRoute,
  credential: AiCredentialLease["credential"],
  selectedModel: string | undefined,
  unhealthyWebModels: Set<string> = new Set(),
): string {
  if (route.verifiedWebModelRequired) {
    const allowed = new Set(credential.allowedModels)
    const verified = credential.verifiedWebModels.filter(model =>
      allowed.size === 0 || allowed.has(model),
    )
    // Prefer the configured model, but not while its web route is recovering:
    // another verified model on the same account can answer meanwhile.
    const healthy = verified.filter(model => !unhealthyWebModels.has(model))
    if (healthy.includes(route.targetModel)) return route.targetModel
    if (healthy.length > 0) return healthy[0]
    if (verified.includes(route.targetModel)) return route.targetModel
    return verified[0] || ""
  }
  return resolveAiCredentialModel(
    credential,
    selectedModel || route.targetModel,
    route.requiredCapabilities,
  )
}

async function unhealthyStrictWebModels(
  credentialId: string,
  module: AiCredentialModule,
): Promise<Set<string>> {
  const routes = await listAiCredentialRouteHealth([credentialId]).catch(() => [])
  return new Set(routes
    .filter(route => route.module === module
      && route.capabilityProfile === "strict_web"
      && route.state !== "closed"
      && route.state !== "degraded")
    .map(route => route.model))
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
    routeHealthCapabilities: route.healthCapabilities,
    spreadAcrossCredentials: route.spreadAcrossCredentials,
    excludeCredentialIds,
  }
}

// Search accounts a model searches through, in order of preference. DeepSeek
// (only when set to borrow): Kimi's official search, then Baidu Qianfan
// search when no Kimi account is free. Hunyuan: Yuanbao search, the App's own.
type ExternalSearchVendor = "ernie" | "kimi" | "yuanbao_search"
function externalSearchVendors(model: ModelKey): ExternalSearchVendor[] {
  if (model === "hunyuan") return ["yuanbao_search"]
  // DeepSeek's own engine runs on the answering account; no search account.
  return deepSeekSearchesOwnEngine() ? [] : ["kimi", "ernie"]
}

function externalSearchSelectionRequest(
  module: AiCredentialModule,
  excludeCredentialIds?: string[],
  vendor: ExternalSearchVendor = "ernie",
): AiCredentialSelectionRequest {
  if (vendor === "yuanbao_search") {
    return {
      vendor,
      module,
      requiredCapabilities: ["native_web", "auditable_sources"],
      excludeCredentialIds,
      rateUnits: 0,
    }
  }
  return vendor === "kimi"
    ? {
        // Same account and key as Kimi's own detection, so search failures
        // share its route health. Search has its own per-second cap and
        // spends none of the account's chat requests per minute.
        vendor: "kimi",
        module,
        requiredCapabilities: ["chat"],
        excludeCredentialIds,
        rateUnits: 0,
      }
    : {
        vendor: "ernie",
        module,
        requiredCapabilities: ["native_web", "auditable_sources"],
        excludeCredentialIds,
      }
}

async function hasExternalSearchCandidate(model: ModelKey, module: AiCredentialModule): Promise<boolean> {
  const vendors = externalSearchVendors(model)
  if (vendors.length === 0) return true
  const ready = await Promise.all(vendors.map(vendor =>
    hasAiCredentialCandidate(externalSearchSelectionRequest(module, undefined, vendor))))
  return ready.some(Boolean)
}

/**
 * The first search vendor that still has an account, so capacity reflects
 * what will run; none when the model searches on its own account.
 */
async function activeExternalSearchVendor(
  model: ModelKey,
  module: AiCredentialModule,
): Promise<ExternalSearchVendor | undefined> {
  const vendors = externalSearchVendors(model)
  for (const vendor of vendors) {
    if (await hasAiCredentialCandidate(externalSearchSelectionRequest(module, undefined, vendor))) return vendor
  }
  return vendors[0]
}

/** The pool a capacity report is shared under: a borrowed search account, or the model's own. */
function capacityVendor(model: ModelKey, searchVendor: ExternalSearchVendor | undefined): ModelKey {
  return searchVendor === "kimi" || searchVendor === "ernie" ? searchVendor : model
}

async function hasRouteCandidate(
  route: AdapterCredentialRoute,
  module: AiCredentialModule,
): Promise<boolean> {
  return hasAiCredentialCandidate(selectionRequest(route, module))
}

async function routePoolCapacity(
  route: AdapterCredentialRoute,
  module: AiCredentialModule,
) {
  return getAiCredentialPoolCapacity(selectionRequest(route, module))
}

async function routePoolSnapshot(
  route: AdapterCredentialRoute,
  module: AiCredentialModule,
) {
  return getAiCredentialPoolSnapshot(selectionRequest(route, module))
}

export async function hasAdapterCredentialPoolCandidate(
  model: ModelKey,
  module: AiCredentialModule,
  args: Partial<ChatArgs> = {},
): Promise<boolean> {
  const route = await resolveAdapterCredentialRoute(model, module, args)
  if (await usesAuditableExternalSearch(model, module, args)) {
    const [generationReady, searchReady] = await Promise.all([
      hasAiCredentialCandidate(selectionRequest(route, module, undefined, null)),
      hasExternalSearchCandidate(model, module),
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
  if (await usesAuditableExternalSearch(model, module, args)) {
    const searchVendor = await activeExternalSearchVendor(model, module)
    const generationPool = await getAiCredentialPoolCapacity(selectionRequest(route, module, undefined, null))
    // Searching on the answering account adds no second pool.
    const searchPool = searchVendor
      ? await getAiCredentialPoolCapacity(externalSearchSelectionRequest(module, undefined, searchVendor))
      : generationPool
    return {
      // A borrowed search pool is the shared bottleneck with that vendor's jobs.
      vendor: capacityVendor(model, searchVendor),
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
  if (await usesAuditableExternalSearch(model, module, args)) {
    const searchVendor = await activeExternalSearchVendor(model, module)
    const generationPool = await getAiCredentialPoolSnapshot(selectionRequest(route, module, undefined, null))
    const searchPool = searchVendor
      ? await getAiCredentialPoolSnapshot(externalSearchSelectionRequest(module, undefined, searchVendor))
      : generationPool
    const maxConcurrency = Math.min(generationPool.maxConcurrency, searchPool.maxConcurrency)
    const availableConcurrency = Math.min(
      generationPool.availableConcurrency,
      searchPool.availableConcurrency,
    )
    return {
      vendor: capacityVendor(model, searchVendor),
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
    hasExternalSearchCandidate(model, module),
  ])
  if (!hasGenerationPool || !hasSearchPool) {
    throw new Error(`${label} 严格联网账号池未配置完整或当前模型尚未通过验证`)
  }

  const excludedGenerationIds: string[] = []
  const excludedSearchIds: string[] = []
  const quotaEstimate = estimateAiCredentialQuota(args)
  const maxCredentialAttempts = args.credentialAttemptLimit
    ? Math.max(1, Math.min(8, Math.floor(args.credentialAttemptLimit)))
    : Math.max(
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
      // A borrowed search account is the shared bottleneck. Acquire it first, then pair a generation lane with a short wait. This
      // avoids occupying a scarce generation account while waiting on search.
      // DeepSeek's own engine needs no search account: it searches on the
      // generation account.
      const searchVendors = externalSearchVendors(model)
      let searchVendor: ExternalSearchVendor | undefined = searchVendors[0]
      for (const vendor of searchVendors) {
        const request = externalSearchSelectionRequest(module, excludedSearchIds, vendor)
        // Only wait on a vendor that has an account at all; otherwise move on.
        if (!(await hasAiCredentialCandidate(request))) continue
        searchVendor = vendor
        searchLease = await tryAcquireAiCredential({
          ...request,
          waitTimeoutMs,
          leaseSeconds,
          signal: args.signal,
        })
        if (searchLease) break
      }
      if (searchVendors.length > 0 && !searchLease) {
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
        waitTimeoutMs: searchLease ? pairWaitTimeoutMs : waitTimeoutMs,
        leaseSeconds,
        signal: args.signal,
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
      const searchModel = searchLease?.credential.allowedModels[0]
        || (searchVendor === "kimi" ? "kimi-k2.6" : searchVendor === "yuanbao_search" ? "SearchPro" : "ernie-5.1")
      const searchCapabilities: AiCredentialCapability[] = searchVendor === "kimi"
        ? ["chat"]
        : ["native_web", "auditable_sources"]
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
          searchRuntimeOverride: searchLease && searchVendor
            ? {
                vendor: searchVendor,
                baseUrl: searchLease.credential.baseUrl,
                chatPath: searchLease.credential.chatPath,
                apiKey: searchLease.credential.apiKey,
                model: searchModel,
                timeout: args.timeoutSec,
                extra: searchVendor === "ernie" ? { enableSearch: true } : undefined,
              }
            : undefined,
        })
        const latencyMs = Date.now() - startedAt
        await Promise.all([
          recordAiCredentialSuccess(generationLease.credential, latencyMs, {
            module,
            model: selectedModel,
            requiredCapabilities: route.healthCapabilities,
          }),
          searchLease && recordAiCredentialSuccess(searchLease.credential, latencyMs, {
            module,
            model: searchModel,
            requiredCapabilities: searchCapabilities,
          }),
        ])
        return result
      } catch (error) {
        lastError = error
        if (searchLease && (
          error instanceof BaiduWebSearchError
          || error instanceof MoonshotWebSearchError
          || error instanceof YuanbaoWebSearchError
        )) {
          excludedSearchIds.push(searchLease.credential.id)
          await recordAiCredentialFailure(searchLease.credential, error, {
            module,
            model: searchModel,
            requiredCapabilities: searchCapabilities,
          })
        } else {
          excludedGenerationIds.push(generationLease.credential.id)
          await recordAiCredentialFailure(generationLease.credential, error, {
            module,
            model: selectedModel,
            requiredCapabilities: route.healthCapabilities,
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
  if (await usesAuditableExternalSearch(model, module, args)) {
    return runAuditableExternalCredentialPoolChat(model, module, args)
  }
  const route = await resolveAdapterCredentialRoute(model, module, args)
  const hasPoolCandidate = await hasRouteCandidate(route, module)
  const hasPool = await hasConfiguredAiCredential(route.vendor, module)
  if (!hasPoolCandidate && !hasPool && !route.exactModelRequired) {
    return ADAPTERS[model].chat(args)
  }
  const excludedCredentialIds: string[] = []
  const exactRequest = selectionRequest(route, module)
  const selectionModel = route.selectionModel
  if (
    route.exactModelRequired
    && !route.verifiedWebModelRequired
    && !(await hasAiCredentialCandidate(exactRequest))
  ) {
    throw new Error(
      args.preferredModel
        ? `${ADAPTERS[model].label} 指定的长任务模型当前暂无可用账号`
        : `${ADAPTERS[model].label} 当前模型尚未通过严格联网验证`,
    )
  }
  let lastError: unknown
  const quotaEstimate = estimateAiCredentialQuota(args)
  const maxCredentialAttempts = args.credentialAttemptLimit
    ? Math.max(1, Math.min(8, Math.floor(args.credentialAttemptLimit)))
    : Math.max(
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
      signal: args.signal,
      ...quotaEstimate,
    })
    if (!lease) {
      if (route.exactModelRequired) {
        throw new Error(`${ADAPTERS[model].label} 当前独立账号并发已满，请等待空闲通道`)
      }
      if (attempt === 0 && !hasPool) return ADAPTERS[model].chat(args)
      break
    }

    excludedCredentialIds.push(lease.credential.id)
    const startedAt = Date.now()
    const unhealthyWebModels = route.verifiedWebModelRequired
      ? await unhealthyStrictWebModels(lease.credential.id, module)
      : new Set<string>()
    try {
      const credentialModel = resolveRouteCredentialModel(
        route,
        lease.credential,
        selectionModel,
        unhealthyWebModels,
      )
      if (!credentialModel) throw new Error(`${ADAPTERS[model].label} 可用账号未配置模型`)
      const result = await observeAiUsage({
        userId: args.usageContext?.userId || "unattributed",
        task: args.usageContext?.task || `adapter:${module}:${args.mode || "chat"}`,
        providerKey: route.vendor,
        providerName: lease.credential.accountLabel,
        modelId: credentialModel,
        credentialId: lease.credential.id,
        usedFallback: attempt > 0,
      }, onUsage => ADAPTERS[model].chat({
        ...args,
        onUsage,
        runtimeOverride: {
          vendor: route.vendor,
          baseUrl: lease.credential.baseUrl,
          chatPath: lease.credential.chatPath,
          apiKey: lease.credential.apiKey,
          model: credentialModel,
          timeout: args.timeoutSec,
          extra: route.extra,
        },
      }), args.onUsage)
      await recordAiCredentialSuccess(lease.credential, Date.now() - startedAt, {
        module,
        model: credentialModel,
        requiredCapabilities: route.healthCapabilities,
      })
      return result
    } catch (error) {
      lastError = error
      await recordAiCredentialFailure(lease.credential, error, {
        module,
        model: resolveRouteCredentialModel(route, lease.credential, selectionModel, unhealthyWebModels),
        requiredCapabilities: route.healthCapabilities,
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
