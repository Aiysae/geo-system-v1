import { createHash, randomUUID } from "crypto"
import type {
  ArticleMediaMappingMode,
  ArticleMediaPlacement,
  ArticleMediaRevision,
  ArticleMediaTemplateKey,
} from "@/types"

type MarkdownBlock = {
  raw: string
  kind: "heading" | "paragraph" | "list" | "quote" | "table" | "code" | "rule"
  headingText?: string
}

export type ArticleMediaInsertAsset = {
  id: string
  alt: string
}

const CONCLUSION_PATTERN = /(结语|结论|总结|写在最后|最后的话|行动建议|下一步)/i

function splitMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n")
  const blocks: MarkdownBlock[] = []
  let index = 0

  const pushLines = (kind: MarkdownBlock["kind"], collected: string[], headingText?: string) => {
    const raw = collected.join("\n").trimEnd()
    if (raw.trim()) blocks.push({ kind, raw, headingText })
  }

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()
    if (!trimmed) {
      index += 1
      continue
    }
    if (/^```|^~~~/.test(trimmed)) {
      const fence = trimmed.slice(0, 3)
      const collected = [line]
      index += 1
      while (index < lines.length) {
        collected.push(lines[index])
        const done = lines[index].trim().startsWith(fence)
        index += 1
        if (done) break
      }
      pushLines("code", collected)
      continue
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      pushLines("heading", [line], heading[2].trim())
      index += 1
      continue
    }
    if (/^---+$/.test(trimmed)) {
      pushLines("rule", [line])
      index += 1
      continue
    }
    const next = lines[index + 1]?.trim() || ""
    if (line.includes("|") && /^\|?\s*:?-{3,}/.test(next)) {
      const collected = [line, lines[index + 1]]
      index += 2
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        collected.push(lines[index])
        index += 1
      }
      pushLines("table", collected)
      continue
    }
    if (/^\s*(?:[-*+]\s+|\d+[.)、]\s*)/.test(line)) {
      const collected = [line]
      index += 1
      while (index < lines.length && /^\s*(?:[-*+]\s+|\d+[.)、]\s*)/.test(lines[index])) {
        collected.push(lines[index])
        index += 1
      }
      pushLines("list", collected)
      continue
    }
    if (/^\s*>/.test(line)) {
      const collected = [line]
      index += 1
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        collected.push(lines[index])
        index += 1
      }
      pushLines("quote", collected)
      continue
    }

    const collected = [line]
    index += 1
    while (index < lines.length) {
      const candidate = lines[index]
      const candidateTrimmed = candidate.trim()
      if (!candidateTrimmed) break
      if (/^(#{1,6})\s+/.test(candidateTrimmed)
        || /^```|^~~~/.test(candidateTrimmed)
        || /^---+$/.test(candidateTrimmed)
        || /^\s*(?:[-*+]\s+|\d+[.)、]\s*)/.test(candidate)
        || /^\s*>/.test(candidate)) break
      const after = lines[index + 1]?.trim() || ""
      if (candidate.includes("|") && /^\|?\s*:?-{3,}/.test(after)) break
      collected.push(candidate)
      index += 1
    }
    pushLines("paragraph", collected)
  }
  return blocks
}

function desiredCount(template: ArticleMediaTemplateKey): number {
  if (template === "opening") return 1
  if (template === "rich") return 5
  return 3
}

function closestCandidate(candidates: number[], target: number, used: Set<number>): number | undefined {
  return candidates
    .filter(index => !used.has(index))
    .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0]
}

function chooseAnchors(blocks: MarkdownBlock[], count: number): Array<{
  blockIndex: number
  insertBefore: boolean
  anchor: ArticleMediaPlacement["anchor"]
}> {
  if (blocks.length === 0 || count <= 0) return []
  const paragraphIndexes = blocks
    .map((block, index) => block.kind === "paragraph" || block.kind === "quote" ? index : -1)
    .filter(index => index >= 0)
  const safeIndexes = paragraphIndexes.length > 0
    ? paragraphIndexes
    : blocks.map((block, index) => !["code", "table"].includes(block.kind) ? index : -1).filter(index => index >= 0)
  if (safeIndexes.length === 0) return []

  const used = new Set<number>()
  const anchors: Array<{ blockIndex: number; insertBefore: boolean; anchor: ArticleMediaPlacement["anchor"] }> = []
  const opening = safeIndexes.find(index => blocks[index].kind === "paragraph") ?? safeIndexes[0]
  used.add(opening)
  anchors.push({ blockIndex: opening, insertBefore: false, anchor: "opening" })
  if (count === 1) return anchors

  const conclusionHeading = blocks.findIndex(block => (
    block.kind === "heading" && CONCLUSION_PATTERN.test(block.headingText || "")
  ))
  const conclusionTarget = conclusionHeading >= 0
    ? conclusionHeading
    : safeIndexes[safeIndexes.length - 1]

  const middleCount = Math.max(0, count - 2)
  for (let index = 1; index <= middleCount; index++) {
    const target = Math.round((blocks.length - 1) * index / (middleCount + 1))
    const selected = closestCandidate(safeIndexes, target, used)
    if (selected === undefined) continue
    used.add(selected)
    anchors.push({ blockIndex: selected, insertBefore: false, anchor: "section" })
  }

  const conclusionCandidate = closestCandidate(safeIndexes, conclusionTarget, used)
  if (conclusionHeading >= 0 && !used.has(conclusionHeading)) {
    anchors.push({ blockIndex: conclusionHeading, insertBefore: true, anchor: "conclusion" })
  } else if (conclusionCandidate !== undefined) {
    anchors.push({ blockIndex: conclusionCandidate, insertBefore: false, anchor: "conclusion" })
  }

  if (anchors.length < count) {
    for (let index = 1; index < safeIndexes.length && anchors.length < count; index++) {
      const candidate = safeIndexes[index]
      if (used.has(candidate)) continue
      used.add(candidate)
      anchors.push({ blockIndex: candidate, insertBefore: false, anchor: "section" })
    }
  }
  return anchors.slice(0, count).sort((a, b) => a.blockIndex - b.blockIndex)
}

function mediaMarkdown(asset: ArticleMediaInsertAsset): string {
  const alt = String(asset.alt || "文章配图").replace(/[\[\]\r\n]/g, " ").trim() || "文章配图"
  return `<!-- shitu-article-media:${asset.id} -->\n![${alt}](/api/article-generation/assets/${encodeURIComponent(asset.id)}/content)`
}

export function articleMediaTemplateCount(template: ArticleMediaTemplateKey): number {
  return desiredCount(template)
}

export function insertArticleMedia(input: {
  markdown: string
  assets: ArticleMediaInsertAsset[]
  template: ArticleMediaTemplateKey
  mappingMode: ArticleMediaMappingMode
}): ArticleMediaRevision {
  const source = String(input.markdown || "").trim()
  const requestedAssets = input.assets.slice(0, desiredCount(input.template))
  const blocks = splitMarkdownBlocks(source)
  const anchors = chooseAnchors(blocks, requestedAssets.length)
  const assignments = anchors.map((anchor, index) => ({ anchor, asset: requestedAssets[index] }))
  const before = new Map<number, string[]>()
  const after = new Map<number, string[]>()
  const placements: ArticleMediaPlacement[] = []
  for (const assignment of assignments) {
    const target = assignment.anchor.insertBefore ? before : after
    const values = target.get(assignment.anchor.blockIndex) || []
    values.push(mediaMarkdown(assignment.asset))
    target.set(assignment.anchor.blockIndex, values)
    placements.push({
      assetId: assignment.asset.id,
      alt: assignment.asset.alt,
      anchor: assignment.anchor.anchor,
      blockIndex: assignment.anchor.blockIndex,
    })
  }

  const rendered: string[] = []
  blocks.forEach((block, index) => {
    rendered.push(...(before.get(index) || []), block.raw, ...(after.get(index) || []))
  })
  const now = new Date().toISOString()
  return {
    id: `amr_${randomUUID().replace(/-/g, "")}`,
    version: 1,
    sourceHash: createHash("sha256").update(source).digest("hex"),
    markdown: rendered.join("\n\n").trim(),
    template: input.template,
    mappingMode: input.mappingMode,
    assetIds: assignments.map(assignment => assignment.asset.id),
    placements,
    createdAt: now,
    updatedAt: now,
  }
}

export function replaceArticleMediaUrls(
  markdown: string,
  resolve: (assetId: string) => string,
): string {
  return String(markdown || "").replace(
    /\/api\/article-generation\/assets\/([A-Za-z0-9_-]+)\/content/g,
    (_match, assetId: string) => resolve(assetId),
  )
}

export function articleMediaAssetIds(markdown: string): string[] {
  const ids: string[] = []
  const pattern = /\/api\/article-generation\/assets\/([A-Za-z0-9_-]+)\/content/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(String(markdown || "")))) ids.push(match[1])
  return [...new Set(ids)]
}
