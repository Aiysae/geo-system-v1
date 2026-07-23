import "server-only"

import { Readability } from "@mozilla/readability"
import { JSDOM } from "jsdom"
import TurndownService from "turndown"
import { gfm } from "turndown-plugin-gfm"
import { fetchSafeWebText } from "@/lib/safe-web-fetch"

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
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"

async function fetchArticleHtml(rawUrl: string): Promise<{ finalUrl: string; html: string; contentType: string }> {
  try {
    const result = await fetchSafeWebText(rawUrl, {
      maxBytes: MAX_HTML_BYTES,
      timeoutMs: 15_000,
      userAgent: UA,
      allowedContentTypes: /text\/html|application\/xhtml\+xml|application\/xml/i,
    })
    return { finalUrl: result.finalUrl, html: result.text, contentType: result.contentType }
  } catch (error) {
    const message = error instanceof Error ? error.message : "文章页面读取失败"
    throw new Error(message.replace(/^网页/, "文章页面").replace(/^网址/, "文章链接"))
  }
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
