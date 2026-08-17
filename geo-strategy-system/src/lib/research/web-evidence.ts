import "server-only"

import { JSDOM } from "jsdom"
import { fetchSafeWebText, type SafeWebFetchResult } from "@/lib/safe-web-fetch"
import {
  isAuditableSourceUrl,
  normalizeSourceDomain,
} from "@/lib/llm/source-extract"
import { webSearch, type SearchHit } from "@/lib/llm/web-search"
import type {
  AnalysisSubjectType,
  ResearchEvidenceAudit,
  ResearchEvidenceSource,
} from "@/types"

const DEFAULT_MIN_SOURCES = 4
const DEFAULT_MIN_DOMAINS = 2
const DEFAULT_MAX_SOURCES = 12
const DEFAULT_MAX_PER_DOMAIN = 3
const MAX_CANDIDATES = 28
const MAX_EXCERPT_CHARS = 900

const TRACKING_PARAMS = new Set([
  "from",
  "from_source",
  "spm",
  "src",
  "source",
  "track",
  "tracking",
  "utm_campaign",
  "utm_content",
  "utm_medium",
  "utm_source",
  "utm_term",
])

export interface ResearchEvidenceBundle {
  queries: string[]
  sources: ResearchEvidenceSource[]
  audit: ResearchEvidenceAudit
}

interface EvidenceDependencies {
  search?: (query: string, maxResults?: number) => Promise<SearchHit[]>
  fetch?: (
    url: string,
    options?: Parameters<typeof fetchSafeWebText>[1],
  ) => Promise<SafeWebFetchResult>
}

export interface CollectResearchEvidenceOptions extends EvidenceDependencies {
  queries: string[]
  minimumSources?: number
  minimumDomains?: number
  maximumSources?: number
  maximumPerDomain?: number
  signal?: AbortSignal
}

export class ResearchEvidenceError extends Error {
  readonly audit: ResearchEvidenceAudit

  constructor(message: string, audit: ResearchEvidenceAudit) {
    super(message)
    this.name = "ResearchEvidenceError"
    this.audit = audit
  }
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function unique(values: string[], limit: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of values) {
    const value = normalizeSpace(raw)
    const key = value.toLowerCase()
    if (!value || seen.has(key)) continue
    seen.add(key)
    result.push(value.slice(0, 160))
    if (result.length >= limit) break
  }
  return result
}

export function buildResearchSearchQueries(args: {
  subject: string
  aliases?: string[]
  industry?: string
  region?: string
  website?: string
  competitors?: string[]
  hypothesis?: string
  subjectType?: AnalysisSubjectType
}): string[] {
  const subject = normalizeSpace(args.subject)
  const industry = normalizeSpace(args.industry || "")
  const region = normalizeSpace(args.region || "")
  const descriptor = args.subjectType === "person" ? "专业 资质 经历 评价" : "品牌 官网 资质 案例"
  const peer = args.subjectType === "person" ? "同行 专家 推荐" : "竞品 品牌 推荐"
  const competitorNames = (args.competitors || []).slice(0, 3).join(" ")
  const alias = (args.aliases || []).slice(0, 2).join(" ")
  let websiteHost = ""
  try {
    websiteHost = args.website ? new URL(args.website).hostname.replace(/^www\./, "") : ""
  } catch {
    websiteHost = ""
  }

  return unique([
    [subject, alias, industry, region].filter(Boolean).join(" "),
    [subject, industry, descriptor].filter(Boolean).join(" "),
    [subject, industry, "口碑 评价 案例"].filter(Boolean).join(" "),
    [region, industry, peer, competitorNames].filter(Boolean).join(" "),
    websiteHost ? `${subject} site:${websiteHost}` : "",
    args.hypothesis ? [subject, args.hypothesis.slice(0, 72)].join(" ") : "",
  ], 6)
}

export function buildCompetitorSearchQueries(args: {
  subject: string
  competitor: string
  industry?: string
  region?: string
  subjectType?: AnalysisSubjectType
}): string[] {
  const subject = normalizeSpace(args.subject)
  const competitor = normalizeSpace(args.competitor)
  const industry = normalizeSpace(args.industry || "")
  const region = normalizeSpace(args.region || "")
  const descriptor = args.subjectType === "person"
    ? "专业背景 擅长 资质 评价"
    : "品牌 产品 资质 案例"

  return unique([
    [subject, competitor, industry, "对比"].filter(Boolean).join(" "),
    [subject, industry, region, descriptor].filter(Boolean).join(" "),
    [competitor, industry, region, descriptor].filter(Boolean).join(" "),
    [subject, competitor, "口碑 评价 选择"].filter(Boolean).join(" "),
  ], 4)
}

export function canonicalizeEvidenceUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (!/^https?:$/.test(url.protocol)) return null
    url.hash = ""
    for (const key of Array.from(url.searchParams.keys())) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
        url.searchParams.delete(key)
      }
    }
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "")
    return url.toString()
  } catch {
    return null
  }
}

function extractReadablePage(
  result: SafeWebFetchResult,
  fallback: SearchHit,
): { title: string; excerpt: string } | null {
  const dom = new JSDOM(result.text, { url: result.finalUrl })
  const document = dom.window.document
  for (const selector of ["script", "style", "noscript", "svg", "nav", "footer", "form"]) {
    document.querySelectorAll(selector).forEach(node => node.remove())
  }
  const title = normalizeSpace(
    document.querySelector("meta[property='og:title']")?.getAttribute("content")
      || document.querySelector("meta[name='twitter:title']")?.getAttribute("content")
      || document.querySelector("h1")?.textContent
      || document.title
      || fallback.title,
  ).slice(0, 180)
  const description = normalizeSpace(
    document.querySelector("meta[name='description']")?.getAttribute("content")
      || document.querySelector("meta[property='og:description']")?.getAttribute("content")
      || fallback.snippet,
  )
  const bodyText = normalizeSpace(
    document.querySelector("article")?.textContent
      || document.querySelector("main")?.textContent
      || document.body?.textContent
      || "",
  )
  const excerpt = normalizeSpace(
    [description, bodyText.slice(0, 1_800)].filter(Boolean).join(" "),
  ).slice(0, MAX_EXCERPT_CHARS)
  if (title.length < 2 || excerpt.length < 80) return null
  return { title, excerpt }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index], index)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker()),
  )
  return results
}

function roundRobinCandidates(
  results: Array<{ query: string; hits: SearchHit[] }>,
): Array<{ query: string; hit: SearchHit }> {
  const output: Array<{ query: string; hit: SearchHit }> = []
  const seen = new Set<string>()
  const maxLength = Math.max(0, ...results.map(item => item.hits.length))
  for (let index = 0; index < maxLength && output.length < MAX_CANDIDATES; index += 1) {
    for (const result of results) {
      const hit = result.hits[index]
      if (!hit || !isAuditableSourceUrl(hit.url, hit.title, hit.snippet)) continue
      const canonical = canonicalizeEvidenceUrl(hit.url)
      if (!canonical || seen.has(canonical)) continue
      seen.add(canonical)
      output.push({ query: result.query, hit: { ...hit, url: canonical } })
      if (output.length >= MAX_CANDIDATES) break
    }
  }
  return output
}

export async function collectResearchEvidence(
  options: CollectResearchEvidenceOptions,
): Promise<ResearchEvidenceBundle> {
  const queries = unique(options.queries, 8)
  const minimumSources = Math.max(1, options.minimumSources ?? DEFAULT_MIN_SOURCES)
  const minimumDomains = Math.max(1, options.minimumDomains ?? DEFAULT_MIN_DOMAINS)
  const maximumSources = Math.max(minimumSources, options.maximumSources ?? DEFAULT_MAX_SOURCES)
  const maximumPerDomain = Math.max(1, options.maximumPerDomain ?? DEFAULT_MAX_PER_DOMAIN)
  const search = options.search || webSearch
  const safeFetch = options.fetch || fetchSafeWebText
  const searchedAt = new Date().toISOString()
  const warnings: string[] = []

  if (queries.length === 0) {
    const audit: ResearchEvidenceAudit = {
      version: 1,
      searchExecuted: false,
      searchedAt,
      queryCount: 0,
      candidateCount: 0,
      validSourceCount: 0,
      uniqueDomainCount: 0,
      minimumSourceCount: minimumSources,
      minimumDomainCount: minimumDomains,
      passed: false,
      warnings: ["没有可用的联网检索词。"],
    }
    throw new ResearchEvidenceError("无法构造联网调研查询，请补充主体名称或行业信息。", audit)
  }

  const searchResults = await mapWithConcurrency(queries, 2, async query => {
    if (options.signal?.aborted) throw new Error("联网调研已停止。")
    try {
      return { query, hits: await search(query, 10) }
    } catch (error) {
      warnings.push(`检索词「${query.slice(0, 36)}」暂未返回结果。`)
      console.warn("[research-evidence] search failed", query, error)
      return { query, hits: [] }
    }
  })

  const candidates = roundRobinCandidates(searchResults)
  let unreadableCount = 0
  const verified = await mapWithConcurrency(candidates, 4, async candidate => {
    if (options.signal?.aborted) throw new Error("联网调研已停止。")
    try {
      const page = await safeFetch(candidate.hit.url, {
        timeoutMs: 8_000,
        maxBytes: 650_000,
        maxRedirects: 5,
        allowedContentTypes: /text\/html|application\/xhtml\+xml|application\/xml|text\/plain/i,
        signal: options.signal,
      })
      const readable = extractReadablePage(page, candidate.hit)
      if (!readable) {
        unreadableCount += 1
        return null
      }
      const finalUrl = canonicalizeEvidenceUrl(page.finalUrl)
      if (!finalUrl || !isAuditableSourceUrl(finalUrl, readable.title, readable.excerpt)) {
        unreadableCount += 1
        return null
      }
      return {
        query: candidate.query,
        title: readable.title,
        url: finalUrl,
        domain: normalizeSourceDomain(finalUrl),
        excerpt: readable.excerpt,
        fetchedAt: new Date().toISOString(),
        contentType: page.contentType.split(";")[0] || undefined,
      }
    } catch (error) {
      if (options.signal?.aborted) throw error
      unreadableCount += 1
      return null
    }
  })

  const sources: ResearchEvidenceSource[] = []
  const seenUrls = new Set<string>()
  const domainCounts = new Map<string, number>()
  for (const item of verified) {
    if (!item || seenUrls.has(item.url)) continue
    const domainCount = domainCounts.get(item.domain) || 0
    if (domainCount >= maximumPerDomain) continue
    seenUrls.add(item.url)
    domainCounts.set(item.domain, domainCount + 1)
    sources.push({ id: `S${sources.length + 1}`, ...item })
    if (sources.length >= maximumSources) break
  }

  const uniqueDomainCount = new Set(sources.map(source => source.domain)).size
  if (unreadableCount > 0) warnings.push(`${unreadableCount} 个搜索结果无法验证为可读网页，已自动排除。`)
  const passed = sources.length >= minimumSources && uniqueDomainCount >= minimumDomains
  const audit: ResearchEvidenceAudit = {
    version: 1,
    searchExecuted: true,
    searchedAt,
    queryCount: queries.length,
    candidateCount: candidates.length,
    validSourceCount: sources.length,
    uniqueDomainCount,
    minimumSourceCount: minimumSources,
    minimumDomainCount: minimumDomains,
    passed,
    warnings: warnings.length ? warnings.slice(0, 6) : undefined,
  }

  if (!passed) {
    throw new ResearchEvidenceError(
      `联网检索已执行，但仅验证到 ${sources.length} 条可读来源、${uniqueDomainCount} 个独立域名，未达到生成可审计报告的最低标准。请补充更准确的主体全称、行业或地区后重试。`,
      audit,
    )
  }

  return { queries, sources, audit }
}

export function formatResearchEvidenceForModel(bundle: ResearchEvidenceBundle): string {
  return bundle.sources.map(source => [
    `[${source.id}] ${source.title}`,
    `URL: ${source.url}`,
    `检索词: ${source.query}`,
    `网页摘录: ${source.excerpt}`,
  ].join("\n")).join("\n\n")
}
