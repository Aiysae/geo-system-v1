export interface PublishImage {
  name: string
  url: string
  type?: string
}

export interface PreparedPublishArticle {
  title: string
  digest: string
  htmlContent: string
  markdownContent: string
  images: PublishImage[]
  tags: string[]
  tableCount: number
}

export interface PreparePublishArticleInput {
  markdown: string
  renderedHtml: string
  title?: string
  fallbackTitle?: string
  digest?: string
  tags?: string
  createDocument?: HtmlDocumentFactory
}

export type HtmlDocumentFactory = (html: string) => Document

const BLOCKED_ELEMENTS = "script,style,iframe,object,embed,form,input,button,textarea,select,meta,link"
const MARKDOWN_TABLE_PATTERN = /^\s*\|?.+\|.+\n\s*\|?\s*:?-{3,}[^\n]*\|/gm

export function preparePublishArticle(input: PreparePublishArticleInput): PreparedPublishArticle {
  const title = cleanInlineText(input.title) || extractMarkdownTitle(input.markdown, input.fallbackTitle)
  const normalized = normalizePublishHtml(input.renderedHtml, title, input.createDocument)
  const markdownContent = removeDuplicateMarkdownTitle(input.markdown, title)

  return {
    title,
    digest: cleanInlineText(input.digest) || extractMarkdownDigest(markdownContent),
    htmlContent: normalized.html,
    markdownContent,
    images: normalized.images,
    tags: parsePublishTags(input.tags || ""),
    tableCount: Math.max(normalized.tableCount, countMarkdownTables(markdownContent)),
  }
}

export function extractMarkdownTitle(markdown: string, fallback = "文章"): string {
  const heading = markdown.match(/^\s*#\s+(.+?)\s*#*\s*$/m)?.[1]
  if (heading) return cleanInlineText(stripMarkdownInline(heading)).slice(0, 100)

  const candidate = markdown
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line && !/^(?:```|~~~|>|[-*+]\s|\d+[.)]\s|\|)/.test(line))

  return (cleanInlineText(stripMarkdownInline(candidate || "")) || cleanInlineText(fallback) || "文章").slice(0, 100)
}

export function extractMarkdownDigest(markdown: string, maxLength = 120): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*#{1,6}\s+.*$/gm, " ")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-*+] |\d+[.)] )/gm, "")
    .replace(/^\s*\|?\s*:?-{3,}[^\n]*\|\s*$/gm, "")
    .replace(/\|/g, " ")
    .replace(/[*_~`]/g, " ")

  const normalized = cleanInlineText(plain)
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trim()}...` : normalized
}

export function removeDuplicateMarkdownTitle(markdown: string, title: string): string {
  const match = markdown.match(/^(\s*#\s+(.+?)\s*#*\s*)(?:\r?\n|$)/)
  if (!match) return markdown.trim()
  if (normalizeTitle(match[2]) !== normalizeTitle(title)) return markdown.trim()
  return markdown.slice(match[0].length).replace(/^\s+/, "").trim()
}

export function countMarkdownTables(markdown: string): number {
  return Array.from(markdown.matchAll(MARKDOWN_TABLE_PATTERN)).length
}

export function parsePublishTags(raw: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []

  for (const item of raw.split(/[\n,，、;；]+/)) {
    const tag = item.trim().replace(/^#+/, "").slice(0, 30)
    const key = tag.toLocaleLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
  }

  return tags.slice(0, 10)
}

export function normalizePublishHtml(
  rawHtml: string,
  title: string,
  createDocument: HtmlDocumentFactory = createBrowserDocument,
): { html: string; images: PublishImage[]; tableCount: number } {
  const doc = createDocument(rawHtml || "")
  doc.querySelectorAll(BLOCKED_ELEMENTS).forEach(element => element.remove())

  const article = doc.body.children.length === 1 && doc.body.firstElementChild?.tagName === "ARTICLE"
    ? doc.body.firstElementChild as HTMLElement
    : null
  const root = article || doc.body

  root.querySelectorAll("*").forEach(element => sanitizeElement(element as HTMLElement))

  const firstHeading = root.querySelector("h1")
  if (firstHeading && normalizeTitle(firstHeading.textContent || "") === normalizeTitle(title)) {
    firstHeading.remove()
  }

  const tables = Array.from(root.querySelectorAll("table")) as HTMLTableElement[]
  for (const table of tables) {
    table.setAttribute("role", "table")
    setStyle(table, "width", "100%")
    setStyle(table, "border-collapse", "collapse")
    setStyle(table, "table-layout", "auto")
    setStyle(table, "margin", "18px 0")

    table.querySelectorAll("th").forEach(cell => {
      setStyle(cell as HTMLElement, "padding", "10px 12px")
      setStyle(cell as HTMLElement, "border", "1px solid #b8d4f5")
      setStyle(cell as HTMLElement, "background", "#e6f4ff")
      setStyle(cell as HTMLElement, "color", "#0f172a")
      setStyle(cell as HTMLElement, "font-weight", "700")
      setStyle(cell as HTMLElement, "text-align", "left")
      setStyle(cell as HTMLElement, "word-break", "break-word")
    })
    table.querySelectorAll("td").forEach(cell => {
      setStyle(cell as HTMLElement, "padding", "10px 12px")
      setStyle(cell as HTMLElement, "border", "1px solid #d9e7f7")
      setStyle(cell as HTMLElement, "color", "#334155")
      setStyle(cell as HTMLElement, "vertical-align", "top")
      setStyle(cell as HTMLElement, "word-break", "break-word")
    })

    const parent = table.parentElement
    if (parent?.tagName === "DIV" && parent.children.length === 1 && parent.textContent === table.textContent) {
      parent.replaceWith(table)
    }
  }

  const images = Array.from(root.querySelectorAll("img"))
    .map((image, index) => toPublishImage(image as HTMLImageElement, index))
    .filter((image): image is PublishImage => Boolean(image))

  return {
    html: root.innerHTML.trim(),
    images: uniqueImages(images),
    tableCount: tables.length,
  }
}

function createBrowserDocument(html: string): Document {
  if (typeof DOMParser === "undefined") {
    throw new Error("当前环境无法生成发布排版，请在浏览器中重试。")
  }
  return new DOMParser().parseFromString(html, "text/html")
}

function sanitizeElement(element: HTMLElement) {
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase()
    const value = attribute.value.toLowerCase()
    if (name.startsWith("on") || name === "srcdoc" || value.includes("javascript:") || value.includes("expression(")) {
      element.removeAttribute(attribute.name)
      continue
    }
    if (name === "id" || name === "class" || name.startsWith("data-")) {
      element.removeAttribute(attribute.name)
    }
  }

  if (element.tagName === "A") {
    const href = element.getAttribute("href") || ""
    if (!isSafeLink(href)) element.removeAttribute("href")
    else {
      element.setAttribute("target", "_blank")
      element.setAttribute("rel", "nofollow noopener noreferrer")
    }
  }

  if (element.tagName === "IMG") {
    const src = element.getAttribute("src") || ""
    if (!isSafeImage(src)) element.remove()
    else {
      element.removeAttribute("srcset")
      element.setAttribute("loading", "lazy")
      setStyle(element, "max-width", "100%")
      setStyle(element, "height", "auto")
    }
  }
}

function isSafeLink(value: string): boolean {
  const url = value.trim().toLowerCase()
  return url.startsWith("https://") || url.startsWith("http://") || url.startsWith("mailto:") || url.startsWith("#")
}

function isSafeImage(value: string): boolean {
  const url = value.trim().toLowerCase()
  return url.startsWith("https://") || url.startsWith("http://") || url.startsWith("data:image/")
}

function toPublishImage(image: HTMLImageElement, index: number): PublishImage | null {
  const url = image.getAttribute("src")?.trim() || ""
  if (!isSafeImage(url)) return null

  if (url.startsWith("data:image/")) {
    const type = url.match(/^data:([^;,]+)/i)?.[1]
    return { name: `article-image-${index + 1}.${imageExtension(type)}`, url, type }
  }

  try {
    const parsed = new URL(url)
    const name = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || `article-image-${index + 1}`)
    return { name, url }
  } catch {
    return { name: `article-image-${index + 1}`, url }
  }
}

function imageExtension(type?: string): string {
  if (type === "image/jpeg") return "jpg"
  if (type === "image/svg+xml") return "svg"
  return type?.split("/")[1] || "png"
}

function uniqueImages(images: PublishImage[]): PublishImage[] {
  const seen = new Set<string>()
  return images.filter(image => {
    if (seen.has(image.url)) return false
    seen.add(image.url)
    return true
  })
}

function setStyle(element: HTMLElement, property: string, value: string) {
  element.style.setProperty(property, value)
}

function normalizeTitle(value: string): string {
  return cleanInlineText(stripMarkdownInline(value)).replace(/[\s\p{P}\p{S}]+/gu, "").toLocaleLowerCase()
}

function stripMarkdownInline(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~`]/g, "")
}

function cleanInlineText(value?: string): string {
  return String(value || "").replace(/\s+/g, " ").trim()
}
