import "server-only"

import { lookup } from "dns/promises"
import { isIP } from "net"
import { Readability } from "@mozilla/readability"
import { JSDOM } from "jsdom"
import TurndownService from "turndown"
import { gfm } from "turndown-plugin-gfm"

export interface ExtractedArticle {
  url: string
  finalUrl: string
  title: string
  markdown: string
  excerpt: string
  contentLength: number
}

const MAX_HTML_BYTES = 2_500_000
const MAX_MARKDOWN_CHARS = 60_000
const MAX_REDIRECTS = 5
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return true
  if (parts.some(part => part < 0 || part > 255)) return true
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

function normalizeHostAddress(host: string): string {
  return host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1).toLowerCase()
    : host.toLowerCase()
}

function ipv4FromMappedIpv6(ip: string): string | null {
  const rest = ip.toLowerCase().match(/^::ffff:(.+)$/)?.[1]
  if (!rest) return null
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(rest)) return rest

  const groups = rest.split(":").filter(Boolean)
  if (groups.length < 2) return null
  const high = Number.parseInt(groups[groups.length - 2], 16)
  const low = Number.parseInt(groups[groups.length - 1], 16)
  if (![high, low].every(value => Number.isInteger(value) && value >= 0 && value <= 0xffff)) {
    return null
  }
  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ].join(".")
}

function isPrivateIpv6(ip: string): boolean {
  const lower = normalizeHostAddress(ip)
  const mappedIpv4 = ipv4FromMappedIpv6(lower)
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4)

  const firstSegment = Number.parseInt(lower.split(":")[0] || "", 16)
  const isLinkLocal = Number.isFinite(firstSegment) && firstSegment >= 0xfe80 && firstSegment <= 0xfebf

  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("ff") ||
    isLinkLocal
  )
}

function assertPublicIp(address: string) {
  const version = isIP(address)
  if (version === 4 && isPrivateIpv4(address)) {
    throw new Error("该链接指向内网或保留地址，已拒绝读取。")
  }
  if (version === 6 && isPrivateIpv6(address)) {
    throw new Error("该链接指向内网或保留地址，已拒绝读取。")
  }
}

async function validatePublicUrl(rawUrl: string): Promise<URL> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error("请输入有效的文章链接。")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("文章链接只支持 http 或 https。")
  }
  if (parsed.username || parsed.password) {
    throw new Error("文章链接不能包含用户名或密码。")
  }
  const host = normalizeHostAddress(parsed.hostname)
  if (!host || host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("文章链接不能指向 localhost。")
  }
  if (isIP(host)) {
    assertPublicIp(host)
    return parsed
  }

  const records = await lookup(host, { all: true, verbatim: false })
  if (records.length === 0) throw new Error("无法解析该文章链接域名。")
  for (const record of records) assertPublicIp(record.address)
  return parsed
}

async function readResponseText(res: Response): Promise<string> {
  const lengthHeader = res.headers.get("content-length")
  const contentLength = lengthHeader ? Number(lengthHeader) : NaN
  if (Number.isFinite(contentLength) && contentLength > MAX_HTML_BYTES) {
    throw new Error("文章页面过大，请复制正文后手动粘贴。")
  }
  if (!res.body) return await res.text()

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    received += value.byteLength
    if (received > MAX_HTML_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new Error("文章页面过大，请复制正文后手动粘贴。")
    }
    chunks.push(value)
  }

  const merged = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged)
}

async function fetchArticleHtml(rawUrl: string): Promise<{ finalUrl: string; html: string; contentType: string }> {
  let current = await validatePublicUrl(rawUrl)
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    let res: Response
    try {
      res = await fetch(current.toString(), {
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
      })
    } finally {
      clearTimeout(timer)
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location")
      if (!location) throw new Error("文章链接发生跳转但没有返回目标地址。")
      current = await validatePublicUrl(new URL(location, current).toString())
      continue
    }
    if (!res.ok) throw new Error(`文章页面读取失败 HTTP ${res.status}`)

    const contentType = res.headers.get("content-type") || ""
    if (contentType && !/text\/html|application\/xhtml\+xml|application\/xml/i.test(contentType)) {
      throw new Error("该链接不是可读取的文章网页，请换文章链接或手动粘贴原文。")
    }
    return { finalUrl: current.toString(), html: await readResponseText(res), contentType }
  }
  throw new Error("文章链接跳转次数过多，已停止读取。")
}

function compactMarkdown(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
  })
  service.use(gfm)
  service.remove(["script", "style", "noscript", "iframe", "form", "nav", "footer", "header"])
  service.addRule("dropSvg", {
    filter: node => node.nodeName.toLowerCase() === "svg",
    replacement: () => "",
  })
  service.addRule("dropImages", {
    filter: "img",
    replacement: (_content, node) => {
      const alt = node.getAttribute("alt")?.trim()
      return alt ? ` ${alt} ` : ""
    },
  })
  return service
}

function extractFallbackHtml(document: Document): { title: string; content: string; excerpt: string } {
  const title =
    document.querySelector("meta[property='og:title']")?.getAttribute("content") ||
    document.querySelector("h1")?.textContent ||
    document.title ||
    "未命名文章"
  const container =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.querySelector("[class*='article']") ||
    document.querySelector("[id*='article']") ||
    document.body
  const excerpt =
    document.querySelector("meta[name='description']")?.getAttribute("content") ||
    document.querySelector("meta[property='og:description']")?.getAttribute("content") ||
    ""
  return { title: title.trim(), content: container?.innerHTML || "", excerpt: excerpt.trim() }
}

export async function extractArticleFromUrl(rawUrl: string): Promise<ExtractedArticle> {
  const { finalUrl, html } = await fetchArticleHtml(rawUrl)
  const dom = new JSDOM(html, { url: finalUrl })
  const reader = new Readability(dom.window.document.cloneNode(true) as Document, {
    keepClasses: false,
  })
  const parsed = reader.parse()
  const fallback = parsed
    ? {
        title: parsed.title || "未命名文章",
        content: parsed.content || "",
        excerpt: parsed.excerpt || "",
      }
    : extractFallbackHtml(dom.window.document)

  const markdown = compactMarkdown(createTurndown().turndown(fallback.content))
  if (markdown.length < 120) {
    throw new Error("未能从该链接提取到足够的正文内容，请手动粘贴原文或换一个文章链接。")
  }

  return {
    url: rawUrl,
    finalUrl,
    title: fallback.title.trim() || "未命名文章",
    markdown: markdown.slice(0, MAX_MARKDOWN_CHARS),
    excerpt: fallback.excerpt.trim(),
    contentLength: markdown.length,
  }
}
