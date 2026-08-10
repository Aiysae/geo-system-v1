import "server-only"

import { createHash } from "crypto"
import path from "path"
import Papa from "papaparse"
import sharp from "sharp"
import WordExtractor from "word-extractor"
import readXlsxFile from "read-excel-file/node"
import type { KnowledgeImportFileRecord } from "@/types/knowledge-import"

export const KNOWLEDGE_IMPORT_MAX_FILE_BYTES = 15 * 1024 * 1024
export const KNOWLEDGE_IMPORT_MAX_FILES = 12
export const KNOWLEDGE_IMPORT_MAX_TOTAL_BYTES = 45 * 1024 * 1024

const MAX_FILE_TEXT_CHARS = 90_000
const MAX_CHUNK_CHARS = 13_000
const MAX_PDF_PAGES = 80
const SUPPORTED_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".xlsx",
  ".csv",
  ".pdf",
  ".txt",
  ".md",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
])

export interface KnowledgeExtractionPayloadFile {
  name: string
  content: string
  fileType: "text" | "image"
}

export interface ParsedKnowledgeImportFile {
  metadata: KnowledgeImportFileRecord
  payloadFiles: KnowledgeExtractionPayloadFile[]
}

function cleanName(value: string): string {
  return String(value || "资料")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 180) || "资料"
}

function cleanText(value: string): string {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\u0007/g, "\t")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
}

function extensionOf(name: string): string {
  return path.extname(name).toLowerCase()
}

function textChunks(name: string, text: string, locatorPrefix = ""): KnowledgeExtractionPayloadFile[] {
  const source = cleanText(text).slice(0, MAX_FILE_TEXT_CHARS)
  if (!source) return []
  const chunks: KnowledgeExtractionPayloadFile[] = []
  for (let offset = 0; offset < source.length; offset += MAX_CHUNK_CHARS) {
    const content = source.slice(offset, offset + MAX_CHUNK_CHARS)
    const part = chunks.length + 1
    const locator = locatorPrefix || `字符 ${offset + 1}-${offset + content.length}`
    chunks.push({
      name: `${name}｜${locator}${source.length > MAX_CHUNK_CHARS ? `｜第${part}段` : ""}`,
      content: `【原文件：${name}】\n【位置：${locator}】\n${content}`,
      fileType: "text",
    })
  }
  return chunks
}

async function parseWord(buffer: Buffer, name: string): Promise<KnowledgeExtractionPayloadFile[]> {
  const extractor = new WordExtractor()
  const document = await extractor.extract(buffer)
  const text = cleanText(document.getBody())
  if (!text) throw new Error("Word 文档没有可提取的文字")
  return textChunks(name, text)
}

function formatCell(value: unknown): string {
  if (value == null) return ""
  if (value instanceof Date) return value.toISOString()
  return String(value).replace(/\r?\n/g, " ").trim()
}

async function parseWorkbook(buffer: Buffer, name: string): Promise<{
  payloadFiles: KnowledgeExtractionPayloadFile[]
  sheetNames: string[]
}> {
  const sheets = await readXlsxFile(buffer)
  const payloadFiles: KnowledgeExtractionPayloadFile[] = []
  const sheetNames: string[] = []
  for (const sheet of sheets.slice(0, 30)) {
    const sheetName = cleanName(sheet.sheet || `Sheet${sheetNames.length + 1}`)
    sheetNames.push(sheetName)
    const rows = sheet.data.slice(0, 3_000)
      .map((row, index) => {
        const values = row.map(formatCell)
        return values.some(Boolean) ? `第${index + 1}行\t${values.join("\t")}` : ""
      })
      .filter(Boolean)
    if (rows.length === 0) continue
    payloadFiles.push(...textChunks(name, rows.join("\n"), `工作表「${sheetName}」`))
  }
  if (payloadFiles.length === 0) throw new Error("Excel 表格没有可提取的数据")
  return { payloadFiles, sheetNames }
}

function parseCsv(buffer: Buffer, name: string): KnowledgeExtractionPayloadFile[] {
  const decoded = decodeText(buffer)
  const parsed = Papa.parse<string[]>(decoded, { skipEmptyLines: "greedy" })
  const rows = (parsed.data || []).slice(0, 5_000)
    .map((row, index) => `第${index + 1}行\t${row.map(formatCell).join("\t")}`)
  if (rows.length === 0) throw new Error("CSV 文件没有可提取的数据")
  return textChunks(name, rows.join("\n"), "CSV 数据行")
}

function decodeText(buffer: Buffer): string {
  let value = new TextDecoder("utf-8").decode(buffer)
  const replacementRatio = (value.match(/\ufffd/g)?.length || 0) / Math.max(1, value.length)
  if (replacementRatio > 0.01) {
    try {
      value = new TextDecoder("gb18030").decode(buffer)
    } catch {
      // Keep UTF-8 output when the runtime does not expose the legacy decoder.
    }
  }
  return cleanText(value)
}

async function parsePdf(buffer: Buffer, name: string): Promise<{
  payloadFiles: KnowledgeExtractionPayloadFile[]
  pageCount: number
}> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  })
  try {
    const document = await loadingTask.promise
    const pageCount = Math.min(document.numPages, MAX_PDF_PAGES)
    const payloadFiles: KnowledgeExtractionPayloadFile[] = []
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const textContent = await page.getTextContent()
      const text = textContent.items
        .map(item => "str" in item ? String(item.str || "") : "")
        .filter(Boolean)
        .join(" ")
      if (cleanText(text).length >= 20) {
        payloadFiles.push(...textChunks(name, text, `第 ${pageNumber} 页`))
      }
    }
    if (payloadFiles.length === 0) {
      throw new Error("这份 PDF 是扫描件或没有可提取文字，请将关键页转为图片后上传")
    }
    return { payloadFiles, pageCount: document.numPages }
  } finally {
    await loadingTask.destroy().catch(() => undefined)
  }
}

async function parseImage(buffer: Buffer, name: string): Promise<KnowledgeExtractionPayloadFile[]> {
  const normalized = await sharp(buffer, { failOn: "warning", limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 2_000, height: 2_000, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer()
  return [{
    name,
    content: `data:image/jpeg;base64,${normalized.toString("base64")}`,
    fileType: "image",
  }]
}

export function validateKnowledgeImportFiles(files: Array<{ name: string; size: number }>): void {
  if (files.length === 0) throw new Error("请选择要导入的资料文件")
  if (files.length > KNOWLEDGE_IMPORT_MAX_FILES) {
    throw new Error(`单次最多上传 ${KNOWLEDGE_IMPORT_MAX_FILES} 个文件`)
  }
  let total = 0
  for (const file of files) {
    const extension = extensionOf(file.name)
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      throw new Error(`暂不支持 ${extension || "无后缀"} 文件，请上传 Word、Excel、CSV、PDF、文本或图片`)
    }
    if (file.size <= 0) throw new Error(`${file.name} 是空文件`)
    if (file.size > KNOWLEDGE_IMPORT_MAX_FILE_BYTES) {
      throw new Error(`${file.name} 超过 15MB，请拆分后上传`)
    }
    total += file.size
  }
  if (total > KNOWLEDGE_IMPORT_MAX_TOTAL_BYTES) {
    throw new Error("单次上传总大小不能超过 45MB")
  }
}

export async function parseKnowledgeImportFile(input: {
  id: string
  name: string
  mimeType: string
  buffer: Buffer
}): Promise<ParsedKnowledgeImportFile> {
  const name = cleanName(input.name)
  const extension = extensionOf(name)
  let payloadFiles: KnowledgeExtractionPayloadFile[] = []
  let pageCount: number | undefined
  let sheetNames: string[] | undefined

  if (extension === ".doc" || extension === ".docx") {
    payloadFiles = await parseWord(input.buffer, name)
  } else if (extension === ".xlsx") {
    const workbook = await parseWorkbook(input.buffer, name)
    payloadFiles = workbook.payloadFiles
    sheetNames = workbook.sheetNames
  } else if (extension === ".csv") {
    payloadFiles = parseCsv(input.buffer, name)
  } else if (extension === ".pdf") {
    const pdf = await parsePdf(input.buffer, name)
    payloadFiles = pdf.payloadFiles
    pageCount = pdf.pageCount
  } else if ([".jpg", ".jpeg", ".png", ".webp"].includes(extension)) {
    payloadFiles = await parseImage(input.buffer, name)
  } else {
    payloadFiles = textChunks(name, decodeText(input.buffer))
  }

  if (payloadFiles.length === 0) throw new Error(`${name} 没有可提取的内容`)
  return {
    metadata: {
      id: input.id,
      name,
      mimeType: input.mimeType || "application/octet-stream",
      extension: extension.slice(1),
      sizeBytes: input.buffer.length,
      sha256: createHash("sha256").update(input.buffer).digest("hex"),
      pageCount,
      sheetNames,
      extractedChars: payloadFiles.reduce((sum, file) => sum + file.content.length, 0),
    },
    payloadFiles,
  }
}
