import type {
  ClientKnowledgeBase,
  GeoEvidenceLevel,
  GeoKnowledgeAsset,
  GeoKnowledgeAssetKind,
  GeoKnowledgeAssetStatus,
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
  "archived",
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
    updatedAt: validIso(input.updatedAt) || now,
  }
}

function validIso(value: unknown): string | null {
  const timestamp = typeof value === "string" ? Date.parse(value) : Number.NaN
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

export function emptyClientKnowledgeBase(args: {
  subjectType: AnalysisSubjectType
  subjectName?: string
  aliases?: string[]
}): ClientKnowledgeBase {
  return {
    schemaVersion: 1,
    subjectType: args.subjectType,
    subjectName: clean(args.subjectName, 200),
    aliases: list(args.aliases, 100, 200),
    summary: "",
    products: [],
    services: [],
    audiences: [],
    regions: [],
    boundaries: [],
    assets: [],
    updatedAt: new Date().toISOString(),
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
  return {
    schemaVersion: 1,
    subjectType,
    subjectName: clean(input.subjectName, 200) || clean(fallback.subjectName, 200),
    aliases: list(input.aliases, 100, 200).length > 0
      ? list(input.aliases, 100, 200)
      : list(fallback.aliases, 100, 200),
    summary: clean(input.summary, 8_000),
    products: list(input.products, 200, 1_000),
    services: list(input.services, 200, 1_000),
    audiences: list(input.audiences, 100, 500),
    regions: list(input.regions, 100, 300),
    boundaries: list(input.boundaries, 200, 1_000),
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
}): ClientKnowledgeBase {
  const current = normalizeClientKnowledgeBase(args.current, {
    subjectType: args.subjectType,
    subjectName: args.subjectName,
    aliases: args.aliases,
  })
  const now = new Date().toISOString()
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
      updatedAt: now,
    })
  }

  const assets = new Map(current.assets.map(asset => [asset.id, asset]))
  for (const asset of generated) {
    const existing = assets.get(asset.id)
    assets.set(asset.id, existing ? { ...asset, ...existing, updatedAt: now } : asset)
  }

  return {
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
    updatedAt: now,
  }
}

function tokenSet(value: string): Set<string> {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/gi, "")
  const tokens = new Set<string>()
  for (let index = 0; index < normalized.length - 1; index += 1) {
    tokens.add(normalized.slice(index, index + 2))
  }
  return tokens
}

function overlapScore(asset: GeoKnowledgeAsset, queryTokens: Set<string>): number {
  const source = tokenSet([asset.title, asset.content, asset.tags.join(" ")].join(" "))
  let score = 0
  for (const token of queryTokens) if (source.has(token)) score += 1
  const evidenceBoost: Record<GeoEvidenceLevel, number> = {
    official: 8,
    primary: 7,
    verifiedThirdParty: 6,
    ownedRecord: 5,
    context: 2,
  }
  return score + evidenceBoost[asset.evidenceLevel] + (asset.sourceUrls.length > 0 ? 3 : 0)
}

export function selectKnowledgeAssets(args: {
  knowledgeBase?: ClientKnowledgeBase
  query: string
  preferredKinds?: GeoKnowledgeAssetKind[]
  limit?: number
}): GeoKnowledgeAsset[] {
  if (!args.knowledgeBase) return []
  const queryTokens = tokenSet(args.query)
  const preferred = new Set(args.preferredKinds || [])
  return args.knowledgeBase.assets
    .filter(asset => asset.status !== "archived")
    .map(asset => ({
      asset,
      score: overlapScore(asset, queryTokens) + (preferred.has(asset.kind) ? 10 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.asset.title.localeCompare(right.asset.title, "zh-CN"))
    .slice(0, Math.max(1, Math.min(30, args.limit || 12)))
    .map(item => item.asset)
}

export function buildKnowledgeContext(assets: GeoKnowledgeAsset[]): string {
  if (assets.length === 0) return "本篇未匹配到结构化知识资产，只能使用用户本次明确填写的资料。"
  return JSON.stringify(assets.map(asset => ({
    assetId: asset.id,
    type: asset.kind,
    title: asset.title,
    content: asset.content,
    evidenceLevel: asset.evidenceLevel,
    sourceUrls: asset.sourceUrls,
  })), null, 2)
}
