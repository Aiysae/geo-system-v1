import "server-only"

import { getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { shouldFailOverAiCredential } from "@/lib/ai-credential-errors"
import { estimateAiCredentialQuota } from "@/lib/ai-credential-quota"
import {
  hasAiCredentialCandidate,
  recordAiCredentialFailure,
  recordAiCredentialSuccess,
  resolveAiCredentialModel,
  tryAcquireAiCredential,
} from "@/lib/ai-credential-router"
import { ADAPTERS } from "@/lib/llm"
import type { ChatArgs } from "@/lib/llm/openai-compat"
import type { ModelKey } from "@/types"
import type {
  AiCredentialCapability,
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

function strictCredentialVendor(model: ModelKey): ModelKey {
  if (model === "deepseek") return "qwen"
  if (
    model === "kimi"
    && process.env.KIMI_STRICT_SEARCH_PROVIDER?.trim().toLowerCase() !== "moonshot"
  ) {
    return "ernie"
  }
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
  } else if (strictWeb && model === "kimi" && vendor === "ernie") {
    const kimiConfig = await getAiProviderRuntimeSetting("kimi")
    targetModel = process.env.KIMI_BAIDU_SEARCH_MODEL?.trim()
      || kimiConfig.model
      || "kimi-k2.6"
    selectionModel = undefined
    fixedTargetModel = true
  }

  return {
    vendor,
    targetModel,
    selectionModel,
    requiredCapabilities: strictWeb
      ? ["native_web", "auditable_sources"]
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

export async function hasAdapterCredentialPoolCandidate(
  model: ModelKey,
  module: AiCredentialModule,
  args: Partial<ChatArgs> = {},
): Promise<boolean> {
  const route = await resolveAdapterCredentialRoute(model, module, args)
  if (await hasAiCredentialCandidate(selectionRequest(route, module))) return true
  return route.selectionModel
    ? hasAiCredentialCandidate(selectionRequest(route, module, undefined, null))
    : false
}

export async function isAdapterCredentialConfigured(
  model: ModelKey,
  module: AiCredentialModule,
  args: Partial<ChatArgs> = {},
): Promise<boolean> {
  if (await hasAdapterCredentialPoolCandidate(model, module, args)) return true
  return ADAPTERS[model].configured()
}

export async function runAdapterCredentialPoolChat(
  model: ModelKey,
  module: AiCredentialModule,
  args: ChatArgs,
): Promise<string> {
  const route = await resolveAdapterCredentialRoute(model, module, args)
  const excludedCredentialIds: string[] = []
  const exactRequest = selectionRequest(route, module)
  const selectionModel = route.selectionModel
    && await hasAiCredentialCandidate(exactRequest)
    ? route.selectionModel
    : undefined
  let lastError: unknown
  const quotaEstimate = estimateAiCredentialQuota(args)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const lease = await tryAcquireAiCredential({
      ...selectionRequest(route, module, excludedCredentialIds, selectionModel ?? null),
      waitTimeoutMs: Math.min(60_000, Math.max(5_000, (args.timeoutSec ?? 60) * 1000)),
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
