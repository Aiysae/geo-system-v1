import type {
  ClientKnowledgeBase,
  GeoEvidenceLevel,
  GeoKnowledgeAsset,
  GeoKnowledgeAssetKind,
  GeoKnowledgeAssetStatus,
  GeoKnowledgeClaim,
  GeoKnowledgeEntity,
  GeoKnowledgeEntityType,
  GeoKnowledgeSource,
  GeoKnowledgeSourceKind,
  GeoArticleFormatKey,
} from "@/types/geo-methodology"
import type { AnalysisSubjectType } from "@/types"
import type { ExtractedItem, ExtractedProfile } from "@/types/geo-strategy"

const ASSET_KINDS = new Set<GeoKnowledgeAssetKind>([
  "identity",
  "product",
  "service",
  "advantage",
  "credential",
  "report",
  "case",
  "quote",
  "pricing",
  "media",
  "competitor",
  "boundary",
  "other",
])
const EVIDENCE_LEVELS = new Set<GeoEvidenceLevel>([
  "official",
  "primary",
  "verifiedThirdParty",
  "ownedRecord",
  "context",
])
const ASSET_STATUSES = new Set<GeoKnowledgeAssetStatus>([
  "provided",
  "sourceLinked",
  "reviewed",
  "pendingReview",
  "verified",
  "conflicted",
  "expired",
  "archived",
])
const SOURCE_KINDS = new Set<GeoKnowledgeSourceKind>([
  "userFile",
  "officialWebsite",
  "officialRegistry",
  "media",
  "platform",
  "internal",
  "other",
])
const ENTITY_TYPES = new Set<GeoKnowledgeEntityType>([
  "brand",
  "person",
  "company",
  "product",
  "service",
  "organization",
  "location",
  "other",
])

function clean(value: unknown, max = 4_000): string {
  return String(value ?? "").trim().slice(0, max)
}

function list(value: unknown, maxItems = 200, maxLength = 1_000): string[] {
  const source = Array.isArray(value)
    ? value
    : String(value ?? "").split(/\r?\n|[,，、；;]/)
  const seen = new Set<string>()
  const output: string[] = []
  for (const raw of source) {
    const item = clean(raw, maxLength)
    const key = item.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, "")
    if (!item || seen.has(key)) continue
    seen.add(key)
    output.push(item)
    if (output.length >= maxItems) break
  }
  return output
}

function safeId(value: unknown, fallback: string): string {
  const id = clean(value, 140).replace(/[^A-Za-z0-9_-]/g, "_")
  return id || fallback
}

function stableId(prefix: string, value: string): string {
  let hash = 2166136261
  const source = value.normalize("NFKC").toLocaleLowerCase("zh-CN")
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${prefix}_${(hash >>> 0).toString(16)}`
}

function normalizeAsset(value: unknown, index: number, now: string): GeoKnowledgeAsset | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const title = clean(input.title, 300)
  const content = clean(input.content, 12_000)
  if (!title && !content) return null
  const sourceUrls = list(input.sourceUrls, 30, 2_000).filter(url => /^https?:\/\//i.test(url))
  const rawKind = clean(input.kind, 80) as GeoKnowledgeAssetKind
  const rawEvidence = clean(input.evidenceLevel, 80) as GeoEvidenceLevel
  const rawStatus = clean(input.status, 80) as GeoKnowledgeAssetStatus
  return {
    id: safeId(input.id, `asset_${index + 1}`),
    kind: ASSET_KINDS.has(rawKind) ? rawKind : "other",
    title: title || content.slice(0, 80),
    content,
    evidenceLevel: EVIDENCE_LEVELS.has(rawEvidence)
      ? rawEvidence
      : sourceUrls.length > 0
        ? "verifiedThirdParty"
        : "context",
    status: ASSET_STATUSES.has(rawStatus)
      ? rawStatus
      : sourceUrls.length > 0
        ? "sourceLinked"
        : "provided",
    sourceUrls,
    tags: list(input.tags, 30, 120),
    aliases: list(input.aliases, 30, 160),
    subjectName: clean(input.subjectName, 200) || undefined,
    occurredAt: clean(input.occurredAt, 80) || undefined,
    sourceFileName: clean(input.sourceFileName, 300) || undefined,
    sourceLocator: clean(input.sourceLocator, 300) || undefined,
    importJobId: clean(input.importJobId, 160) || undefined,
    updatedAt: validIso(input.updatedAt) || now,
  }
}

function validIso(value: unknown): string | null {
  const timestamp = typeof value === "string" ? Date.parse(value) : Number.NaN
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function normalizeSource(value: unknown, index: number, now: string): GeoKnowledgeSource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const url = clean(input.url, 2_000)
  const fileName = clean(input.fileName, 500)
  const title = clean(input.title, 500) || fileName || url
  if (!title) return null
  const rawKind = clean(input.kind, 80) as GeoKnowledgeSourceKind
  return {
    id: safeId(input.id, stableId("source", url || `${title}:${index}`)),
    title,
    kind: SOURCE_KINDS.has(rawKind) ? rawKind : url ? "other" : "userFile",
    url: /^https?:\/\//i.test(url) ? url : undefined,
    fileName: fileName || undefined,
    contentHash: clean(input.contentHash, 200) || undefined,
    publisher: clean(input.publisher, 300) || undefined,
    publishedAt: validIso(input.publishedAt) || undefined,
    retrievedAt: validIso(input.retrievedAt) || undefined,
    updatedAt: validIso(input.updatedAt) || now,
  }
}

function normalizeEntity(value: unknown, index: number, now: string): GeoKnowledgeEntity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const name = clean(input.name, 300)
  if (!name) return null
  const rawType = clean(input.type, 80) as GeoKnowledgeEntityType
  const relationships = Array.isArray(input.relationships)
    ? input.relationships.flatMap(item => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return []
        const relation = item as Record<string, unknown>
        const predicate = clean(relation.predicate, 120)
        const targetEntityId = safeId(relation.targetEntityId, "")
        return predicate && targetEntityId ? [{ predicate, targetEntityId }] : []
      }).slice(0, 200)
    : []
  return {
    id: safeId(input.id, stableId("entity", `${rawType}:${name}:${index}`)),
    type: ENTITY_TYPES.has(rawType) ? rawType : "other",
    name,
    aliases: list(input.aliases, 100, 200),
    relationships,
    updatedAt: validIso(input.updatedAt) || now,
  }
}

function normalizedClaimKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, "").slice(0, 1_000)
}

function normalizeClaim(value: unknown, index: number, now: string): GeoKnowledgeClaim | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const statement = clean(input.statement, 12_000)
  if (!statement) return null
  const rawKind = clean(input.kind, 80) as GeoKnowledgeAssetKind
  const rawEvidence = clean(input.evidenceLevel, 80) as GeoEvidenceLevel
  const rawStatus = clean(input.status, 80) as GeoKnowledgeAssetStatus
  const assetId = safeId(input.assetId, "") || undefined
  return {
    id: safeId(input.id, stableId("claim", `${assetId || index}:${statement}`)),
    assetId,
    subjectName: clean(input.subjectName, 300),
    kind: ASSET_KINDS.has(rawKind) ? rawKind : "other",
    statement,
    normalizedKey: clean(input.normalizedKey, 1_000) || normalizedClaimKey(statement),
    evidenceLevel: EVIDENCE_LEVELS.has(rawEvidence) ? rawEvidence : "context",
    status: ASSET_STATUSES.has(rawStatus) ? rawStatus : "provided",
    sourceIds: list(input.sourceIds, 50, 160),
    tags: list(input.tags, 50, 160),
    validFrom: validIso(input.validFrom) || undefined,
    validUntil: validIso(input.validUntil) || undefined,
    updatedAt: validIso(input.updatedAt) || now,
  }
}

export function emptyClientKnowledgeBase(args: {
  subjectType: AnalysisSubjectType
  subjectName?: string
  aliases?: string[]
}): ClientKnowledgeBase {
  const now = new Date().toISOString()
  const subjectName = clean(args.subjectName, 200)
  const aliases = list(args.aliases, 100, 200)
  return {
    schemaVersion: 2,
    revision: 1,
    subjectType: args.subjectType,
    subjectName,
    aliases,
    summary: "",
    products: [],
    services: [],
    audiences: [],
    regions: [],
    boundaries: [],
    entities: subjectName ? [{
      id: stableId("entity", `${args.subjectType}:${subjectName}`),
      type: args.subjectType,
      name: subjectName,
      aliases,
      relationships: [],
      updatedAt: now,
    }] : [],
    claims: [],
    sources: [],
    assets: [],
    updatedAt: now,
  }
}

export function normalizeClientKnowledgeBase(
  value: unknown,
  fallback: {
    subjectType: AnalysisSubjectType
    subjectName?: string
    aliases?: string[]
  },
): ClientKnowledgeBase {
  const now = new Date().toISOString()
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const subjectType = input.subjectType === "person" || fallback.subjectType === "person"
    ? "person"
    : "brand"
  const assets = Array.isArray(input.assets)
    ? input.assets
        .slice(0, 1_000)
        .map((asset, index) => normalizeAsset(asset, index, now))
        .filter((asset): asset is GeoKnowledgeAsset => Boolean(asset))
    : []
  const sources = Array.isArray(input.sources)
    ? input.sources
        .slice(0, 2_000)
        .map((source, index) => normalizeSource(source, index, now))
        .filter((source): source is GeoKnowledgeSource => Boolean(source))
    : []
  const sourceMap = new Map(sources.map(source => [source.id, source]))
  const existingSourceByUrl = new Map(
    sources.filter(source => source.url).map(source => [source.url as string, source.id]),
  )
  for (const asset of assets) {
    for (const url of asset.sourceUrls) {
      if (existingSourceByUrl.has(url)) continue
      const id = stableId("source", url)
      if (!sourceMap.has(id)) {
        sourceMap.set(id, {
          id,
          title: url,
          kind: "other",
          url,
          retrievedAt: asset.updatedAt,
          updatedAt: asset.updatedAt,
        })
        existingSourceByUrl.set(url, id)
      }
    }
  }
  const urlSourceIds = new Map(
    [...sourceMap.values()].filter(source => source.url).map(source => [source.url as string, source.id]),
  )
  const assetIds = new Set(assets.map(asset => asset.id))
  const claims = Array.isArray(input.claims)
    ? input.claims
        .slice(0, 2_000)
        .map((claim, index) => normalizeClaim(claim, index, now))
        .filter((claim): claim is GeoKnowledgeClaim => Boolean(claim))
        .filter(claim => !claim.assetId || assetIds.has(claim.assetId))
    : []
  const claimMap = new Map(claims.map(claim => [claim.assetId || claim.normalizedKey, claim]))
  for (const asset of assets) {
    const existing = claimMap.get(asset.id)
    const claim: GeoKnowledgeClaim = {
      ...existing,
      id: existing?.id || stableId("claim", `${asset.id}:${asset.content}`),
      assetId: asset.id,
      subjectName: asset.subjectName || clean(input.subjectName, 300) || clean(fallback.subjectName, 300),
      kind: asset.kind,
      statement: asset.content || asset.title,
      normalizedKey: normalizedClaimKey(asset.content || asset.title),
      evidenceLevel: asset.evidenceLevel,
      status: asset.status,
      sourceIds: asset.sourceUrls.map(url => urlSourceIds.get(url)).filter((id): id is string => Boolean(id)),
      tags: asset.tags,
      updatedAt: asset.updatedAt,
    }
    claimMap.set(asset.id, claim)
  }
  const subjectName = clean(input.subjectName, 200) || clean(fallback.subjectName, 200)
  const aliases = list(input.aliases, 100, 200).length > 0
    ? list(input.aliases, 100, 200)
    : list(fallback.aliases, 100, 200)
  const entities = Array.isArray(input.entities)
    ? input.entities
        .slice(0, 1_000)
        .map((entity, index) => normalizeEntity(entity, index, now))
        .filter((entity): entity is GeoKnowledgeEntity => Boolean(entity))
    : []
  if (subjectName && !entities.some(entity => normalizedClaimKey(entity.name) === normalizedClaimKey(subjectName))) {
    entities.unshift({
      id: stableId("entity", `${subjectType}:${subjectName}`),
      type: subjectType,
      name: subjectName,
      aliases,
      relationships: [],
      updatedAt: now,
    })
  }
  return {
    schemaVersion: 2,
    revision: Math.max(1, Math.floor(Number(input.revision) || 1)),
    subjectType,
    subjectName,
    aliases,
    summary: clean(input.summary, 8_000),
    products: list(input.products, 200, 1_000),
    services: list(input.services, 200, 1_000),
    audiences: list(input.audiences, 100, 500),
    regions: list(input.regions, 100, 300),
    boundaries: list(input.boundaries, 200, 1_000),
    entities,
    claims: [...claimMap.values()],
    sources: [...sourceMap.values()],
    assets,
    updatedAt: validIso(input.updatedAt) || now,
  }
}

function generatedAssetId(kind: GeoKnowledgeAssetKind, text: string): string {
  let hash = 2166136261
  const source = `${kind}:${text.normalize("NFKC").toLocaleLowerCase("zh-CN")}`
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `asset_${kind}_${(hash >>> 0).toString(16)}`
}

function itemTexts(value: ExtractedItem[] | undefined): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(item => item && typeof item === "object" && item.enabled !== false)
    .map(item => clean(item.text, 4_000))
    .filter(Boolean)
}

export function mergeExtractedProfileIntoKnowledgeBase(args: {
  current?: ClientKnowledgeBase
  profile: ExtractedProfile
  subjectType: AnalysisSubjectType
  subjectName: string
  aliases?: string[]
  updatedAt?: string
}): ClientKnowledgeBase {
  const current = normalizeClientKnowledgeBase(args.current, {
    subjectType: args.subjectType,
    subjectName: args.subjectName,
    aliases: args.aliases,
  })
  const now = args.updatedAt && Number.isFinite(Date.parse(args.updatedAt))
    ? new Date(args.updatedAt).toISOString()
    : new Date().toISOString()
  const generated: GeoKnowledgeAsset[] = []
  const append = (
    kind: GeoKnowledgeAssetKind,
    values: string[],
    titlePrefix: string,
    evidenceLevel: GeoEvidenceLevel = "context",
  ) => {
    values.forEach((content, index) => {
      generated.push({
        id: generatedAssetId(kind, content),
        kind,
        title: values.length > 1 ? `${titlePrefix} ${index + 1}` : titlePrefix,
        content,
        evidenceLevel,
        status: "provided",
        sourceUrls: [],
        tags: [args.profile.industry, kind].filter(Boolean),
        subjectName: args.subjectName,
        updatedAt: now,
      })
    })
  }
  append("advantage", itemTexts(args.profile.advantages), "核心优势", "primary")
  append("competitor", itemTexts(args.profile.competitors), "竞争主体")
  append("boundary", itemTexts(args.profile.weaknesses), "待改善事项")
  append("service", itemTexts(args.profile.scenes), "应用场景")
  append("other", itemTexts(args.profile.pain_points), "用户痛点")
  if (args.profile.product_description) {
    append("product", [args.profile.product_description], "产品与服务说明", "primary")
  }
  for (const [index, source] of (args.profile.knowledge_assets || []).entries()) {
    const content = clean(source.content, 12_000)
    const title = clean(source.title, 300) || content.slice(0, 80)
    if (!title && !content) continue
    const sourceUrls = list(source.source_urls, 30, 2_000)
      .filter(url => /^https?:\/\//i.test(url))
    generated.push({
      id: generatedAssetId(source.kind || "other", `${title}:${content}`),
      kind: ASSET_KINDS.has(source.kind) ? source.kind : "other",
      title: title || `资料 ${index + 1}`,
      content,
      evidenceLevel: EVIDENCE_LEVELS.has(source.evidence_level)
        ? source.evidence_level
        : sourceUrls.length > 0
          ? "verifiedThirdParty"
          : "primary",
      status: sourceUrls.length > 0 ? "sourceLinked" : "provided",
      sourceUrls,
      tags: list(source.tags, 30, 120),
      subjectName: args.subjectName,
      occurredAt: clean(source.occurred_at, 80) || undefined,
      sourceFileName: clean(source.source_file, 300) || undefined,
      sourceLocator: clean(source.source_locator, 300) || undefined,
      updatedAt: now,
    })
  }

  const assets = new Map(current.assets.map(asset => [asset.id, asset]))
  for (const asset of generated) {
    const existing = assets.get(asset.id)
    assets.set(asset.id, existing ? { ...asset, ...existing, updatedAt: now } : asset)
  }

  const merged = {
    ...current,
    subjectType: args.subjectType,
    subjectName: args.subjectName || current.subjectName,
    aliases: list([...current.aliases, ...(args.aliases || [])], 100, 200),
    summary: args.profile.product_description || current.summary,
    services: list([
      ...current.services,
      ...itemTexts(args.profile.scenes),
    ], 200, 1_000),
    audiences: list([...current.audiences, args.profile.audience], 100, 500),
    assets: [...assets.values()],
    revision: current.revision + 1,
    updatedAt: now,
  }
  return normalizeClientKnowledgeBase(merged, {
    subjectType: args.subjectType,
    subjectName: args.subjectName,
    aliases: args.aliases,
  })
}

function tokenSet(value: string): Set<string> {
  const source = value.normalize("NFKC").toLocaleLowerCase("zh-CN")
  const normalized = source.replace(/[^\u4e00-\u9fa5a-z0-9]+/gi, "")
  const tokens = new Set<string>()
  for (const word of source.split(/[^\u4e00-\u9fa5a-z0-9]+/gi)) {
    if (word.length > 1) tokens.add(word)
  }
  if (normalized.length === 1) tokens.add(normalized)
  for (let index = 0; index < normalized.length - 1; index += 1) {
    tokens.add(normalized.slice(index, index + 2))
  }
  return tokens
}

export const KNOWLEDGE_RETRIEVAL_VERSION = "shitu-knowledge-retrieval-v3"

export interface KnowledgeRetrievalPolicy {
  version: typeof KNOWLEDGE_RETRIEVAL_VERSION
  limit: number
  maxContextChars: number
  maxAssetChars: number
  minimumSemanticScore: number
  allowCompetitors: boolean
  kindCaps: Partial<Record<GeoKnowledgeAssetKind, number>>
}

export interface KnowledgeSelectionResult {
  assets: GeoKnowledgeAsset[]
  policy: KnowledgeRetrievalPolicy
  candidateCount: number
  estimatedContextChars: number
}

const COMPARISON_FORMATS = new Set<GeoArticleFormatKey>([
  "recommendationRoundup",
  "fieldReviewQa",
  "tieredEvaluation",
  "neutralComparisonReview",
])

export function knowledgeRetrievalPolicy(args: {
  articleFormat?: GeoArticleFormatKey
  allowCompetitors?: boolean
} = {}): KnowledgeRetrievalPolicy {
  const articleFormat = args.articleFormat || "directAnswerGuide"
  const isWhitepaper = articleFormat === "industryWhitepaper"
  const isEvidenceHeavy = [
    "primaryEvidenceDossier",
    "evidenceCaseStory",
    "entityKnowledgeProfile",
    ...COMPARISON_FORMATS,
  ].includes(articleFormat)
  const limit = isWhitepaper ? 10 : isEvidenceHeavy ? 8 : 5
  return {
    version: KNOWLEDGE_RETRIEVAL_VERSION,
    limit,
    maxContextChars: isWhitepaper ? 7_000 : isEvidenceHeavy ? 5_000 : 2_800,
    maxAssetChars: isWhitepaper ? 1_600 : isEvidenceHeavy ? 1_200 : 900,
    minimumSemanticScore: 2,
    allowCompetitors: args.allowCompetitors === true && COMPARISON_FORMATS.has(articleFormat),
    kindCaps: {
      identity: 1,
      product: 2,
      service: 2,
      advantage: 2,
      credential: 2,
      report: 2,
      case: 2,
      quote: 1,
      pricing: 1,
      media: 1,
      competitor: COMPARISON_FORMATS.has(articleFormat) ? 4 : 0,
      boundary: 1,
      other: 1,
    },
  }
}

function semanticOverlapScore(asset: GeoKnowledgeAsset, queryTokens: Set<string>): number {
  const titleTokens = tokenSet(asset.title)
  const bodyTokens = tokenSet([
    asset.content,
    asset.tags.join(" "),
    ...(asset.aliases || []),
  ].join(" "))
  let score = 0
  for (const token of queryTokens) {
    if (titleTokens.has(token)) score += 3
    if (bodyTokens.has(token)) score += 1
  }
  if (/(?:与.{0,30})?(?:无关|不相关|不适用|不属于当前)/.test(`${asset.title}\n${asset.content}`)) {
    score -= 12
  }
  return score
}

function normalizedSubject(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[^\u4e00-\u9fa5a-z0-9]+/gi, "")
}

function belongsToKnowledgeSubject(
  asset: GeoKnowledgeAsset,
  knowledgeBase: ClientKnowledgeBase,
): boolean {
  if (!asset.subjectName) return true
  const allowed = new Set([
    knowledgeBase.subjectName,
    ...knowledgeBase.aliases,
  ].map(normalizedSubject).filter(Boolean))
  return allowed.has(normalizedSubject(asset.subjectName))
}

function assetContextCost(asset: GeoKnowledgeAsset, maxAssetChars: number): number {
  return asset.title.length
    + Math.min(asset.content.length, maxAssetChars)
    + asset.tags.join("").length
    + asset.sourceUrls.join("").length
    + 180
}

function overlapScore(
  asset: GeoKnowledgeAsset,
  queryTokens: Set<string>,
  subjectTerms: Set<string>,
): number {
  const titleTokens = tokenSet(asset.title)
  const bodyTokens = tokenSet([asset.content, asset.tags.join(" "), ...(asset.aliases || [])].join(" "))
  let score = 0
  for (const token of queryTokens) {
    if (titleTokens.has(token)) score += 3
    if (bodyTokens.has(token)) score += 1
  }
  for (const token of subjectTerms) {
    if (titleTokens.has(token) || bodyTokens.has(token)) score += 1.5
  }
  const evidenceBoost: Record<GeoEvidenceLevel, number> = {
    official: 12,
    primary: 10,
    verifiedThirdParty: 9,
    ownedRecord: 7,
    context: 2,
  }
  const statusBoost: Record<GeoKnowledgeAssetStatus, number> = {
    verified: 8,
    reviewed: 7,
    sourceLinked: 5,
    provided: 3,
    pendingReview: -6,
    conflicted: -30,
    expired: -30,
    archived: -30,
  }
  const age = Date.now() - Date.parse(asset.updatedAt)
  const freshnessBoost = Number.isFinite(age) && age < 180 * 24 * 60 * 60 * 1_000 ? 2 : 0
  return score
    + evidenceBoost[asset.evidenceLevel]
    + statusBoost[asset.status]
    + (asset.sourceUrls.length > 0 ? 4 : 0)
    + freshnessBoost
}

export function selectKnowledgeAssets(args: {
  knowledgeBase?: ClientKnowledgeBase
  query: string
  preferredKinds?: GeoKnowledgeAssetKind[]
  assetIds?: string[]
  limit?: number
  articleFormat?: GeoArticleFormatKey
  allowCompetitors?: boolean
}): GeoKnowledgeAsset[] {
  return selectKnowledgeAssetsWithTrace(args).assets
}

export function selectKnowledgeAssetsWithTrace(args: {
  knowledgeBase?: ClientKnowledgeBase
  query: string
  preferredKinds?: GeoKnowledgeAssetKind[]
  assetIds?: string[]
  limit?: number
  articleFormat?: GeoArticleFormatKey
  allowCompetitors?: boolean
}): KnowledgeSelectionResult {
  const policy = knowledgeRetrievalPolicy({
    articleFormat: args.articleFormat,
    allowCompetitors: args.allowCompetitors,
  })
  if (!args.knowledgeBase) {
    return { assets: [], policy, candidateCount: 0, estimatedContextChars: 0 }
  }
  const queryTokens = tokenSet(args.query)
  const preferred = new Set(args.preferredKinds || [])
  const requestedIds = new Set(args.assetIds || [])
  const subjectTerms = tokenSet([
    args.knowledgeBase.subjectName,
    ...args.knowledgeBase.aliases,
  ].join(" "))
  const limit = Math.max(1, Math.min(30, args.limit || policy.limit))
  const ranked = args.knowledgeBase.assets
    .filter(asset => !["archived", "expired", "conflicted", "pendingReview"].includes(asset.status))
    .filter(asset => asset.kind !== "competitor" || policy.allowCompetitors)
    .filter(asset => asset.kind === "competitor"
      || belongsToKnowledgeSubject(asset, args.knowledgeBase as ClientKnowledgeBase))
    .map(asset => {
      const semanticScore = semanticOverlapScore(asset, queryTokens)
      return {
        asset,
        semanticScore,
        score: semanticScore * 4
          + overlapScore(asset, queryTokens, subjectTerms)
          + (preferred.has(asset.kind) ? 12 : 0)
          + (requestedIds.has(asset.id) ? 100 : 0),
      }
    })
    .filter(item => requestedIds.has(item.asset.id)
      || item.semanticScore >= policy.minimumSemanticScore
      || ["identity", "boundary"].includes(item.asset.kind))
    .sort((left, right) => right.score - left.score || left.asset.title.localeCompare(right.asset.title, "zh-CN"))
  const selected: GeoKnowledgeAsset[] = []
  const kindCounts = new Map<GeoKnowledgeAssetKind, number>()
  let estimatedContextChars = 0
  for (const item of ranked) {
    const count = kindCounts.get(item.asset.kind) || 0
    const kindCap = policy.kindCaps[item.asset.kind] ?? Math.max(2, Math.ceil(limit / 3))
    if (!requestedIds.has(item.asset.id) && count >= kindCap) continue
    const cost = assetContextCost(item.asset, policy.maxAssetChars)
    if (
      !requestedIds.has(item.asset.id)
      && selected.length > 0
      && estimatedContextChars + cost > policy.maxContextChars
    ) continue
    selected.push(item.asset)
    kindCounts.set(item.asset.kind, count + 1)
    estimatedContextChars += cost
    if (selected.length >= limit) break
  }
  return {
    assets: selected,
    policy,
    candidateCount: ranked.length,
    estimatedContextChars: Math.min(estimatedContextChars, policy.maxContextChars),
  }
}

export function selectKnowledgeAssetsLegacy(args: {
  knowledgeBase?: ClientKnowledgeBase
  query: string
  preferredKinds?: GeoKnowledgeAssetKind[]
  assetIds?: string[]
  limit?: number
}): GeoKnowledgeAsset[] {
  if (!args.knowledgeBase) return []
  const queryTokens = tokenSet(args.query)
  const preferred = new Set(args.preferredKinds || [])
  const requestedIds = new Set(args.assetIds || [])
  const subjectTerms = tokenSet([
    args.knowledgeBase.subjectName,
    ...args.knowledgeBase.aliases,
  ].join(" "))
  const limit = Math.max(1, Math.min(30, args.limit || 12))
  const ranked = args.knowledgeBase.assets
    .filter(asset => !["archived", "expired", "conflicted", "pendingReview"].includes(asset.status))
    .map(asset => ({
      asset,
      score: overlapScore(asset, queryTokens, subjectTerms)
        + (preferred.has(asset.kind) ? 12 : 0)
        + (requestedIds.has(asset.id) ? 100 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.asset.title.localeCompare(right.asset.title, "zh-CN"))
  return ranked.slice(0, limit).map(item => item.asset)
}

export function knowledgeReferencesForAssets(
  knowledgeBase: ClientKnowledgeBase | undefined,
  assets: GeoKnowledgeAsset[],
): { claimIds: string[]; sourceIds: string[] } {
  if (!knowledgeBase || assets.length === 0) return { claimIds: [], sourceIds: [] }
  const assetIds = new Set(assets.map(asset => asset.id))
  const claims = knowledgeBase.claims.filter(claim => claim.assetId && assetIds.has(claim.assetId))
  return {
    claimIds: claims.map(claim => claim.id),
    sourceIds: [...new Set(claims.flatMap(claim => claim.sourceIds))],
  }
}

export function getKnowledgeBaseHealth(knowledgeBase?: ClientKnowledgeBase): {
  total: number
  usable: number
  sourceLinked: number
  verified: number
  pendingReview: number
  conflicted: number
  expired: number
  completion: number
} {
  const assets = knowledgeBase?.assets || []
  const sourceLinked = assets.filter(asset => asset.sourceUrls.length > 0 || ["sourceLinked", "verified"].includes(asset.status)).length
  const verified = assets.filter(asset => ["reviewed", "verified"].includes(asset.status)).length
  const pendingReview = assets.filter(asset => asset.status === "pendingReview").length
  const conflicted = assets.filter(asset => asset.status === "conflicted").length
  const expired = assets.filter(asset => asset.status === "expired").length
  const usable = assets.filter(asset => !["archived", "expired", "conflicted", "pendingReview"].includes(asset.status)).length
  const coverageFields = knowledgeBase ? [
    knowledgeBase.subjectName,
    knowledgeBase.summary,
    knowledgeBase.products.length,
    knowledgeBase.services.length,
    knowledgeBase.audiences.length,
    knowledgeBase.regions.length,
    usable,
    sourceLinked,
  ] : []
  const completion = coverageFields.length > 0
    ? Math.round((coverageFields.filter(Boolean).length / coverageFields.length) * 100)
    : 0
  return { total: assets.length, usable, sourceLinked, verified, pendingReview, conflicted, expired, completion }
}

export function buildKnowledgeContext(
  assets: GeoKnowledgeAsset[],
  knowledgeBase?: ClientKnowledgeBase,
  budget?: Pick<KnowledgeRetrievalPolicy, "maxContextChars" | "maxAssetChars">,
): string {
  if (assets.length === 0) return "本篇未匹配到结构化知识资产，只能使用用户本次明确填写的资料。"
  const claimByAsset = new Map(
    (knowledgeBase?.claims || []).filter(claim => claim.assetId).map(claim => [claim.assetId as string, claim]),
  )
  const sourceById = new Map((knowledgeBase?.sources || []).map(source => [source.id, source]))
  const maxContextChars = Math.max(800, budget?.maxContextChars || 5_000)
  const maxAssetChars = Math.max(300, budget?.maxAssetChars || 1_200)
  const output: Record<string, unknown>[] = []
  for (const asset of assets) {
    const base = {
      assetId: asset.id,
      type: asset.kind,
      title: asset.title,
      evidenceLevel: asset.evidenceLevel,
      reviewStatus: asset.status,
      sourceUrls: asset.sourceUrls.length > 0
        ? asset.sourceUrls
        : (claimByAsset.get(asset.id)?.sourceIds || [])
            .map(id => sourceById.get(id)?.url)
            .filter(Boolean),
      sourceFileName: asset.sourceFileName,
      sourceLocator: asset.sourceLocator,
      occurredAt: asset.occurredAt,
      updatedAt: asset.updatedAt,
    }
    let content = asset.content.slice(0, maxAssetChars)
    let candidate = { ...base, content }
    let serialized = JSON.stringify([...output, candidate], null, 2)
    if (serialized.length > maxContextChars) {
      const overflow = serialized.length - maxContextChars
      content = content.slice(0, Math.max(0, content.length - overflow - 20))
      if (content.length < 40 && output.length > 0) continue
      candidate = { ...base, content }
      serialized = JSON.stringify([...output, candidate], null, 2)
      if (serialized.length > maxContextChars && output.length > 0) continue
    }
    output.push(candidate)
    if (JSON.stringify(output, null, 2).length >= maxContextChars - 80) break
  }
  return JSON.stringify(output, null, 2)
}
