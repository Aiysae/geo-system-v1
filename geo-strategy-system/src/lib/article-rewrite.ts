import type {
  ArticleRewriteAnalysis,
  ArticleRewriteAudit,
  ArticleRewriteBrandCandidate,
  ArticleRewriteBrandMapping,
  ArticleRewriteBrandRole,
  ArticleModelProviderKey,
} from "@/types"

export type RewriteMarkdownBlock = {
  index: number
  type: "heading" | "table" | "list" | "paragraph"
  text: string
  charCount: number
}

export type RawRewriteBrandCandidate = {
  name?: unknown
  aliases?: unknown
  role?: unknown
  blockIndexes?: unknown
  detailSignals?: unknown
  evidence?: unknown
}

const ROLE_SCORE: Record<ArticleRewriteBrandRole, number> = {
  primary: 22,
  featured: 16,
  listed: 8,
  background: 2,
}

const ROLE_VALUES = new Set<ArticleRewriteBrandRole>([
  "primary",
  "featured",
  "listed",
  "background",
])

export function normalizeBrandKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
}

export function fingerprintRewriteSource(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n").trim()
  let hash = 2166136261
  for (let index = 0; index < normalized.length; index++) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `v1-${normalized.length}-${(hash >>> 0).toString(16).padStart(8, "0")}`
}

function plainCharCount(value: string): number {
  return value
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[`*_>#|\[\]()~-]/g, "")
    .replace(/\s+/g, "")
    .length
}

function blockType(line: string): RewriteMarkdownBlock["type"] | null {
  if (/^#{1,6}\s+/.test(line)) return "heading"
  if (/^\s*\|.*\|\s*$/.test(line)) return "table"
  if (/^\s*(?:[-*+]\s+|\d+[.)、]\s*)/.test(line)) return "list"
  return null
}

export function splitRewriteMarkdownBlocks(markdown: string): RewriteMarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  const rawBlocks: Array<{ type: RewriteMarkdownBlock["type"]; text: string }> = []
  let paragraph: string[] = []

  const flushParagraph = () => {
    const text = paragraph.join("\n").trim()
    if (text) rawBlocks.push({ type: "paragraph", text })
    paragraph = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (!line.trim()) {
      flushParagraph()
      continue
    }
    const type = blockType(line)
    if (type) {
      flushParagraph()
      rawBlocks.push({ type, text: line.trim() })
      continue
    }
    paragraph.push(line)
  }
  flushParagraph()

  return rawBlocks.map((block, index) => ({
    index,
    type: block.type,
    text: block.text,
    charCount: plainCharCount(block.text),
  }))
}

function stringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    const text = String(item ?? "").trim().slice(0, maxLength)
    const key = normalizeBrandKey(text)
    if (!text || !key || seen.has(key)) continue
    seen.add(key)
    result.push(text)
    if (result.length >= maxItems) break
  }
  return result
}

function indexList(value: unknown, maxIndex: number): number[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .map(item => Math.floor(Number(item)))
    .filter(index => Number.isInteger(index) && index >= 0 && index < maxIndex)))
    .sort((a, b) => a - b)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function countAliasMentions(source: string, aliases: string[]): number {
  const occupied: Array<[number, number]> = []
  let count = 0
  for (const alias of [...aliases].sort((a, b) => b.length - a.length)) {
    if (!alias.trim()) continue
    const regex = new RegExp(escapeRegExp(alias), "giu")
    for (const match of source.matchAll(regex)) {
      const start = match.index ?? -1
      const end = start + match[0].length
      if (start < 0 || occupied.some(([from, to]) => start < to && end > from)) continue
      occupied.push([start, end])
      count++
    }
  }
  return count
}

function includesAlias(value: string, aliases: string[]): boolean {
  const normalized = value.normalize("NFKC").toLocaleLowerCase("zh-CN")
  return aliases.some(alias => normalized.includes(alias.normalize("NFKC").toLocaleLowerCase("zh-CN")))
}

function normalizeRole(value: unknown): ArticleRewriteBrandRole {
  const role = String(value ?? "").trim() as ArticleRewriteBrandRole
  return ROLE_VALUES.has(role) ? role : "listed"
}

function mergeRawCandidates(rawCandidates: RawRewriteBrandCandidate[]): RawRewriteBrandCandidate[] {
  const groups: Array<{
    keys: Set<string>
    candidate: RawRewriteBrandCandidate & { aliases: string[]; blockIndexes: number[]; detailSignals: string[]; evidence: string[] }
  }> = []

  for (const raw of rawCandidates.slice(0, 30)) {
    const name = String(raw.name ?? "").trim().slice(0, 120)
    if (!normalizeBrandKey(name)) continue
    const aliases = stringList(raw.aliases, 12, 120)
    const names = [name, ...aliases]
    const keys = new Set(names.map(normalizeBrandKey).filter(Boolean))
    const existing = groups.find(group => [...keys].some(key => [...group.keys].some(existingKey => {
      if (key === existingKey) return true
      const shorter = key.length <= existingKey.length ? key : existingKey
      const longer = key.length > existingKey.length ? key : existingKey
      const longerIsBilingual = /\p{Script=Han}/u.test(longer) && /[a-z]/i.test(longer)
      const shorterIsSingleScript = !(/\p{Script=Han}/u.test(shorter) && /[a-z]/i.test(shorter))
      return shorter.length >= 2 && longer.includes(shorter) && longerIsBilingual && shorterIsSingleScript
    })))
    if (!existing) {
      groups.push({
        keys,
        candidate: {
          ...raw,
          name,
          aliases,
          blockIndexes: Array.isArray(raw.blockIndexes) ? raw.blockIndexes.map(Number) : [],
          detailSignals: stringList(raw.detailSignals, 8, 80),
          evidence: stringList(raw.evidence, 6, 180),
        },
      })
      continue
    }
    for (const key of keys) existing.keys.add(key)
    existing.candidate.aliases = stringList(
      [...existing.candidate.aliases, ...names.filter(item => normalizeBrandKey(item) !== normalizeBrandKey(String(existing.candidate.name)))],
      12,
      120,
    )
    existing.candidate.blockIndexes = Array.from(new Set([
      ...existing.candidate.blockIndexes,
      ...(Array.isArray(raw.blockIndexes) ? raw.blockIndexes.map(Number) : []),
    ]))
    existing.candidate.detailSignals = stringList(
      [...existing.candidate.detailSignals, ...stringList(raw.detailSignals, 8, 80)],
      8,
      80,
    )
    existing.candidate.evidence = stringList(
      [...existing.candidate.evidence, ...stringList(raw.evidence, 6, 180)],
      6,
      180,
    )
    if (ROLE_SCORE[normalizeRole(raw.role)] > ROLE_SCORE[normalizeRole(existing.candidate.role)]) {
      existing.candidate.role = raw.role
    }
  }

  return groups.map(group => group.candidate)
}

export function finalizeRewriteBrandAnalysis(args: {
  sourceMarkdown: string
  rawCandidates: RawRewriteBrandCandidate[]
  provider: ArticleModelProviderKey
  model: string
}): ArticleRewriteAnalysis {
  const blocks = splitRewriteMarkdownBlocks(args.sourceMarkdown)
  const merged = mergeRawCandidates(args.rawCandidates)
  const provisional = merged.map(raw => {
    const name = String(raw.name ?? "").trim()
    const aliases = stringList([name, ...stringList(raw.aliases, 12, 120)], 13, 120)
    const mentionCount = countAliasMentions(args.sourceMarkdown, aliases)
    let blockIndexes = indexList(raw.blockIndexes, blocks.length)
    if (blockIndexes.length === 0) {
      blockIndexes = blocks
        .filter(block => includesAlias(block.text, aliases))
        .map(block => block.index)
    }
    const ownedBlocks = blockIndexes.map(index => blocks[index]).filter(Boolean)
    return {
      name,
      aliases: aliases.filter(alias => normalizeBrandKey(alias) !== normalizeBrandKey(name)),
      role: normalizeRole(raw.role),
      mentionCount,
      descriptionChars: ownedBlocks.reduce((sum, block) => sum + block.charCount, 0),
      blockCount: ownedBlocks.length,
      headingCount: ownedBlocks.filter(block => block.type === "heading").length,
      tableRowCount: ownedBlocks.filter(block => block.type === "table").length,
      detailSignals: stringList(raw.detailSignals, 8, 80),
      firstBlockIndex: blockIndexes[0] ?? Number.MAX_SAFE_INTEGER,
      evidence: stringList(raw.evidence, 6, 180),
    }
  }).filter(item => item.mentionCount > 0)

  const maxChars = Math.max(1, ...provisional.map(item => item.descriptionChars))
  const maxBlocks = Math.max(1, ...provisional.map(item => item.blockCount))
  const brands: ArticleRewriteBrandCandidate[] = provisional.map(item => {
    const lengthScore = (item.descriptionChars / maxChars) * 45
    const structureScore = Math.min(12, item.headingCount * 7 + item.tableRowCount * 2)
    const blockScore = (item.blockCount / maxBlocks) * 7
    const detailScore = Math.min(9, item.detailSignals.length * 2.25)
    const mentionScore = Math.min(5, item.mentionCount)
    return {
      ...item,
      firstBlockIndex: Number.isFinite(item.firstBlockIndex) ? item.firstBlockIndex : blocks.length,
      score: Math.round((lengthScore + structureScore + blockScore + detailScore + mentionScore + ROLE_SCORE[item.role]) * 10) / 10,
    }
  }).sort((a, b) => b.score - a.score || b.descriptionChars - a.descriptionChars || a.firstBlockIndex - b.firstBlockIndex)

  return {
    sourceFingerprint: fingerprintRewriteSource(args.sourceMarkdown),
    brands: brands.slice(0, 20),
    analyzedAt: new Date().toISOString(),
    provider: args.provider,
    model: args.model,
  }
}

function finiteNumber(value: unknown, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(max, parsed))
}

const ARTICLE_PROVIDER_VALUES = new Set<ArticleModelProviderKey>([
  "article",
  "deepseek",
  "qwen",
  "doubao",
  "kimi",
  "ernie",
  "hunyuan",
])

export function normalizeRewriteAnalysis(
  value: unknown,
  sourceMarkdown: string,
): ArticleRewriteAnalysis | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const sourceFingerprint = String(record.sourceFingerprint ?? "")
  if (sourceFingerprint !== fingerprintRewriteSource(sourceMarkdown)) return undefined

  const rawBrands = Array.isArray(record.brands) ? record.brands : []
  const brands = rawBrands.slice(0, 20).map(item => {
    const candidate = item && typeof item === "object"
      ? item as Record<string, unknown>
      : {}
    const name = String(candidate.name ?? "").trim().slice(0, 120)
    if (!normalizeBrandKey(name)) return null
    return {
      name,
      aliases: stringList(candidate.aliases, 12, 120)
        .filter(alias => normalizeBrandKey(alias) !== normalizeBrandKey(name)),
      role: normalizeRole(candidate.role),
      mentionCount: Math.floor(finiteNumber(candidate.mentionCount, 10000)),
      descriptionChars: Math.floor(finiteNumber(candidate.descriptionChars, 60000)),
      blockCount: Math.floor(finiteNumber(candidate.blockCount, 10000)),
      headingCount: Math.floor(finiteNumber(candidate.headingCount, 10000)),
      tableRowCount: Math.floor(finiteNumber(candidate.tableRowCount, 10000)),
      detailSignals: stringList(candidate.detailSignals, 8, 80),
      firstBlockIndex: Math.floor(finiteNumber(candidate.firstBlockIndex, 10000)),
      score: finiteNumber(candidate.score, 1000),
      evidence: stringList(candidate.evidence, 6, 180),
    } satisfies ArticleRewriteBrandCandidate
  }).filter((item): item is ArticleRewriteBrandCandidate => Boolean(item))

  const providerValue = String(record.provider ?? "article") as ArticleModelProviderKey
  return {
    sourceFingerprint,
    brands,
    analyzedAt: String(record.analyzedAt ?? "").slice(0, 80) || new Date().toISOString(),
    provider: ARTICLE_PROVIDER_VALUES.has(providerValue) ? providerValue : "article",
    model: String(record.model ?? "").trim().slice(0, 160),
  }
}

export function normalizeRewriteMappings(value: unknown): ArticleRewriteBrandMapping[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 10).map(item => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {}
    return {
      sourceBrand: String(record.sourceBrand ?? "").trim().slice(0, 120),
      sourceAliases: stringList(record.sourceAliases, 12, 120),
      targetBrand: String(record.targetBrand ?? "").trim().slice(0, 240),
      materials: String(record.materials ?? "").slice(0, 12000),
    }
  }).filter(mapping => mapping.sourceBrand || mapping.targetBrand || mapping.materials.trim())
}

export function validateRewriteMappings(mappings: ArticleRewriteBrandMapping[]): string[] {
  const issues: string[] = []
  if (mappings.length === 0) issues.push("请至少添加一组品牌替换映射")
  const sourceKeys = new Set<string>()
  const targetKeys = new Set<string>()
  mappings.forEach((mapping, index) => {
    if (!mapping.sourceBrand) issues.push(`第 ${index + 1} 组未填写原文品牌`)
    if (!mapping.targetBrand) issues.push(`第 ${index + 1} 组未填写新品牌`)
    if (!mapping.materials.trim()) issues.push(`第 ${index + 1} 组未填写对应品牌资料`)
    const sourceKey = normalizeBrandKey(mapping.sourceBrand)
    const targetKey = normalizeBrandKey(mapping.targetBrand)
    if (sourceKey && sourceKeys.has(sourceKey)) issues.push(`原文品牌“${mapping.sourceBrand}”被重复映射`)
    if (targetKey && targetKeys.has(targetKey)) issues.push(`新品牌“${mapping.targetBrand}”被重复使用`)
    if (sourceKey) sourceKeys.add(sourceKey)
    if (targetKey) targetKeys.add(targetKey)
  })
  return Array.from(new Set(issues))
}

function containsAnyBrand(value: string, names: string[]): boolean {
  return names.some(name => name.trim() && new RegExp(escapeRegExp(name), "iu").test(value))
}

function containsAnyBrandOutside(value: string, names: string[], protectedNames: string[]): boolean {
  const protectedSpans: Array<[number, number]> = []
  for (const name of [...protectedNames].sort((a, b) => b.length - a.length)) {
    if (!name.trim()) continue
    const regex = new RegExp(escapeRegExp(name), "giu")
    for (const match of value.matchAll(regex)) {
      const start = match.index ?? -1
      if (start >= 0) protectedSpans.push([start, start + match[0].length])
    }
  }
  return names.some(name => {
    if (!name.trim()) return false
    const regex = new RegExp(escapeRegExp(name), "giu")
    return [...value.matchAll(regex)].some(match => {
      const start = match.index ?? -1
      const end = start + match[0].length
      return start >= 0 && !protectedSpans.some(([from, to]) => start >= from && end <= to)
    })
  })
}

export function validateRewriteOutput(args: {
  sourceMarkdown: string
  output: string
  mappings: ArticleRewriteBrandMapping[]
  analysis?: ArticleRewriteAnalysis
}): { issues: string[]; protectedBrands: string[] } {
  const issues = validateRewriteMappings(args.mappings)
  const mappedSourceKeys = new Set(args.mappings.map(mapping => normalizeBrandKey(mapping.sourceBrand)))
  const protectedCandidates = (args.analysis?.brands || []).filter(
    candidate => !mappedSourceKeys.has(normalizeBrandKey(candidate.name)),
  )
  const targetBrands = args.mappings.map(mapping => mapping.targetBrand)

  for (const mapping of args.mappings) {
    const sourceNames = [mapping.sourceBrand, ...mapping.sourceAliases]
    const sourceKey = normalizeBrandKey(mapping.sourceBrand)
    const targetKey = normalizeBrandKey(mapping.targetBrand)
    if (!containsAnyBrand(args.output, [mapping.targetBrand])) {
      issues.push(`改写结果未出现新品牌“${mapping.targetBrand}”`)
    }
    if (
      sourceKey
      && sourceKey !== targetKey
      && containsAnyBrandOutside(args.output, sourceNames, [mapping.targetBrand])
    ) {
      issues.push(`改写结果仍残留待替换品牌“${mapping.sourceBrand}”`)
    }
  }

  for (const candidate of protectedCandidates) {
    const names = [candidate.name, ...candidate.aliases]
    if (
      containsAnyBrand(args.sourceMarkdown, names)
      && !containsAnyBrandOutside(args.output, names, targetBrands)
    ) {
      issues.push(`未映射品牌“${candidate.name}”被误删或误替换`)
    }
  }

  return {
    issues: Array.from(new Set(issues)),
    protectedBrands: protectedCandidates.map(candidate => candidate.name),
  }
}

export function createRewriteAudit(args: {
  mappings: ArticleRewriteBrandMapping[]
  protectedBrands: string[]
  repaired: boolean
}): ArticleRewriteAudit {
  return {
    mappedPairs: args.mappings.map(mapping => ({
      sourceBrand: mapping.sourceBrand,
      targetBrand: mapping.targetBrand,
    })),
    protectedBrands: args.protectedBrands,
    repaired: args.repaired,
    checkedAt: new Date().toISOString(),
  }
}
