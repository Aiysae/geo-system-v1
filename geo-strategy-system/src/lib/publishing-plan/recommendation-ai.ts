import "server-only"

import { createHash, randomUUID } from "node:crypto"
import {
  isAdapterCredentialConfigured,
  runAdapterCredentialPoolChat,
} from "@/lib/ai-credential-adapter"
import { classifyAiCredentialFailure } from "@/lib/ai-credential-failure-classifier"
import { sanitizeAiUpstreamMessage } from "@/lib/ai-secrets"
import { getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import type { ChatArgs, SearchSourceEvent } from "@/lib/llm/openai-compat"
import {
  getMissingPublishingPlatformKeys,
  PUBLISHING_RECOMMENDATION_OUTPUT_SCHEMA,
  parsePublishingPlatformRecommendations,
  type PublishingPlatformAiRecommendation,
} from "@/lib/publishing-plan/recommendation-contract"
import type { ModelKey } from "@/types"
import type { AiCredentialModule } from "@/types/ai-credentials"
import type { PublishingCustomerStage } from "@/types/publishing-plan"

export interface PublishingRecommendationAiCandidate {
  platformKey: string
  platformName: string
  category: string
  citationShare: number
  adoptionRate: number
  modelCoverage: number
  questionCoverage: number
  strategyRole: string
  strategyCadence: string
}

export interface PublishingRecommendationAiInput {
  clientId: string
  clientName: string
  subject: string
  industry: string
  website: string
  customerStage: PublishingCustomerStage
  candidates: PublishingRecommendationAiCandidate[]
}

export type PublishingRecommendationAiMode = "ai_enhanced" | "ai_repaired"

export interface PublishingRecommendationAiResult {
  rows: PublishingPlatformAiRecommendation[]
  mode: PublishingRecommendationAiMode
  provider: ModelKey
  model?: string
  webEvidenceUsed: boolean
  webSourceCount: number
  cacheHit: boolean
  traceId: string
  notes: string[]
  missingPlatformKeys: string[]
}

type RecommendationAiCoreResult = Omit<PublishingRecommendationAiResult, "cacheHit" | "traceId">

export interface RecommendationAiDependencies {
  chat: (model: ModelKey, module: AiCredentialModule, args: ChatArgs) => Promise<string>
  configured: (
    model: ModelKey,
    module: AiCredentialModule,
    args?: Partial<ChatArgs>,
  ) => Promise<boolean>
  runtimeSetting: (provider: ModelKey) => Promise<{ model: string }>
}

const CACHE_TTL_MS = 10 * 60_000
const CACHE_MAX_ENTRIES = 200
const REQUEST_BUDGET_MS = 105_000
const JUDGE_PROVIDERS: ModelKey[] = ["doubao", "qwen"]
const resultCache = new Map<string, { expiresAt: number; value: RecommendationAiCoreResult }>()
const inFlight = new Map<string, {
  traceId: string
  promise: Promise<RecommendationAiCoreResult>
}>()

const defaultDependencies: RecommendationAiDependencies = {
  chat: runAdapterCredentialPoolChat,
  configured: isAdapterCredentialConfigured,
  runtimeSetting: getAiProviderRuntimeSetting,
}

export async function recommendPublishingPlatformsWithAi(
  input: PublishingRecommendationAiInput,
  dependencies: RecommendationAiDependencies = defaultDependencies,
): Promise<PublishingRecommendationAiResult> {
  const traceId = randomUUID()
  const cacheKey = recommendationCacheKey(input)
  pruneCache()
  const cached = resultCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    logStage(traceId, input.clientId, "cache_hit")
    return { ...cloneCoreResult(cached.value), cacheHit: true, traceId }
  }

  let operation = inFlight.get(cacheKey)
  if (!operation) {
    operation = {
      traceId,
      promise: executeRecommendation(input, dependencies, traceId),
    }
    inFlight.set(cacheKey, operation)
  }
  try {
    const result = await operation.promise
    resultCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value: cloneCoreResult(result),
    })
    return { ...cloneCoreResult(result), cacheHit: false, traceId: operation.traceId }
  } finally {
    if (inFlight.get(cacheKey) === operation) inFlight.delete(cacheKey)
  }
}

async function executeRecommendation(
  input: PublishingRecommendationAiInput,
  dependencies: RecommendationAiDependencies,
  traceId: string,
): Promise<RecommendationAiCoreResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_BUDGET_MS)
  try {
    return await executeRecommendationWithinBudget(input, dependencies, traceId, controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

async function executeRecommendationWithinBudget(
  input: PublishingRecommendationAiInput,
  dependencies: RecommendationAiDependencies,
  traceId: string,
  signal: AbortSignal,
): Promise<RecommendationAiCoreResult> {
  const allowedKeys = input.candidates.map(candidate => candidate.platformKey)
  const notes: string[] = []
  let webSummary = ""
  let webEvent: SearchSourceEvent | undefined
  const evidenceArgs = researchArgs(input, signal, event => {
    webEvent = event
  })

  if (await providerConfigured(dependencies, "doubao", "research", evidenceArgs, traceId, input.clientId)) {
    try {
      webSummary = await dependencies.chat("doubao", "research", evidenceArgs)
    } catch (error) {
      logStage(traceId, input.clientId, "web_evidence_unavailable", error, "doubao")
    }
  } else {
    logStage(traceId, input.clientId, "web_evidence_route_unavailable", undefined, "doubao")
  }

  const webEvidenceUsed = Boolean(webSummary.trim() && webEvent?.searchExecuted)
  const webSourceCount = webEvent?.sources.length || 0
  if (!webEvidenceUsed) notes.push("本次建议已根据现有报告与信源数据生成。")
  const providerAvailability = await Promise.all(JUDGE_PROVIDERS.map(async provider => ({
    provider,
    configured: await providerConfigured(
      dependencies,
      provider,
      "judge",
      { jsonMode: true },
      traceId,
      input.clientId,
    ),
  })))
  const providers = providerAvailability
    .filter(item => item.configured)
    .map(item => item.provider)

  if (providers.length === 0) throw new Error("平台建议模型当前不可用")

  let lastError: unknown
  for (const provider of providers) {
    let raw = ""
    try {
      raw = await dependencies.chat(provider, "judge", judgeArgs(input, webSummary, webEvent, signal))
      const rows = parsePublishingPlatformRecommendations(raw, allowedKeys)
      return await buildCoreResult({
        rows,
        requestedMode: provider === "doubao" ? "ai_enhanced" : "ai_repaired",
        provider,
        webEvidenceUsed,
        webSourceCount,
        notes,
        allowedKeys,
        dependencies,
        traceId,
        clientId: input.clientId,
      })
    } catch (error) {
      lastError = error
      logStage(traceId, input.clientId, "schema_invalid", error, provider)
    }

    if (signal.aborted) throw new Error("AI 平台适配处理超时")
    if (!raw.trim()) continue
    try {
      const repaired = await dependencies.chat(provider, "judge", repairArgs(raw, allowedKeys, signal))
      const rows = parsePublishingPlatformRecommendations(repaired, allowedKeys)
      notes.push("平台建议已自动校验。")
      return await buildCoreResult({
        rows,
        requestedMode: "ai_repaired",
        provider,
        webEvidenceUsed,
        webSourceCount,
        notes,
        allowedKeys,
        dependencies,
        traceId,
        clientId: input.clientId,
      })
    } catch (error) {
      lastError = error
      logStage(traceId, input.clientId, "schema_repair_failed", error, provider)
    }
    if (signal.aborted) throw new Error("AI 平台适配处理超时")
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("AI 平台适配判断暂不可用")
}

function researchArgs(
  input: PublishingRecommendationAiInput,
  signal: AbortSignal,
  onSearchSources: (event: SearchSourceEvent) => void,
): ChatArgs {
  return {
    system: [
      "你是 GEO 内容渠道调研分析师。",
      "请联网核实候选平台与当前行业、地域及客户阶段的适配信号。",
      "只输出简洁的证据摘要，不计算金额、篇数、权重或账号数。",
      "不得添加候选列表以外的平台。",
    ].join("\n"),
    user: JSON.stringify({
      task: "为后续结构化裁判补充公开网络证据",
      client: clientPayload(input),
      candidates: input.candidates.map(candidate => ({
        platform_key: candidate.platformKey,
        platform: candidate.platformName,
        category: candidate.category,
      })),
    }),
    temperature: 0.1,
    maxTokens: 1_800,
    jsonMode: false,
    timeoutSec: 55,
    forceWebSearch: true,
    allowWebSearch: true,
    requireWebEvidence: true,
    officialWebOnly: true,
    signal,
    onSearchSources,
  }
}

function judgeArgs(
  input: PublishingRecommendationAiInput,
  webSummary: string,
  webEvent: SearchSourceEvent | undefined,
  signal: AbortSignal,
): ChatArgs {
  return {
    system: [
      "你是 GEO 内容渠道的结构化裁判器。",
      "只根据提供的报告指标和公开证据判断候选平台的行业适配度与阶段价值。",
      "不计算金额、篇数、权重或账号数，不得添加候选列表以外的平台。",
      "不要解释过程，只输出符合 output_schema 的 JSON 对象。",
    ].join("\n"),
    user: JSON.stringify({
      task: "评估候选发布平台",
      client: clientPayload(input),
      candidates: input.candidates.map(candidate => ({
        platform_key: candidate.platformKey,
        platform: candidate.platformName,
        category: candidate.category,
        citation_share: candidate.citationShare,
        adoption_rate: candidate.adoptionRate,
        model_coverage: candidate.modelCoverage,
        question_coverage: candidate.questionCoverage,
        strategy_role: candidate.strategyRole,
        strategy_cadence: candidate.strategyCadence,
      })),
      evidence: {
        web_summary: cleanText(webSummary, 7_000),
        web_sources: (webEvent?.sources || []).slice(0, 16).map(source => ({
          title: cleanText(source.title, 180),
          domain: cleanText(source.domain, 160),
          url: cleanText(source.url, 600),
          snippet: cleanText(source.snippet, 500),
        })),
      },
      output_schema: PUBLISHING_RECOMMENDATION_OUTPUT_SCHEMA,
    }),
    temperature: 0,
    maxTokens: 3_500,
    jsonMode: true,
    allowWebSearch: false,
    timeoutSec: 35,
    signal,
  }
}

function repairArgs(raw: string, allowedKeys: string[], signal: AbortSignal): ChatArgs {
  return {
    system: [
      "你是 JSON 格式修复器，不进行新的分析或联网检索。",
      "只保留候选平台列表内的数据，修复为符合 output_schema 的 JSON 对象。",
      "不要输出 Markdown 代码块或解释文字。",
    ].join("\n"),
    user: JSON.stringify({
      allowed_platform_keys: allowedKeys,
      output_schema: PUBLISHING_RECOMMENDATION_OUTPUT_SCHEMA,
      raw_output: cleanText(raw, 12_000),
    }),
    temperature: 0,
    maxTokens: 3_500,
    jsonMode: true,
    allowWebSearch: false,
    timeoutSec: 25,
    signal,
  }
}

async function providerConfigured(
  dependencies: RecommendationAiDependencies,
  provider: ModelKey,
  module: AiCredentialModule,
  args: Partial<ChatArgs>,
  traceId: string,
  clientId: string,
): Promise<boolean> {
  try {
    return await dependencies.configured(provider, module, args)
  } catch (error) {
    logStage(traceId, clientId, "provider_health_check_failed", error, provider)
    return false
  }
}

async function buildCoreResult(input: {
  rows: PublishingPlatformAiRecommendation[]
  requestedMode: PublishingRecommendationAiMode
  provider: ModelKey
  webEvidenceUsed: boolean
  webSourceCount: number
  notes: string[]
  allowedKeys: string[]
  dependencies: RecommendationAiDependencies
  traceId: string
  clientId: string
}): Promise<RecommendationAiCoreResult> {
  const missingPlatformKeys = getMissingPublishingPlatformKeys(input.rows, input.allowedKeys)
  const mode = missingPlatformKeys.length > 0 ? "ai_repaired" : input.requestedMode
  let model: string | undefined
  try {
    model = (await input.dependencies.runtimeSetting(input.provider)).model
  } catch (error) {
    logStage(input.traceId, input.clientId, "runtime_setting_unavailable", error, input.provider)
  }
  logStage(
    input.traceId,
    input.clientId,
    missingPlatformKeys.length > 0 ? "coverage_partial" : "schema_valid",
    undefined,
    input.provider,
  )
  return {
    rows: input.rows,
    mode,
    provider: input.provider,
    model,
    webEvidenceUsed: input.webEvidenceUsed,
    webSourceCount: input.webSourceCount,
    notes: [...input.notes],
    missingPlatformKeys,
  }
}

function clientPayload(input: PublishingRecommendationAiInput): Record<string, string> {
  return {
    name: input.clientName,
    subject: input.subject,
    industry: input.industry,
    website: input.website,
    customer_stage: input.customerStage,
  }
}

function recommendationCacheKey(input: PublishingRecommendationAiInput): string {
  return createHash("sha256").update(JSON.stringify({
    clientId: input.clientId,
    subject: input.subject,
    industry: input.industry,
    website: input.website,
    customerStage: input.customerStage,
    candidates: input.candidates,
  })).digest("hex")
}

function pruneCache(): void {
  const now = Date.now()
  for (const [key, entry] of resultCache) {
    if (entry.expiresAt <= now) resultCache.delete(key)
  }
  while (resultCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = resultCache.keys().next().value
    if (!oldest) break
    resultCache.delete(oldest)
  }
}

function cloneCoreResult(result: RecommendationAiCoreResult): RecommendationAiCoreResult {
  return {
    ...result,
    rows: result.rows.map(row => ({ ...row })),
    notes: [...result.notes],
    missingPlatformKeys: [...result.missingPlatformKeys],
  }
}

function cleanText(value: unknown, max: number): string {
  return String(value || "").trim().slice(0, max)
}

function logStage(
  traceId: string,
  clientId: string,
  stage: string,
  error?: unknown,
  provider?: ModelKey,
): void {
  const detail = error
    ? sanitizeAiUpstreamMessage(error instanceof Error ? error.message : String(error), 220)
    : undefined
  const diagnosis = error ? classifyAiCredentialFailure(error) : undefined
  console.info("[publishing-plan-recommendation]", JSON.stringify({
    traceId,
    clientId,
    stage,
    provider,
    detail,
    failureCode: diagnosis?.code,
    failureScope: diagnosis?.scope,
  }))
}
