import "server-only"

import fs from "fs/promises"
import path from "path"
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
} from "docx"

const BODY_FONT = "Microsoft YaHei"
const BODY_COLOR = "1F2937"
const ACCENT_COLOR = "1677FF"
const ARTIFACT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

function artifactRoot(): string {
  if (process.env.ARTICLE_ARTIFACTS_DIR?.trim()) return process.env.ARTICLE_ARTIFACTS_DIR.trim()
  return process.env.NODE_ENV === "production"
    ? "/var/lib/geo-system/article-artifacts"
    : "/tmp/geo-system/article-artifacts"
}

export function sanitizeArticleFileName(value: string, fallback = "文章"): string {
  return String(value || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 88) || fallback
}

export function extractArticleTitle(markdown: string, fallback = "文章"): string {
  const lines = String(markdown || "").split(/\r?\n/)
  const heading = lines.find(line => /^#\s+\S/.test(line.trim()))
  if (heading) return sanitizeArticleFileName(heading.trim().replace(/^#\s+/, ""), fallback)
  const first = lines.find(line => line.trim() && !/^```/.test(line.trim()))
  return sanitizeArticleFileName(
    String(first || fallback).replace(/^#{1,6}\s+/, "").replace(/[*_`>#]/g, "").trim(),
    fallback,
  )
}

function inlineRuns(value: string): Array<TextRun | ExternalHyperlink> {
  const source = String(value || "")
  const tokenPattern = /(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|_([^_]+)_)/g
  const runs: Array<TextRun | ExternalHyperlink> = []
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = tokenPattern.exec(source))) {
    if (match.index > cursor) {
      runs.push(new TextRun({ text: source.slice(cursor, match.index), font: BODY_FONT }))
    }
    if (match[2] && match[3]) {
      runs.push(new ExternalHyperlink({
        link: match[3],
        children: [new TextRun({ text: match[2], color: ACCENT_COLOR, underline: {}, font: BODY_FONT })],
      }))
    } else if (match[4]) {
      runs.push(new TextRun({ text: match[4], bold: true, font: BODY_FONT, color: "111827" }))
    } else if (match[5]) {
      runs.push(new TextRun({
        text: match[5],
        font: "Consolas",
        color: "0F4C81",
        shading: { type: ShadingType.CLEAR, color: "DDEBFF", fill: "EEF5FF" },
      }))
    } else if (match[6]) {
      runs.push(new TextRun({ text: match[6], italics: true, font: BODY_FONT }))
    }
    cursor = tokenPattern.lastIndex
  }
  if (cursor < source.length) {
    runs.push(new TextRun({ text: source.slice(cursor), font: BODY_FONT }))
  }
  return runs.length > 0 ? runs : [new TextRun({ text: source, font: BODY_FONT })]
}

function paragraph(text: string, options: IParagraphOptions = {}): Paragraph {
  return new Paragraph({
    spacing: { after: 150, line: 380 },
    ...options,
    children: inlineRuns(text),
  })
}

function tableCell(text: string, header: boolean): TableCell {
  return new TableCell({
    shading: header
      ? { type: ShadingType.CLEAR, color: "DCEAFF", fill: "DCEAFF" }
      : undefined,
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [new Paragraph({
      spacing: { after: 0, line: 320 },
      children: [new TextRun({ text: text.trim(), bold: header, font: BODY_FONT, size: 20 })],
    })],
  })
}

function parseTable(lines: string[]): Table {
  const rows = lines.map(line => line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map(cell => cell.trim()))
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, color: "B7CDF0", size: 1 },
      bottom: { style: BorderStyle.SINGLE, color: "B7CDF0", size: 1 },
      left: { style: BorderStyle.SINGLE, color: "B7CDF0", size: 1 },
      right: { style: BorderStyle.SINGLE, color: "B7CDF0", size: 1 },
      insideHorizontal: { style: BorderStyle.SINGLE, color: "D8E4F5", size: 1 },
      insideVertical: { style: BorderStyle.SINGLE, color: "D8E4F5", size: 1 },
    },
    rows: rows.map((cells, index) => new TableRow({
      children: cells.map(cell => tableCell(cell, index === 0)),
    })),
  })
}

function markdownChildren(markdown: string): Array<Paragraph | Table> {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n")
  const children: Array<Paragraph | Table> = []
  let inCode = false
  let codeLines: string[] = []

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]
    const line = raw.trimEnd()
    if (/^```/.test(line.trim())) {
      if (!inCode) {
        inCode = true
        codeLines = []
      } else {
        children.push(new Paragraph({
          spacing: { before: 100, after: 180, line: 300 },
          shading: { type: ShadingType.CLEAR, color: "EEF3F8", fill: "F3F6FA" },
          indent: { left: 220, right: 220 },
          children: [new TextRun({ text: codeLines.join("\n"), font: "Consolas", size: 18, color: "334155" })],
        }))
        inCode = false
      }
      continue
    }
    if (inCode) {
      codeLines.push(raw)
      continue
    }

    const next = lines[index + 1]?.trim() || ""
    if (line.includes("|") && /^\|?\s*:?-{3,}/.test(next)) {
      const tableLines = [line]
      index += 2
      while (index < lines.length && lines[index].includes("|")) {
        tableLines.push(lines[index])
        index += 1
      }
      index -= 1
      children.push(parseTable(tableLines))
      children.push(new Paragraph({ spacing: { after: 90 } }))
      continue
    }

    if (!line.trim()) {
      if (children.length > 0) children.push(new Paragraph({ spacing: { after: 60 } }))
      continue
    }
    if (/^---+$/.test(line.trim())) {
      children.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, color: "C9D7E8", size: 5, space: 8 } },
        spacing: { before: 100, after: 180 },
      }))
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = Math.min(3, heading[1].length)
      children.push(paragraph(heading[2], {
        heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        spacing: { before: level === 1 ? 120 : 260, after: 150, line: 320 },
        keepNext: true,
      }))
      continue
    }

    const bullet = line.match(/^[-*+]\s+(.+)$/)
    if (bullet) {
      children.push(paragraph(bullet[1], { bullet: { level: 0 }, spacing: { after: 80, line: 350 } }))
      continue
    }
    const numbered = line.match(/^\d+[.)、]\s*(.+)$/)
    if (numbered) {
      children.push(paragraph(numbered[1], {
        numbering: { reference: "article-numbering", level: 0 },
        spacing: { after: 80, line: 350 },
      }))
      continue
    }
    const quote = line.match(/^>\s*(.+)$/)
    if (quote) {
      children.push(paragraph(quote[1], {
        indent: { left: 320, right: 180 },
        border: { left: { style: BorderStyle.SINGLE, color: "53A8FF", size: 18, space: 10 } },
        shading: { type: ShadingType.CLEAR, color: "EAF5FF", fill: "F3F9FF" },
        spacing: { before: 100, after: 160, line: 360 },
      }))
      continue
    }

    children.push(paragraph(line.trim()))
  }

  if (inCode && codeLines.length > 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: codeLines.join("\n"), font: "Consolas" })] }))
  }
  return children
}

export async function buildArticleDocxBuffer(markdown: string, title: string): Promise<Buffer> {
  const document = new Document({
    creator: "势途 GEO 全链路操作工具",
    title,
    description: "GEO 文章批量生成文档",
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: 22, color: BODY_COLOR },
          paragraph: { spacing: { line: 380, after: 150 } },
        },
      },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: BODY_FONT, size: 34, bold: true, color: "0B2A55" },
          paragraph: {
            spacing: { before: 180, after: 180 },
            border: { bottom: { style: BorderStyle.SINGLE, color: ACCENT_COLOR, size: 10, space: 8 } },
          },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: BODY_FONT, size: 28, bold: true, color: "0D4F9E" },
          paragraph: { spacing: { before: 260, after: 140 } },
        },
        {
          id: "Heading3",
          name: "Heading 3",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: BODY_FONT, size: 24, bold: true, color: "155FA8" },
          paragraph: { spacing: { before: 220, after: 100 } },
        },
      ],
    },
    numbering: {
      config: [{
        reference: "article-numbering",
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: "%1.",
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 520, hanging: 260 } } },
        }],
      }],
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1100, right: 1100, bottom: 1100, left: 1100 },
        },
      },
      children: markdownChildren(markdown),
    }],
  })
  return Packer.toBuffer(document)
}

function safeArtifactPath(batchId: string, itemId: string): string {
  const safeBatch = batchId.replace(/[^A-Za-z0-9_-]/g, "")
  const safeItem = itemId.replace(/[^A-Za-z0-9_-]/g, "")
  return path.join(artifactRoot(), safeBatch, `${safeItem}.docx`)
}

export async function writeArticleDocxArtifact(args: {
  batchId: string
  itemId: string
  position: number
  markdown: string
  title: string
}): Promise<{ artifactPath: string; fileName: string; buffer: Buffer }> {
  const title = extractArticleTitle(args.markdown, args.title)
  const fileName = `${String(args.position).padStart(2, "0")}_${sanitizeArticleFileName(title)}.docx`
  const artifactPath = safeArtifactPath(args.batchId, args.itemId)
  const buffer = await buildArticleDocxBuffer(args.markdown, title)
  await fs.mkdir(path.dirname(artifactPath), { recursive: true })
  const tempPath = `${artifactPath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, buffer)
  await fs.rename(tempPath, artifactPath)
  return { artifactPath, fileName, buffer }
}

export async function readArticleDocxArtifact(args: {
  batchId: string
  itemId: string
  position: number
  markdown: string
  title: string
  fileName?: string
  artifactPath?: string
}): Promise<{ buffer: Buffer; fileName: string; artifactPath: string }> {
  const expectedPath = safeArtifactPath(args.batchId, args.itemId)
  if (args.artifactPath === expectedPath) {
    try {
      const buffer = await fs.readFile(/*turbopackIgnore: true*/ expectedPath)
      return {
        buffer,
        fileName: args.fileName || `${String(args.position).padStart(2, "0")}_${sanitizeArticleFileName(args.title)}.docx`,
        artifactPath: expectedPath,
      }
    } catch {
      // Missing cache files are regenerated from the durable Markdown source.
    }
  }
  return writeArticleDocxArtifact(args)
}

export async function cleanupArticleArtifacts(): Promise<void> {
  const root = artifactRoot()
  try {
    const batchDirs = await fs.readdir(/*turbopackIgnore: true*/ root, { withFileTypes: true })
    const cutoff = Date.now() - ARTIFACT_MAX_AGE_MS
    await Promise.all(batchDirs.filter(entry => entry.isDirectory()).map(async entry => {
      const directory = path.join(root, entry.name)
      const stats = await fs.stat(/*turbopackIgnore: true*/ directory)
      if (stats.mtimeMs < cutoff) await fs.rm(directory, { recursive: true, force: true })
    }))
  } catch {
    // The directory may not exist before the first batch.
  }
}
