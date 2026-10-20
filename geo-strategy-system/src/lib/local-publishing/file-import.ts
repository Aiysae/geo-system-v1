import { createHash } from "node:crypto"
import path from "node:path"
import mammoth from "mammoth"
import { JSDOM } from "jsdom"
import { marked } from "marked"
import sharp from "sharp"
import TurndownService from "turndown"
import { gfm } from "turndown-plugin-gfm"
import { preparePublishArticle } from "@/lib/article-publishing/content"

export const ARTICLE_FILE_LIMITS = { count: 20, fileBytes: 12 * 1024 * 1024, totalBytes: 32 * 1024 * 1024 }
const MAX_MARKDOWN = 300_000
const MAX_UNPACKED_DOCX = 64 * 1024 * 1024
const MAX_IMAGES = 50
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const IMAGE_PREFIX = "https://file-import.invalid/"

export class ArticleFileImportError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

export type ArticleFileInput = { name: string; buffer: Buffer }
export type ArticleFileImage = { key: string; name: string; buffer: Buffer; mimeType: string }
export type ParsedArticleFile = {
  name: string
  title: string
  markdown: string
  html: string
  digest: string
  sourceHash: string
  warnings: string[]
  images: ArticleFileImage[]
}

function tidy(value: string) { return value.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!) }
function makeTurndown() {
  const service = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" })
  service.use(gfm)
  service.addRule("compactTableCells", {
    filter: ["th", "td"],
    replacement: (content, node) => {
      const value = content.trim().replace(/\n+/g, "<br>").replace(/(?<!\\)\|/g, "\\|")
      const firstCell = Array.from(node.parentNode?.childNodes || []).find(child => child.nodeName === "TH" || child.nodeName === "TD")
      return `${firstCell === node ? "| " : " "}${value} |`
    },
  })
  return service
}

// Inspect ZIP directory sizes before Mammoth decompresses the document.
function checkDocxArchive(buffer: Buffer) {
  let directory = -1
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { directory = offset; break }
  }
  if (directory < 0) throw new ArticleFileImportError("Word 文件损坏，请重新导出为 .docx")
  const count = buffer.readUInt16LE(directory + 10)
  const start = buffer.readUInt32LE(directory + 16)
  if (count > 2000 || count === 0xffff || start === 0xffffffff) throw new ArticleFileImportError("Word 文件结构过大，请拆分后上传")
  let offset = start, unpacked = 0
  for (let index = 0; index < count; index++) {
    if (offset + 46 > directory || buffer.readUInt32LE(offset) !== 0x02014b50) throw new ArticleFileImportError("Word 文件目录无效")
    if (buffer.readUInt16LE(offset + 8) & 1) throw new ArticleFileImportError("请先解除 Word 文件加密后再上传")
    unpacked += buffer.readUInt32LE(offset + 24)
    if (unpacked > MAX_UNPACKED_DOCX) throw new ArticleFileImportError("Word 解压内容超过 64MB，请压缩图片或拆分文章", 413)
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32)
  }
}

function decodeText(buffer: Buffer, warnings: string[]) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder("utf-16le", { fatal: true }).decode(buffer)
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder("utf-16be", { fatal: true }).decode(buffer)
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer) }
  catch {
    try {
      const value = new TextDecoder("gb18030", { fatal: true }).decode(buffer)
      warnings.push("文件按 GB18030 中文编码读取，请在预览中检查文字。")
      return value
    } catch { throw new ArticleFileImportError("文字编码无法识别，请保存为 UTF-8 后上传") }
  }
}

async function parseOne(file: ArticleFileInput): Promise<ParsedArticleFile> {
  const name = path.basename(file.name.replaceAll("\\", "/")).replace(/[\x00-\x1f]/g, "").slice(0, 180)
  const extension = path.extname(name).toLowerCase()
  if (![".md", ".txt", ".docx"].includes(extension)) throw new ArticleFileImportError("仅支持 Markdown（.md）、TXT 和 Word（.docx）文件")
  const warnings: string[] = [], images: ArticleFileImage[] = []
  let html: string
  let totalImageBytes = 0
  const addImage = async (buffer: Buffer, contentType: string) => {
    if (images.length >= MAX_IMAGES) throw new ArticleFileImportError("一篇文章最多导入 50 张图片")
    try {
      const metadata = await sharp(buffer, { limitInputPixels: 40_000_000, failOn: "warning" }).metadata()
      if (!metadata.format || !["png", "jpeg", "webp", "gif", "tiff", "bmp"].includes(metadata.format)) throw new Error("unsupported")
      const normalized = await sharp(buffer, { limitInputPixels: 40_000_000, failOn: "warning" }).rotate()
        .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).png().toBuffer()
      totalImageBytes += normalized.length
      if (totalImageBytes > MAX_IMAGE_BYTES || normalized.length > 8 * 1024 * 1024) throw new ArticleFileImportError("文档图片过大，请压缩后重新上传", 413)
      const key = createHash("sha256").update(normalized).digest("hex")
      if (!images.some(image => image.key === key)) images.push({ key, name: `${path.basename(name, extension)}-图片${images.length + 1}.png`, buffer: normalized, mimeType: "image/png" })
      if (metadata.pages && metadata.pages > 1) warnings.push("动态图或多页图片仅保留第一帧，请检查图片。")
      return `${IMAGE_PREFIX}${key}`
    } catch (error) {
      if (error instanceof ArticleFileImportError) throw error
      warnings.push(`有一张 ${contentType || "未知格式"} 图片未能导入，请在编辑器中补充。`)
      return ""
    }
  }
  if (extension === ".docx") {
    checkDocxArchive(file.buffer)
    const result = await mammoth.convertToHtml({ buffer: file.buffer }, {
      externalFileAccess: false,
      includeEmbeddedStyleMap: false,
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='标题'] => h1:fresh"],
      convertImage: mammoth.images.imgElement(async image => ({ src: await addImage(await image.readAsBuffer(), image.contentType) })),
    })
    html = result.value
    if (result.messages.length) warnings.push("Word 中有未完整支持的样式或对象，请对照原文件检查预览。")
    warnings.push("Word 的页眉页脚、分页、浮动布局及精细字体样式不保留；请检查正文排版。")
  } else {
    const value = decodeText(file.buffer, warnings).replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "")
    if (value.includes("\0")) throw new ArticleFileImportError("文件包含二进制内容，请上传文章文本")
    if (value.length > MAX_MARKDOWN) throw new ArticleFileImportError("文章正文超过 30 万字限制", 413)
    html = extension === ".md" ? await marked.parse(value) : value.split(/\n\s*\n/).map(p => `<p>${escapeHtml(p).replaceAll("\n", "<br>")}</p>`).join("\n")
  }

  const document = new JSDOM(html).window.document
  let localImages = 0
  for (const image of Array.from(document.querySelectorAll("img"))) {
    const src = image.getAttribute("src") || ""
    if (src.startsWith(IMAGE_PREFIX)) continue
    const data = src.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i)
    if (data) image.setAttribute("src", await addImage(Buffer.from(data[2], "base64"), data[1]))
    else if (!/^https?:\/\//i.test(src)) { image.remove(); localImages++ }
  }
  if (localImages) warnings.push(`${localImages} 张本地路径或不支持格式的图片未导入，请在编辑器中重新上传。`)
  if (document.querySelector("table [rowspan], table [colspan]")) warnings.push("表格包含合并单元格，分发时可能简化为普通表格，请检查。")
  // Word tables have no Markdown heading row; promote the first row to preserve table content.
  for (const table of Array.from(document.querySelectorAll("table"))) {
    const row = table.querySelector("tr")
    if (!row || row.querySelector("th")) continue
    row.querySelectorAll("td").forEach(cell => { const heading = document.createElement("th"); heading.innerHTML = cell.innerHTML; cell.replaceWith(heading) })
  }
  const fallbackTitle = path.basename(name, extension) || "导入文章"
  const initialMarkdown = tidy(makeTurndown().turndown(document.body.innerHTML))
  const heading = document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim()
  if (heading && heading.length > 200) warnings.push("文章标题超过 200 字，已截短，请检查标题。")
  const prepared = preparePublishArticle({ markdown: initialMarkdown, renderedHtml: document.body.innerHTML,
    title: heading?.slice(0, 200) || fallbackTitle, fallbackTitle, createDocument: value => new JSDOM(value).window.document })
  // Build Markdown from sanitized HTML too, so unsafe embedded HTML cannot reappear in a Markdown adapter.
  const markdown = tidy(makeTurndown().turndown(prepared.htmlContent))
  if (!markdown.trim()) throw new ArticleFileImportError("文章正文为空，请补充正文后上传")
  if (markdown.length > MAX_MARKDOWN || prepared.htmlContent.length > 600_000) throw new ArticleFileImportError("转换后的文章过长，请拆分后上传", 413)
  return { name, title: prepared.title, markdown, html: prepared.htmlContent, digest: prepared.digest,
    sourceHash: createHash("sha256").update(file.buffer).digest("hex"), warnings: [...new Set(warnings)], images }
}

export async function parseArticleFiles(files: ArticleFileInput[]): Promise<ParsedArticleFile[]> {
  if (!files.length || files.length > ARTICLE_FILE_LIMITS.count) throw new ArticleFileImportError("每次请选择 1～20 个文章文件")
  if (files.reduce((sum, file) => sum + file.buffer.length, 0) > ARTICLE_FILE_LIMITS.totalBytes) throw new ArticleFileImportError("单次文章上传总量不能超过 32MB", 413)
  const parsed: ParsedArticleFile[] = []
  let imageBytes = 0
  for (const file of files) {
    if (!file.buffer.length || file.buffer.length > ARTICLE_FILE_LIMITS.fileBytes) throw new ArticleFileImportError(`${file.name}：单文件须为 1 字节至 12MB`, 413)
    try {
      const item = await parseOne(file)
      imageBytes += item.images.reduce((sum, image) => sum + image.buffer.length, 0)
      if (imageBytes > MAX_IMAGE_BYTES) throw new ArticleFileImportError("本批文章内嵌图片总量超过 20MB，请分批上传", 413)
      parsed.push(item)
    } catch (error) {
      throw new ArticleFileImportError(`${file.name}：${error instanceof Error ? error.message : "解析失败"}`, error instanceof ArticleFileImportError ? error.status : 400)
    }
  }
  return parsed
}

export function resolveArticleFileImages(item: ParsedArticleFile, imageUrls?: Map<string, string>) {
  let markdown = item.markdown, html = item.html
  for (const image of item.images) {
    const url = imageUrls?.get(image.key) || `data:${image.mimeType};base64,${image.buffer.toString("base64")}`
    markdown = markdown.replaceAll(`${IMAGE_PREFIX}${image.key}`, url)
    html = html.replaceAll(`${IMAGE_PREFIX}${image.key}`, url)
  }
  return { markdown, html }
}
