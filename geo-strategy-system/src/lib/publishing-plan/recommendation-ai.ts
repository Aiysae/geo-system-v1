import "server-only"

import { createHash, randomUUID } from "node:crypto"
import {
  isAdapterCredentialConfigured,
  runAdapterCredentialPoolChat,
} from "@/lib/ai-credential-adapter"
import { sanitizeAiUpstreamMessage } from "@/lib/ai-secrets"
import { getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import type { ChatArgs, SearchSourceEvent } from "@/lib/llm/openai-compat"
import {
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

  try {
    webSummary = await dependencies.chat("doubao", "research", {
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
      onSearchSources: event => {
        webEvent = event
      },
    })
  } catch (error) {
    notes.push("已基于现有报告完成 AI 平台适配；实时行业资料未参与本次增强。")
    logStage(traceId, input.clientId, "web_evidence_unavailable", error)
  }

  const webEvidenceUsed = Boolean(webSummary.trim() && webEvent?.searchExecuted)
  const webSourceCount = webEvent?.sources.length || 0
  const providers: ModelKey[] = ["doubao"]
  if (await dependencies.configured("qwen", "judge", { jsonMode: true })) providers.push("qwen")

  let lastError: unknown
  for (const provider of providers) {
    let raw = ""
    try {
      raw = await dependencies.chat(provider, "judge", judgeArgs(input, webSummary, webEvent, signal))
      const rows = parsePublishingPlatformRecommendations(raw, allowedKeys)
      const setting = await dependencies.runtimeSetting(provider)
      logStage(traceId, input.clientId, "schema_valid", undefined, provider)
      return {
        rows,
        mode: provider === "doubao" ? "ai_enhanced" : "ai_repaired",
        provider,
        model: setting.model,
        webEvidenceUsed,
        webSourceCount,
        notes,
      }
    } catch (error) {
      lastError = error
      logStage(traceId, input.clientId, "schema_invalid", error, provider)
    }

    if (signal.aborted) throw new Error("AI 平台适配处理超时")
    if (!raw.trim()) continue
    try {
      const repaired = await dependencies.chat(provider, "judge", repairArgs(raw, allowedKeys, signal))
      const rows = parsePublishingPlatformRecommendations(repaired, allowedKeys)
      const setting = await dependencies.runtimeSetting(provider)
      notes.push("AI 平台建议已自动校验并完成格式修复。")
      logStage(traceId, input.clientId, "schema_repair_success", undefined, provider)
      return {
        rows,
        mode: "ai_repaired",
        provider,
        model: setting.model,
        webEvidenceUsed,
        webSourceCount,
        notes,
      }
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
  console.info("[publishing-plan-recommendation]", JSON.stringify({
    traceId,
    clientId,
    stage,
    provider,
    detail,
  }))
}
