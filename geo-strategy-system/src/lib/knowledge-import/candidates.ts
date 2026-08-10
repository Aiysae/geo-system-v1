import "server-only"

import { createHash } from "crypto"
import type { ExtractedItem, ExtractedKnowledgeAsset, ExtractedProfile } from "@/types/geo-strategy"
import type {
  ClientKnowledgeBase,
  GeoEvidenceLevel,
  GeoKnowledgeAsset,
  GeoKnowledgeAssetKind,
  GeoKnowledgeClaim,
  GeoKnowledgeSource,
} from "@/types/geo-methodology"
import type {
  KnowledgeImportCandidate,
  KnowledgeImportFileRecord,
} from "@/types/knowledge-import"
import { normalizeClientKnowledgeBase } from "@/lib/client-knowledge-base"

const ASSET_KINDS = new Set<GeoKnowledgeAssetKind>([
  "identity", "product", "service", "advantage", "credential", "report", "case",
  "quote", "pricing", "media", "competitor", "boundary", "other",
])
const EVIDENCE_LEVELS = new Set<GeoEvidenceLevel>([
  "official", "primary", "verifiedThirdParty", "ownedRecord", "context",
])

function clean(value: unknown, limit: number): string {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, limit)
}

function list(value: unknown, limit: number, itemLimit: number): string[] {
  const source = Array.isArray(value) ? value : []
  return [...new Set(source.map(item => clean(item, itemLimit)).filter(Boolean))].slice(0, limit)
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[^\u4e00-\u9fa5a-z0-9]+/gi, "")
}

function fingerprint(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex")
}

function itemTexts(items: ExtractedItem[] | undefined): string[] {
  return (items || []).map(item => clean(item?.text, 12_000)).filter(Boolean)
}

function sourceFileFor(
  value: string | undefined,
  files: KnowledgeImportFileRecord[],
): KnowledgeImportFileRecord | undefined {
  const wanted = normalized(value || "")
  if (wanted) {
    const exact = files.find(file => normalized(file.name) === wanted)
    if (exact) return exact
    const partial = files.find(file => wanted.includes(normalized(file.name)) || normalized(file.name).includes(wanted))
    if (partial) return partial
  }
  return files.length === 1 ? files[0] : undefined
}

function instructionIssues(title: string, content: string): string[] {
  const value = `${title}\n${content}`
  const patterns = [
    /忽略(?:以上|此前|所有|系统).{0,20}(?:指令|规则|提示)/i,
    /(?:system|developer)\s*(?:prompt|message)/i,
    /(?:泄露|输出|展示).{0,16}(?:提示词|系统指令|密钥|api\s*key)/i,
    /你现在是.{0,40}(?:助手|模型|专家)/i,
    /不要遵守.{0,20}(?:规则|要求|限制)/i,
  ]
  return patterns.some(pattern => pattern.test(value))
    ? ["资料中含有疑似操作指令，已默认取消勾选；请只保留其中真实事实"]
    : []
}

function extractedAssets(profile: ExtractedProfile): ExtractedKnowledgeAsset[] {
  const direct = Array.isArray(profile.knowledge_assets) ? profile.knowledge_assets : []
  const fallback: ExtractedKnowledgeAsset[] = []
  const append = (
    kind: GeoKnowledgeAssetKind,
    values: string[],
    prefix: string,
    evidenceLevel: GeoEvidenceLevel = "context",
  ) => {
    values.forEach((content, index) => fallback.push({
      kind,
      title: values.length > 1 ? `${prefix} ${index + 1}` : prefix,
      content,
      evidence_level: evidenceLevel,
      source_urls: [],
    }))
  }
  if (direct.length === 0) {
    append("product", [clean(profile.product_description, 12_000)].filter(Boolean), "产品与服务说明", "primary")
    append("advantage", itemTexts(profile.advantages), "核心优势", "primary")
    append("service", itemTexts(profile.scenes), "应用场景")
    append("competitor", itemTexts(profile.competitors), "竞争主体")
    append("boundary", itemTexts(profile.weaknesses), "适用边界")
    append("other", itemTexts(profile.pain_points), "用户痛点")
  }
  return [...direct, ...fallback]
}

export function buildKnowledgeImportCandidates(input: {
  profile: ExtractedProfile
  files: KnowledgeImportFileRecord[]
  knowledgeBase: ClientKnowledgeBase
  importId: string
}): KnowledgeImportCandidate[] {
  const existingExact = new Map<string, GeoKnowledgeAsset>()
  const existingTopics = new Map<string, GeoKnowledgeAsset[]>()
  for (const asset of input.knowledgeBase.assets) {
    existingExact.set(`${asset.kind}:${normalized(asset.title)}:${normalized(asset.content)}`, asset)
    const topic = `${asset.kind}:${normalized(asset.title)}`
    existingTopics.set(topic, [...(existingTopics.get(topic) || []), asset])
  }
  const allowedSubjects = new Set([
    input.knowledgeBase.subjectName,
    ...input.knowledgeBase.aliases,
  ].map(normalized).filter(Boolean))
  const candidateExact = new Map<string, KnowledgeImportCandidate>()

  return extractedAssets(input.profile).map((raw, index) => {
    const kind = ASSET_KINDS.has(raw.kind) ? raw.kind : "other"
    const content = clean(raw.content, 12_000)
    const title = clean(raw.title, 300) || content.slice(0, 80) || `候选资料 ${index + 1}`
    const sourceFile = sourceFileFor(raw.source_file, input.files)
    const subjectName = clean(raw.subject_name, 300) || input.knowledgeBase.subjectName
    const exactKey = `${kind}:${normalized(title)}:${normalized(content)}`
    const topicKey = `${kind}:${normalized(title)}`
    const duplicateAsset = existingExact.get(exactKey)
    const duplicateCandidate = candidateExact.get(exactKey)
    const conflicts = (existingTopics.get(topicKey) || [])
      .filter(asset => normalized(asset.content) !== normalized(content))
      .map(asset => asset.id)
    const issues = instructionIssues(title, content)
    if (
      kind !== "competitor"
      && subjectName
      && allowedSubjects.size > 0
      && !allowedSubjects.has(normalized(subjectName))
    ) {
      issues.push(`事实归属“${subjectName}”与当前主体不一致，请确认是否属于竞品资料`)
    }
    if (!content) issues.push("资料内容为空")
    const id = `kcand_${fingerprint(input.importId, exactKey, String(index)).slice(0, 24)}`
    const candidate: KnowledgeImportCandidate = {
      id,
      kind,
      title,
      content,
      evidenceLevel: EVIDENCE_LEVELS.has(raw.evidence_level) ? raw.evidence_level : "context",
      status: "pendingReview",
      sourceUrls: list(raw.source_urls, 30, 2_000).filter(url => /^https?:\/\//i.test(url)),
      tags: list(raw.tags, 30, 120),
      occurredAt: clean(raw.occurred_at, 80) || undefined,
      sourceFileName: sourceFile?.name || clean(raw.source_file, 300) || undefined,
      sourceLocator: clean(raw.source_locator, 300) || undefined,
      subjectName,
      duplicateOf: duplicateAsset?.id || duplicateCandidate?.id,
      conflictWith: conflicts.length > 0 ? conflicts : undefined,
      issues: issues.length > 0 ? issues : undefined,
      selected: Boolean(content) && !duplicateAsset && !duplicateCandidate && conflicts.length === 0 && issues.length === 0,
    }
    if (!duplicateCandidate) candidateExact.set(exactKey, candidate)
    return candidate
  }).filter(candidate => candidate.title && candidate.content)
}

function sourceId(prefix: string, value: string): string {
  return `${prefix}_${fingerprint(value).slice(0, 24)}`
}

export function mergeApprovedKnowledgeCandidates(input: {
  knowledgeBase: ClientKnowledgeBase
  candidates: KnowledgeImportCandidate[]
  files: KnowledgeImportFileRecord[]
  importId: string
  subjectName: string
  subjectType: ClientKnowledgeBase["subjectType"]
}): { knowledgeBase: ClientKnowledgeBase; addedCount: number; skippedCount: number } {
  const now = new Date().toISOString()
  const selected = input.candidates.filter(candidate => candidate.selected)
  const assets = input.knowledgeBase.assets.map(asset => ({ ...asset }))
  const sources = new Map(input.knowledgeBase.sources.map(source => [source.id, source]))
  const claims = new Map(input.knowledgeBase.claims.map(claim => [claim.id, claim]))
  const exact = new Set(assets.map(asset => `${asset.kind}:${normalized(asset.title)}:${normalized(asset.content)}`))
  let addedCount = 0
  let skippedCount = 0

  for (const candidate of selected) {
    const exactKey = `${candidate.kind}:${normalized(candidate.title)}:${normalized(candidate.content)}`
    if (exact.has(exactKey)) {
      skippedCount += 1
      continue
    }
    const archivedIds = new Set(candidate.conflictWith || [])
    for (const asset of assets) {
      if (archivedIds.has(asset.id)) {
        asset.status = "archived"
        asset.updatedAt = now
      }
    }

    const assetId = `asset_import_${fingerprint(input.importId, candidate.id, exactKey).slice(0, 24)}`
    const sourceIds: string[] = []
    const file = input.files.find(item => item.name === candidate.sourceFileName)
    if (file) {
      const id = sourceId("source_file", file.sha256)
      sourceIds.push(id)
      sources.set(id, {
        id,
        title: file.name,
        kind: "userFile",
        fileName: file.name,
        contentHash: file.sha256,
        retrievedAt: input.knowledgeBase.updatedAt,
        updatedAt: now,
      })
    }
    for (const url of candidate.sourceUrls) {
      const id = sourceId("source_url", url)
      sourceIds.push(id)
      sources.set(id, {
        id,
        title: candidate.title,
        kind: "other",
        url,
        retrievedAt: now,
        updatedAt: now,
      })
    }
    const asset: GeoKnowledgeAsset = {
      id: assetId,
      kind: candidate.kind,
      title: candidate.title,
      content: candidate.content,
      evidenceLevel: candidate.evidenceLevel,
      status: "reviewed",
      sourceUrls: candidate.sourceUrls,
      tags: candidate.tags,
      subjectName: candidate.subjectName || input.subjectName,
      occurredAt: candidate.occurredAt,
      sourceFileName: candidate.sourceFileName,
      sourceLocator: candidate.sourceLocator,
      importJobId: input.importId,
      updatedAt: now,
    }
    const claim: GeoKnowledgeClaim = {
      id: `claim_${fingerprint(assetId, candidate.content).slice(0, 24)}`,
      assetId,
      subjectName: asset.subjectName || input.subjectName,
      kind: asset.kind,
      statement: asset.content,
      normalizedKey: `${asset.kind}:${normalized(asset.subjectName || input.subjectName)}:${normalized(asset.title)}`,
      evidenceLevel: asset.evidenceLevel,
      status: asset.status,
      sourceIds,
      tags: asset.tags,
      updatedAt: now,
    }
    assets.push(asset)
    claims.set(claim.id, claim)
    exact.add(exactKey)
    addedCount += 1
  }

  return {
    knowledgeBase: normalizeClientKnowledgeBase({
      ...input.knowledgeBase,
      assets,
      sources: [...sources.values()] as GeoKnowledgeSource[],
      claims: [...claims.values()],
      revision: input.knowledgeBase.revision + (addedCount > 0 ? 1 : 0),
      updatedAt: addedCount > 0 ? now : input.knowledgeBase.updatedAt,
    }, {
      subjectType: input.subjectType,
      subjectName: input.subjectName,
      aliases: input.knowledgeBase.aliases,
    }),
    addedCount,
    skippedCount,
  }
}
