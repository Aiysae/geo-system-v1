import "server-only"

import { JSDOM } from "jsdom"
import type { GeoAuditPage } from "@/types"
import type { SafeWebFetchResult } from "@/lib/safe-web-fetch"

const TRUST_LINK_PATTERN = /关于|联系|团队|作者|专家|资质|认证|隐私|条款|备案|about|contact|team|author|privacy|terms/i
const CREDENTIAL_PATTERN = /资质|认证|执业|许可证|专家|教授|医生|律师|工程师|编辑|审核|参考资料|信息来源|白皮书|研究报告/i

function compact(value: string | null | undefined, max = 240): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max)
}

function unique(values: string[], max = 30): string[] {
  return Array.from(new Set(values.map(value => compact(value)).filter(Boolean))).slice(0, max)
}

function textList(values: string[], max = 30): string[] {
  return values.map(value => compact(value)).filter(Boolean).slice(0, max)
}

function extractSchemaNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(extractSchemaNodes)
  if (!value || typeof value !== "object") return []
  const record = value as Record<string, unknown>
  const graph = extractSchemaNodes(record["@graph"])
  return [record, ...graph]
}

function schemaTypes(node: Record<string, unknown>): string[] {
  const value = node["@type"]
  return Array.isArray(value)
    ? value.map(item => compact(String(item), 80)).filter(Boolean)
    : value
      ? [compact(String(value), 80)]
      : []
}

function textWordCount(value: string): number {
  return value.match(/[\p{Script=Han}]|[A-Za-z0-9]+/gu)?.length || 0
}

function headingLevelSkips(document: Document): number {
  const levels = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
    .map(element => Number(element.tagName.slice(1)))
  let skips = 0
  for (let index = 1; index < levels.length; index += 1) {
    if (levels[index] - levels[index - 1] > 1) skips += 1
  }
  return skips
}

function firstLeadText(document: Document): string {
  const root = document.querySelector("main,article,[role='main']") || document.body
  const candidates = Array.from(root.querySelectorAll("p"))
    .map(element => compact(element.textContent, 400))
    .filter(value => value.length >= 20)
  return candidates[0] || ""
}

function visibleQuestionCount(document: Document): number {
  const candidates = Array.from(document.querySelectorAll(
    "h2,h3,h4,dt,summary,[class*='question'],[class*='faq'] [class*='title'],[itemprop='name']",
  ))
  return unique(candidates.map(element => element.textContent || ""), 200)
    .filter(value => /[?？]$/.test(value) || /^(为什么|怎么|如何|什么|是否|能否|可以|哪家|哪个|多少|谁|where|what|why|how|can|does|is)\b/i.test(value))
    .length
}

export interface AnalyzedAuditPage {
  page: GeoAuditPage
  internalUrls: string[]
}

export function analyzeAuditPage(result: SafeWebFetchResult): AnalyzedAuditPage {
  const dom = new JSDOM(result.text, { url: result.finalUrl })
  const document = dom.window.document
  const origin = new URL(result.finalUrl).origin
  const structuredTypes: string[] = []
  const entityNames: string[] = []
  const authorSignals: string[] = []
  const dateSignals: string[] = []
  let structuredDataErrors = 0

  for (const script of Array.from(document.querySelectorAll("script[type='application/ld+json']"))) {
    const raw = script.textContent?.trim()
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      for (const node of extractSchemaNodes(parsed)) {
        const types = schemaTypes(node)
        structuredTypes.push(...types)
        const name = compact(String(node.name || ""), 160)
        if (name && types.some(type => /Organization|Person|Product|Service|WebSite|LocalBusiness/i.test(type))) {
          entityNames.push(name)
        }
        const author = node.author
        if (typeof author === "string") authorSignals.push(author)
        if (author && typeof author === "object" && !Array.isArray(author)) {
          authorSignals.push(compact(String((author as Record<string, unknown>).name || ""), 160))
        }
        for (const key of ["datePublished", "dateModified", "uploadDate"]) {
          if (node[key]) dateSignals.push(`${key}: ${compact(String(node[key]), 80)}`)
        }
      }
    } catch {
      structuredDataErrors += 1
    }
  }

  const authorMeta = document.querySelector("meta[name='author']")?.getAttribute("content")
  if (authorMeta) authorSignals.push(authorMeta)
  for (const author of Array.from(document.querySelectorAll("[rel='author'],[itemprop='author']"))) {
    authorSignals.push(author.textContent || author.getAttribute("content") || "")
  }
  for (const time of Array.from(document.querySelectorAll("time[datetime]"))) {
    dateSignals.push(time.getAttribute("datetime") || "")
  }
  for (const property of ["article:published_time", "article:modified_time"]) {
    const value = document.querySelector(`meta[property='${property}']`)?.getAttribute("content")
    if (value) dateSignals.push(`${property}: ${value}`)
  }

  const bodyClone = document.body?.cloneNode(true) as HTMLElement | undefined
  bodyClone?.querySelectorAll("script,style,noscript,template,svg").forEach(element => element.remove())
  const bodyText = compact(bodyClone?.textContent, 120_000)
  const anchors = Array.from(document.querySelectorAll("a[href]"))
  const internalUrls: string[] = []
  const trustLinks: string[] = []
  let externalCitationCount = 0
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href")
    if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) continue
    let url: URL
    try {
      url = new URL(href, result.finalUrl)
    } catch {
      continue
    }
    if (!["http:", "https:"].includes(url.protocol)) continue
    const label = compact(anchor.textContent || anchor.getAttribute("aria-label"), 120)
    if (url.origin === origin) {
      url.hash = ""
      internalUrls.push(url.toString())
      if (TRUST_LINK_PATTERN.test(`${label} ${url.pathname}`)) {
        trustLinks.push(`${label || url.pathname}: ${url.toString()}`)
      }
    } else if (anchor.closest("main,article,[role='main']")) {
      externalCitationCount += 1
    }
  }

  const credentialSignals = unique(
    bodyText
      .split(/[。！？\n]/)
      .filter(sentence => CREDENTIAL_PATTERN.test(sentence))
      .map(sentence => sentence.slice(0, 160)),
    12,
  )
  const semanticLandmarks = ["main", "article", "nav", "header", "footer", "aside"]
    .filter(tag => Boolean(document.querySelector(tag)))

  return {
    page: {
      url: result.requestedUrl,
      finalUrl: result.finalUrl,
      status: result.status,
      title: compact(document.title, 200),
      description: compact(
        document.querySelector("meta[name='description']")?.getAttribute("content")
          || document.querySelector("meta[property='og:description']")?.getAttribute("content"),
        320,
      ),
      language: compact(document.documentElement.getAttribute("lang"), 40),
      canonical: compact(document.querySelector("link[rel='canonical']")?.getAttribute("href"), 500),
      robotsMeta: compact(document.querySelector("meta[name='robots']")?.getAttribute("content"), 200),
      xRobotsTag: compact(result.headers["x-robots-tag"], 200),
      wordCount: textWordCount(bodyText),
      textLength: bodyText.length,
      leadText: firstLeadText(document),
      h1: textList(Array.from(document.querySelectorAll("h1")).map(element => element.textContent || ""), 12),
      h2: textList(Array.from(document.querySelectorAll("h2")).map(element => element.textContent || ""), 30),
      h3: textList(Array.from(document.querySelectorAll("h3")).map(element => element.textContent || ""), 30),
      headingLevelSkips: headingLevelSkips(document),
      visibleQuestionCount: visibleQuestionCount(document),
      structuredDataTypes: unique(structuredTypes, 40),
      structuredDataErrors,
      entityNames: unique(entityNames, 30),
      authorSignals: unique(authorSignals, 20),
      credentialSignals,
      dateSignals: unique(dateSignals, 20),
      trustLinks: unique(trustLinks, 20),
      internalLinkCount: unique(internalUrls, 500).length,
      externalCitationCount,
      semanticLandmarks,
      jsShellRisk: bodyText.length < 200 && document.scripts.length >= 4,
      loadTimeMs: result.durationMs,
    },
    internalUrls: unique(internalUrls, 500),
  }
}
