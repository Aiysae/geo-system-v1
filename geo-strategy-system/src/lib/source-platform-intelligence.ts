import type { ModelKey, PenetrationResult, PenetrationSource } from "@/types"
import type {
  GeoStrategyPlan,
  MediaPlanItem,
  SourcePlatformCategory,
  SourcePlatformCitationEvidence,
  SourcePlatformEvidence,
  SourcePlatformSnapshot,
} from "@/types/geo-strategy"
import {
  buildPenetrationQuestionSamples,
  computePenetrationSourceDiversity,
} from "@/lib/penetration/sample-design"
import { isAuditableSourceUrl, normalizeSourceDomain } from "@/lib/llm/source-extract"
import {
  normalizeSourcePlatformName as normalizePlatformName,
  resolveSourcePlatformByDomain,
  resolveSourcePlatformByName,
  sourcePlatformDomainMatches,
  type SourcePlatformDefinition,
} from "@/lib/source-platform-registry"

export const SOURCE_PLATFORM_CATEGORY_LABELS: Record<SourcePlatformCategory, string> = {
  self_media: "自媒体平台",
  industry_vertical: "行业垂直平台",
  authority_media: "官媒/权威媒体",
  government_association: "政府/协会信源",
  brand_official: "品牌官网",
  other: "其他有效信源",
}


const SOURCE_PLATFORM_CATEGORIES = new Set<SourcePlatformCategory>([
  "self_media",
  "industry_vertical",
  "authority_media",
  "government_association",
  "brand_official",
  "other",
])

function normalizedWebUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    parsed.hash = ""
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_.+|spm|from|from_source|share_token|track)$/i.test(key)) {
        parsed.searchParams.delete(key)
      }
    }
    return parsed.toString()
  } catch {
    return null
  }
}

function websiteDomain(website?: string): string {
  if (!website?.trim()) return ""
  const withProtocol = /^https?:\/\//i.test(website) ? website : `https://${website}`
  return normalizeSourceDomain(withProtocol)
}

export function resolveSourcePlatformDefinitionByName(value: string): SourcePlatformDefinition | null {
  return resolveSourcePlatformByName(value)
}

function classifySourcePlatform(domain: string, officialDomain: string): SourcePlatformDefinition {
  if (officialDomain && (sourcePlatformDomainMatches(domain, officialDomain) || sourcePlatformDomainMatches(officialDomain, domain))) {
    return {
      key: `official:${officialDomain}`,
      name: "品牌官网",
      category: "brand_official",
      domains: [officialDomain],
      aliases: [],
    }
  }

  const resolved = resolveSourcePlatformByDomain(domain)
  return resolved || { key: `domain:${domain}`, name: domain, category: "other", domains: [domain], aliases: [] }
}

interface MutablePlatformEvidence {
  definition: SourcePlatformDefinition
  domains: Set<string>
  answerHits: number
  citationEvents: number
  uniqueUrls: Set<string>
  models: Set<string>
  questions: Set<string>
  intents: Set<string>
  categories: Set<string>
  evidence: SourcePlatformCitationEvidence[]
  evidenceKeys: Set<string>
  modelAnswerHits: Map<string, number>
}

function validSources(itemSources: PenetrationSource[] | undefined): Array<PenetrationSource & { normalizedUrl: string }> {
  const sources: Array<PenetrationSource & { normalizedUrl: string }> = []
  const seen = new Set<string>()
  for (const source of itemSources || []) {
    const normalizedUrl = normalizedWebUrl(String(source.url || ""))
    if (!normalizedUrl || seen.has(normalizedUrl)) continue
    if (!isAuditableSourceUrl(normalizedUrl, String(source.title || ""), String(source.snippet || ""))) continue
    seen.add(normalizedUrl)
    sources.push({ ...source, normalizedUrl })
  }
  return sources
}

export function buildSourcePlatformSnapshot(
  penetration?: PenetrationResult,
  options: { officialWebsite?: string } = {},
): SourcePlatformSnapshot {
  const calculatedAt = new Date().toISOString()
  if (!penetration) {
    return {
      calculated_at: calculatedAt,
      successful_answer_count: 0,
      successful_model_count: 0,
      total_citation_events: 0,
      platforms: [],
    }
  }

  const officialDomain = websiteDomain(options.officialWebsite)
  const platformMap = new Map<string, MutablePlatformEvidence>()
  const successfulQuestionTexts = Array.from(new Set(
    Object.values(penetration.byModel).flatMap(items =>
      (items || [])
        .filter(item => item.answer?.trim() && item.webVerified !== false)
        .map(item => item.question.trim())
        .filter(Boolean),
    ),
  ))
  const questionSamples = buildPenetrationQuestionSamples(successfulQuestionTexts)
  const sampleByQuestion = new Map(
    questionSamples.map(sample => [sample.question.normalize("NFKC").trim().toLowerCase(), sample]),
  )
  const successfulAnswersByModel = new Map<string, number>()
  let successfulAnswerCount = 0
  let totalCitationEvents = 0

  for (const [model, items] of Object.entries(penetration.byModel) as Array<[ModelKey, NonNullable<PenetrationResult["byModel"][ModelKey]>]>) {
    for (const item of items || []) {
      const sources = validSources(item.searchSources)
      if (!item.answer?.trim() || sources.length === 0 || item.webVerified === false) continue

      successfulAnswerCount += 1
      successfulAnswersByModel.set(model, (successfulAnswersByModel.get(model) || 0) + 1)
      const hitPlatforms = new Set<string>()
      const questionSample = sampleByQuestion.get(
        item.question.normalize("NFKC").trim().toLowerCase(),
      )

      for (const source of sources) {
        const domain = normalizeSourceDomain(source.normalizedUrl)
        if (!domain || domain === "unknown") continue
        const definition = classifySourcePlatform(domain, officialDomain)
        let aggregate = platformMap.get(definition.key)
        if (!aggregate) {
          aggregate = {
            definition,
            domains: new Set<string>(),
            answerHits: 0,
            citationEvents: 0,
            uniqueUrls: new Set<string>(),
            models: new Set<string>(),
            questions: new Set<string>(),
            intents: new Set<string>(),
            categories: new Set<string>(),
            evidence: [],
            evidenceKeys: new Set<string>(),
            modelAnswerHits: new Map<string, number>(),
          }
          platformMap.set(definition.key, aggregate)
        }

        aggregate.domains.add(domain)
        aggregate.citationEvents += 1
        aggregate.uniqueUrls.add(source.normalizedUrl)
        aggregate.models.add(model)
        if (item.question?.trim()) aggregate.questions.add(item.question.trim())
        if (questionSample) {
          aggregate.intents.add(questionSample.intentId)
          aggregate.categories.add(questionSample.category)
        }
        totalCitationEvents += 1

        const evidenceKey = `${model}::${item.sampleId || item.sampledAt || item.question}::${source.normalizedUrl}`
        if (!aggregate.evidenceKeys.has(evidenceKey)) {
          aggregate.evidenceKeys.add(evidenceKey)
          aggregate.evidence.push({
            title: String(source.title || domain).trim() || domain,
            url: source.normalizedUrl,
            domain,
            model,
            question: String(item.question || "").trim(),
            sample_id: item.sampleId,
          })
        }
        hitPlatforms.add(definition.key)
      }

      for (const platformKey of hitPlatforms) {
        const aggregate = platformMap.get(platformKey)
        if (!aggregate) continue
        aggregate.answerHits += 1
        aggregate.modelAnswerHits.set(model, (aggregate.modelAnswerHits.get(model) || 0) + 1)
      }
    }
  }

  const platforms: SourcePlatformEvidence[] = Array.from(platformMap.entries()).map(([platformKey, aggregate]) => {
    const balancedRates = Array.from(successfulAnswersByModel.entries()).map(([model, total]) =>
      total > 0 ? (aggregate.modelAnswerHits.get(model) || 0) / total : 0,
    )
    return {
      platform_key: platformKey,
      platform: aggregate.definition.name,
      category: aggregate.definition.category,
      domains: Array.from(aggregate.domains).sort(),
      answer_hits: aggregate.answerHits,
      citation_events: aggregate.citationEvents,
      unique_url_count: aggregate.uniqueUrls.size,
      adoption_rate: successfulAnswerCount > 0
        ? Number(((aggregate.answerHits / successfulAnswerCount) * 100).toFixed(1))
        : 0,
      citation_share: totalCitationEvents > 0
        ? Number(((aggregate.citationEvents / totalCitationEvents) * 100).toFixed(1))
        : 0,
      balanced_adoption_rate: balancedRates.length > 0
        ? Number(((balancedRates.reduce((sum, rate) => sum + rate, 0) / balancedRates.length) * 100).toFixed(1))
        : 0,
      model_keys: Array.from(aggregate.models).sort(),
      question_count: aggregate.questions.size,
      intent_count: aggregate.intents.size,
      category_count: aggregate.categories.size,
      intent_adoption_rate: questionSamples.length > 0
        ? Number(((aggregate.intents.size / new Set(questionSamples.map(item => item.intentId)).size) * 100).toFixed(1))
        : 0,
      evidence: aggregate.evidence,
    }
  }).sort((a, b) =>
    b.adoption_rate - a.adoption_rate
      || b.model_keys.length - a.model_keys.length
      || b.citation_events - a.citation_events
      || a.platform.localeCompare(b.platform, "zh-CN"),
  )

  const sourceDiversity = penetration.aggregated.sampleQuality?.sourceDiversity
    || computePenetrationSourceDiversity(penetration.byModel)
  return {
    penetration_generated_at: penetration.generatedAt,
    calculated_at: calculatedAt,
    successful_answer_count: successfulAnswerCount,
    successful_model_count: successfulAnswersByModel.size,
    total_citation_events: totalCitationEvents,
    distinct_question_count: successfulQuestionTexts.length,
    semantic_intent_count: new Set(questionSamples.map(sample => sample.intentId)).size,
    unique_url_count: sourceDiversity.uniqueUrlCount,
    unique_domain_count: sourceDiversity.uniqueDomainCount,
    duplicate_citation_rate: sourceDiversity.duplicateCitationRate,
    sample_confidence: penetration.aggregated.sampleQuality?.confidence,
    platforms,
  }
}

export function compactSourcePlatformSnapshot(
  snapshot: SourcePlatformSnapshot,
  evidenceLimitPerPlatform = 20,
): SourcePlatformSnapshot {
  return {
    ...snapshot,
    platforms: snapshot.platforms.map(platform => ({
      ...platform,
      evidence: platform.evidence.slice(0, evidenceLimitPerPlatform),
    })),
  }
}

export function sourcePlatformPromptContext(snapshot?: SourcePlatformSnapshot): Array<Record<string, unknown>> {
  return (snapshot?.platforms || []).map(platform => ({
    platform_key: platform.platform_key,
    platform: platform.platform,
    category: platform.category,
    domains: platform.domains,
    adoption_rate: platform.adoption_rate,
    answer_hits: platform.answer_hits,
    citation_events: platform.citation_events,
    unique_url_count: platform.unique_url_count,
    model_coverage: platform.model_keys.length,
    question_coverage: platform.question_count,
    intent_coverage: platform.intent_count,
    category_coverage: platform.category_count,
    intent_adoption_rate: platform.intent_adoption_rate,
  }))
}

const CONTENT_CATEGORIES = new Set<SourcePlatformCategory>(["self_media", "industry_vertical"])
const AUTHORITY_CATEGORIES = new Set<SourcePlatformCategory>(["authority_media", "government_association"])

function inferredPlanCategory(item: MediaPlanItem): SourcePlatformCategory {
  if (item.platform_type && SOURCE_PLATFORM_CATEGORIES.has(item.platform_type)) return item.platform_type
  return resolveSourcePlatformDefinitionByName(item.platform)?.category || "self_media"
}

function planItemMatchesPlatform(item: MediaPlanItem, platform: SourcePlatformEvidence): boolean {
  if (item.platform_key && item.platform_key === platform.platform_key) return true
  const definition = resolveSourcePlatformDefinitionByName(item.platform)
  if (definition?.key === platform.platform_key) return true
  return normalizePlatformName(item.platform) === normalizePlatformName(platform.platform)
}

function attachEvidence(item: MediaPlanItem, platform: SourcePlatformEvidence): MediaPlanItem {
  return {
    ...item,
    platform: platform.platform,
    platform_key: platform.platform_key,
    platform_type: platform.category,
    source_origin: "penetration_detected",
    evidence_domains: platform.domains,
    answer_hits: platform.answer_hits,
    citation_events: platform.citation_events,
    adoption_rate: platform.adoption_rate,
    model_coverage: platform.model_keys.length,
    question_coverage: platform.question_count,
  }
}

function fallbackPlanItem(platform: SourcePlatformEvidence, plan: GeoStrategyPlan): MediaPlanItem {
  const keywords = (plan.keyword_strategy?.core_keywords || [])
    .map(item => item.keyword?.trim())
    .filter(Boolean)
    .slice(0, 3)
  const keywordFocus = keywords.join("、") || plan.profile?.industry || "行业核心问题"
  const brand = plan.profile?.brand_or_product || plan.project_name || "目标品牌"
  const industry = plan.profile?.industry || "行业"
  const authority = AUTHORITY_CATEGORIES.has(platform.category)

  return attachEvidence({
    platform: platform.platform,
    platform_key: platform.platform_key,
    platform_type: platform.category,
    source_origin: "penetration_detected",
    role: authority
      ? platform.category === "government_association"
        ? "围绕政策、标准、资质与公共信息建立可核验的权威引用，不作为自助发文渠道"
        : "通过新闻稿、采访、案例报道或数据报告建立权威第三方背书"
      : platform.category === "industry_vertical"
        ? "围绕垂直场景发布选型、案例、测评与问题解决内容，进入行业平台信源池"
        : "复用已被模型采信的话题结构，持续发布可检索的问答、对比与案例内容",
    keyword_focus: keywordFocus,
    sample_title: authority
      ? `${industry}实践观察：${brand}如何形成可验证的专业能力`
      : `${industry}怎么选？从真实场景看${brand}的关键能力`,
    cadence: authority ? "每月1-2篇重点稿件" : "每周2-3篇，按月复测采信率",
  }, platform)
}

function normalizeRecommendedItem(item: MediaPlanItem): MediaPlanItem {
  const definition = resolveSourcePlatformDefinitionByName(item.platform)
  return {
    ...item,
    platform_key: item.platform_key || definition?.key,
    platform_type: inferredPlanCategory(item),
    source_origin: item.source_origin === "penetration_detected" ? "penetration_detected" : "system_recommended",
  }
}

export function linkStrategyToSourcePlatforms(
  plan: GeoStrategyPlan,
  snapshot?: SourcePlatformSnapshot,
): GeoStrategyPlan {
  if (!snapshot?.platforms.length) return plan

  const contentDetected = snapshot.platforms.filter(platform => CONTENT_CATEGORIES.has(platform.category))
  const authorityDetected = snapshot.platforms.filter(platform => AUTHORITY_CATEGORIES.has(platform.category))
  const rawMedia = Array.isArray(plan.media_plan) ? plan.media_plan : []
  const rawAuthority = Array.isArray(plan.authority_media_plan) ? plan.authority_media_plan : []

  const mediaPlan: MediaPlanItem[] = []
  const authorityPlan: MediaPlanItem[] = []

  for (const item of [...rawMedia, ...rawAuthority]) {
    const matched = snapshot.platforms.find(platform => planItemMatchesPlatform(item, platform))
    const next = matched ? attachEvidence(item, matched) : normalizeRecommendedItem(item)
    const target = AUTHORITY_CATEGORIES.has(next.platform_type || "other") ? authorityPlan : mediaPlan
    if (!target.some(existing => (existing.platform_key || normalizePlatformName(existing.platform)) === (next.platform_key || normalizePlatformName(next.platform)))) {
      target.push(next)
    }
  }

  for (const platform of contentDetected) {
    const index = mediaPlan.findIndex(item => planItemMatchesPlatform(item, platform))
    if (index >= 0) mediaPlan[index] = attachEvidence(mediaPlan[index], platform)
    else mediaPlan.push(fallbackPlanItem(platform, plan))
  }

  for (const platform of authorityDetected) {
    const index = authorityPlan.findIndex(item => planItemMatchesPlatform(item, platform))
    if (index >= 0) authorityPlan[index] = attachEvidence(authorityPlan[index], platform)
    else authorityPlan.push(fallbackPlanItem(platform, plan))
  }

  const detectedFirst = (a: MediaPlanItem, b: MediaPlanItem) => {
    const originDelta = Number(b.source_origin === "penetration_detected") - Number(a.source_origin === "penetration_detected")
    if (originDelta !== 0) return originDelta
    return (b.adoption_rate || 0) - (a.adoption_rate || 0)
  }

  return {
    ...plan,
    media_plan: mediaPlan.sort(detectedFirst),
    authority_media_plan: authorityPlan.sort(detectedFirst),
    source_platform_snapshot: compactSourcePlatformSnapshot(snapshot),
  }
}
