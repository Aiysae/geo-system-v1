import "server-only"

import { recommendPublishingPlatformsWithAi } from "@/lib/publishing-plan/recommendation-ai"
import {
  buildSourcePlatformSnapshot,
  resolveSourcePlatformDefinitionByName,
} from "@/lib/source-platform-intelligence"
import { distributeInteger } from "@/lib/publishing-plan/calculator"
import type { Client } from "@/types"
import type { MediaPlanItem, SourcePlatformEvidence, SourcePlatformSnapshot } from "@/types/geo-strategy"
import type {
  PublishingContentType,
  PublishingCustomerStage,
  PublishingPlanRecommendation,
  PublishingPlanSourceEvidence,
  PublishingPlatformConfig,
} from "@/types/publishing-plan"

type Candidate = {
  platformKey: string
  platformName: string
  category: PublishingPlanSourceEvidence["category"]
  contentType: PublishingContentType
  source: PublishingPlanSourceEvidence["source"]
  evidence?: SourcePlatformEvidence
  strategyRole?: string
  strategyCadence?: string
  industryFit: number
  stageValue: number
  reason: string
}

const FALLBACK_PLATFORMS = [
  { key: "sohu", name: "搜狐" },
  { key: "zhihu", name: "知乎" },
  { key: "toutiao", name: "今日头条" },
  { key: "wechat", name: "微信公众号" },
]

export async function recommendPublishingPlanPlatforms(input: {
  client: Client
  customerStage: PublishingCustomerStage
  useAi?: boolean
}): Promise<PublishingPlanRecommendation> {
  const snapshot = preferredSnapshot(input.client)
  const candidates = collectCandidates(input.client, snapshot)
  const notes: string[] = []
  let usedFallback = false
  let model: string | undefined
  let recommendationMode: PublishingPlanRecommendation["recommendationMode"] = "evidence_only"
  let recommendationProvider: string | undefined
  let webEvidenceUsed = false
  let webSourceCount = 0
  let cacheHit = false
  let traceId: string | undefined
  let aiCoveredPlatformCount = 0
  let evidenceFilledPlatformCount = 0

  if (input.useAi !== false && candidates.length > 0) {
    try {
      const ai = await recommendPublishingPlatformsWithAi({
        clientId: input.client.id,
        clientName: input.client.name,
        subject: input.client.ourBrand,
        industry: input.client.industry,
        website: input.client.website,
        customerStage: input.customerStage,
        candidates: candidates.map(candidate => ({
          platformKey: candidate.platformKey,
          platformName: candidate.platformName,
          category: candidate.category,
          citationShare: candidate.evidence?.citation_share || 0,
          adoptionRate: candidate.evidence?.adoption_rate || 0,
          modelCoverage: candidate.evidence?.model_keys.length || 0,
          questionCoverage: candidate.evidence?.question_count || 0,
          strategyRole: candidate.strategyRole || "",
          strategyCadence: candidate.strategyCadence || "",
        })),
      })
      const byKey = new Map(ai.rows.map(row => [row.platform_key, row]))
      aiCoveredPlatformCount = byKey.size
      evidenceFilledPlatformCount = ai.missingPlatformKeys.length
      for (const candidate of candidates) {
        const row = byKey.get(candidate.platformKey)
        if (!row) continue
        candidate.industryFit = clampScore(row.industry_fit, candidate.industryFit)
        candidate.stageValue = clampScore(row.stage_value, candidate.stageValue)
        candidate.reason = clean(row.reason, 300) || candidate.reason
        if (row.recommended === false && !candidate.evidence) candidate.stageValue = Math.min(candidate.stageValue, 25)
      }
      model = ai.model || ai.provider
      recommendationMode = ai.mode
      recommendationProvider = ai.provider
      webEvidenceUsed = ai.webEvidenceUsed
      webSourceCount = ai.webSourceCount
      cacheHit = ai.cacheHit
      traceId = ai.traceId
      notes.push(...ai.notes)
      if (ai.missingPlatformKeys.length > 0) {
        usedFallback = true
        recommendationMode = "ai_repaired"
        notes.push("部分平台已根据报告数据补齐。")
      }
    } catch {
      usedFallback = true
      evidenceFilledPlatformCount = candidates.length
      notes.push("已根据现有报告与信源数据生成平台建议。")
    }
  } else {
    usedFallback = true
    evidenceFilledPlatformCount = candidates.length
  }

  const scored = candidates.map(candidate => ({
    candidate,
    score: platformScore(candidate, snapshot),
  })).sort((left, right) => right.score - left.score || left.candidate.platformName.localeCompare(right.candidate.platformName, "zh-CN"))
  const selected = scored
    .filter(item => item.score > 0)
    .slice(0, 12)
  const weights = distributeInteger(10_000, selected.map(item => Math.max(1, item.score)))
  const sourceSnapshot = selected.map(item => sourceEvidence(item.candidate))
  const platformConfigs = selected.map((item, index) => platformConfig(
    item.candidate,
    item.score,
    weights[index],
    sourceSnapshot[index],
    index,
  ))

  if (snapshot.platforms.length === 0) notes.push("当前客户暂无历史信源数据，建议先完成一次联网疑问句检测。")
  if (platformConfigs.length === 0) throw new Error("当前客户资料不足以生成发布平台建议")

  return {
    platformConfigs,
    sourceSnapshot,
    model,
    generatedAt: new Date().toISOString(),
    usedFallback,
    recommendationMode,
    recommendationProvider,
    webEvidenceUsed,
    webSourceCount,
    cacheHit,
    traceId,
    aiCoveredPlatformCount,
    evidenceFilledPlatformCount,
    notes: [...new Set(notes)],
  }
}

function preferredSnapshot(client: Client): SourcePlatformSnapshot {
  const live = buildSourcePlatformSnapshot(client.penetration, { officialWebsite: client.website })
  if (live.platforms.length > 0) return live
  return client.keywordStrategy?.strategyPlan?.source_platform_snapshot || live
}

function collectCandidates(client: Client, snapshot: SourcePlatformSnapshot): Candidate[] {
  const map = new Map<string, Candidate>()
  for (const evidence of snapshot.platforms) {
    map.set(evidence.platform_key, {
      platformKey: evidence.platform_key,
      platformName: evidence.platform,
      category: evidence.category,
      contentType: contentType(evidence.platform_key, evidence.category),
      source: "penetration",
      evidence,
      industryFit: 60,
      stageValue: 65,
      reason: `该平台在联网回答中被引用 ${evidence.citation_events} 次，覆盖 ${evidence.model_keys.length} 个模型。`,
    })
  }

  const strategyPlan = client.keywordStrategy?.strategyPlan
  for (const item of [...(strategyPlan?.media_plan || []), ...(strategyPlan?.authority_media_plan || [])]) {
    mergeStrategyCandidate(map, item)
  }

  if (map.size === 0) {
    for (const fallback of FALLBACK_PLATFORMS) {
      const definition = resolveSourcePlatformDefinitionByName(fallback.name)
      map.set(fallback.key, {
        platformKey: fallback.key,
        platformName: fallback.name,
        category: definition?.category || "self_media",
        contentType: "article",
        source: "system",
        industryFit: 50,
        stageValue: 55,
        reason: "系统基础内容渠道，启用前请结合客户账号与行业情况确认。",
      })
    }
  }
  return [...map.values()]
}

function mergeStrategyCandidate(map: Map<string, Candidate>, item: MediaPlanItem): void {
  const definition = resolveSourcePlatformDefinitionByName(item.platform)
  const key = item.platform_key || definition?.key || `custom:${normalizeKey(item.platform)}`
  const current = map.get(key)
  if (current) {
    current.strategyRole = item.role
    current.strategyCadence = item.cadence
    current.source = current.evidence ? "penetration" : "keyword_strategy"
    if (!current.reason && item.role) current.reason = item.role
    return
  }
  const category = item.platform_type || definition?.category || "self_media"
  map.set(key, {
    platformKey: key,
    platformName: definition?.name || item.platform,
    category,
    contentType: contentType(key, category),
    source: "keyword_strategy",
    strategyRole: item.role,
    strategyCadence: item.cadence,
    industryFit: 65,
    stageValue: 60,
    reason: item.role || "关键词策略推荐渠道。",
  })
}

function platformScore(candidate: Candidate, snapshot: SourcePlatformSnapshot): number {
  const evidence = candidate.evidence
  const maxCitationShare = Math.max(1, ...snapshot.platforms.map(item => item.citation_share))
  const maxAdoption = Math.max(1, ...snapshot.platforms.map(item => item.adoption_rate))
  const maxBalanced = Math.max(1, ...snapshot.platforms.map(item => item.balanced_adoption_rate))
  const maxModels = Math.max(1, snapshot.successful_model_count)
  const maxQuestions = Math.max(1, snapshot.distinct_question_count || 0, ...snapshot.platforms.map(item => item.question_count))
  const signal = evidence
    ? 45 * (
        0.5 * evidence.citation_share / maxCitationShare
        + 0.3 * evidence.adoption_rate / maxAdoption
        + 0.2 * evidence.balanced_adoption_rate / maxBalanced
      )
    : 12
  const modelCoverage = evidence ? 20 * evidence.model_keys.length / maxModels : 5
  const questionCoverage = evidence ? 15 * evidence.question_count / maxQuestions : 5
  return Number((
    signal
    + modelCoverage
    + questionCoverage
    + candidate.industryFit * 0.1
    + candidate.stageValue * 0.1
  ).toFixed(4))
}

function sourceEvidence(candidate: Candidate): PublishingPlanSourceEvidence {
  const evidence = candidate.evidence
  return {
    platformKey: candidate.platformKey,
    platformName: candidate.platformName,
    category: candidate.category,
    citationShare: evidence?.citation_share || 0,
    adoptionRate: evidence?.adoption_rate || 0,
    balancedAdoptionRate: evidence?.balanced_adoption_rate || 0,
    modelCoverage: evidence?.model_keys.length || 0,
    questionCoverage: evidence?.question_count || 0,
    citationEvents: evidence?.citation_events || 0,
    domains: evidence?.domains || [],
    evidenceUrls: (evidence?.evidence || []).map(item => item.url).slice(0, 30),
    source: candidate.source,
  }
}

function platformConfig(
  candidate: Candidate,
  score: number,
  weightBps: number,
  evidence: PublishingPlanSourceEvidence,
  index: number,
): PublishingPlatformConfig {
  const authority = candidate.contentType === "authority_article"
  const video = candidate.contentType === "video"
  return {
    id: `platform_${normalizeKey(candidate.platformKey || String(index + 1))}`,
    platformKey: candidate.platformKey,
    platformName: candidate.platformName,
    category: candidate.category,
    contentType: candidate.contentType,
    enabled: true,
    weightBps,
    dailyLimitPerAccount: authority ? 1 : video ? 2 : 3,
    safeUtilizationBps: 8_000,
    existingAccountCount: 0,
    publishUnitCostCents: authority ? 5_000 : video ? 1_000 : 300,
    maxReusePlatforms: authority ? 3 : video ? 3 : 5,
    evidenceScore: Number(score.toFixed(2)),
    strategicScore: Number(((candidate.industryFit + candidate.stageValue) / 2).toFixed(2)),
    recommendationReason: candidate.reason,
    sourceEvidence: evidence,
  }
}

function contentType(
  platformKey: string,
  category: PublishingPlanSourceEvidence["category"],
): PublishingContentType {
  if (["douyin", "kuaishou", "bilibili"].includes(platformKey)) return "video"
  if (category === "authority_media" || category === "government_association") return "authority_article"
  return "article"
}

function clampScore(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : fallback
}

function normalizeKey(value: string): string {
  return String(value || "platform").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100) || "platform"
}

function clean(value: unknown, max: number): string {
  return String(value || "").trim().slice(0, max)
}
