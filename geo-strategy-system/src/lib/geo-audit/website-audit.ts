import "server-only"

import type {
  AnalysisSubjectType,
  GeoAuditPage,
  GeoAuditResource,
  WebsiteGeoAudit,
} from "@/types"
import {
  fetchSafeWebText,
  type SafeWebFetchResult,
} from "@/lib/safe-web-fetch"
import { analyzeAuditPage } from "@/lib/geo-audit/page-analysis"
import {
  parseRobots,
  parseSitemapXml,
  validateLlmsText,
} from "@/lib/geo-audit/resource-parsers"
import { scoreWebsiteAudit } from "@/lib/geo-audit/scoring"

const AUDIT_USER_AGENT = "ShituGeoAuditBot/1.0"
const MAX_AUDIT_PAGES = 10
const HTML_CONTENT_TYPES = /text\/html|application\/xhtml\+xml/i
const SKIP_PATH_PATTERN = /\/(?:api|admin|login|signin|signup|register|cart|checkout|account|search)(?:\/|$)/i
const SKIP_EXTENSION_PATTERN = /\.(?:jpg|jpeg|png|gif|webp|svg|ico|css|js|json|xml|pdf|zip|rar|7z|mp3|mp4|avi|mov|woff2?|ttf|eot)(?:$|\?)/i

interface OptionalFetch {
  result?: SafeWebFetchResult
  error?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "读取失败")
}

function normalizeWebsiteInput(raw: string): string {
  const value = raw.trim()
  if (!value) throw new Error("请填写需要诊断的网站网址")
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

async function fetchOptional(url: string, maxBytes: number, accept: string): Promise<OptionalFetch> {
  try {
    return {
      result: await fetchSafeWebText(url, {
        timeoutMs: 12_000,
        maxBytes,
        userAgent: AUDIT_USER_AGENT,
        accept,
        allowHttpErrors: true,
      }),
    }
  } catch (error) {
    return { error: errorMessage(error) }
  }
}

function sameOriginUrl(raw: string, origin: string): string | null {
  try {
    const url = new URL(raw, origin)
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol)) return null
    if (SKIP_PATH_PATTERN.test(url.pathname) || SKIP_EXTENSION_PATTERN.test(url.pathname)) return null
    url.hash = ""
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_|spm|from|source|ref|share)/i.test(key)) url.searchParams.delete(key)
    }
    return url.toString()
  } catch {
    return null
  }
}

function urlPriority(raw: string): number {
  const path = new URL(raw).pathname.toLowerCase()
  const groups = [
    { pattern: /about|company|brand|profile|关于|企业|品牌/, score: 100 },
    { pattern: /service|product|solution|business|服务|产品|方案|业务/, score: 90 },
    { pattern: /faq|help|question|support|问答|帮助|常见问题/, score: 85 },
    { pattern: /case|customer|project|案例|客户/, score: 75 },
    { pattern: /author|team|expert|doctor|lawyer|团队|专家|医生|律师/, score: 70 },
    { pattern: /contact|联系/, score: 65 },
    { pattern: /blog|news|article|insight|knowledge|新闻|文章|资讯|知识/, score: 55 },
  ]
  const matched = groups.find(group => group.pattern.test(path))?.score || 20
  const depth = path.split("/").filter(Boolean).length
  return matched - Math.max(0, depth - 2) * 3
}

function selectRepresentativeUrls(
  candidates: string[],
  origin: string,
  homepageUrl: string,
  limit: number,
): string[] {
  const homepagePath = new URL(homepageUrl).pathname.replace(/\/+$/, "") || "/"
  const unique = new Map<string, string>()
  for (const candidate of candidates) {
    const normalized = sameOriginUrl(candidate, origin)
    if (!normalized) continue
    const url = new URL(normalized)
    const key = `${url.pathname.replace(/\/+$/, "") || "/"}${url.search}`
    if (key === homepagePath) continue
    if (!unique.has(key)) unique.set(key, normalized)
  }
  return Array.from(unique.values())
    .sort((a, b) => urlPriority(b) - urlPriority(a))
    .slice(0, limit)
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length)
  let cursor = 0
  async function run(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      output[index] = await worker(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => run()))
  return output
}

function failedPage(url: string, error: unknown): GeoAuditPage {
  return {
    url,
    finalUrl: url,
    status: 0,
    title: "",
    description: "",
    language: "",
    canonical: "",
    robotsMeta: "",
    xRobotsTag: "",
    wordCount: 0,
    textLength: 0,
    leadText: "",
    h1: [],
    h2: [],
    h3: [],
    headingLevelSkips: 0,
    visibleQuestionCount: 0,
    structuredDataTypes: [],
    structuredDataErrors: 0,
    entityNames: [],
    authorSignals: [],
    credentialSignals: [],
    dateSignals: [],
    trustLinks: [],
    internalLinkCount: 0,
    externalCitationCount: 0,
    semanticLandmarks: [],
    jsShellRisk: false,
    loadTimeMs: 0,
    error: errorMessage(error),
  }
}

async function readSitemaps(
  candidates: string[],
  origin: string,
): Promise<{ resource: GeoAuditResource; pageUrls: string[] }> {
  const normalizedCandidates = Array.from(new Set(
    candidates
      .map(candidate => {
        try {
          return new URL(candidate, origin).toString()
        } catch {
          return ""
        }
      })
      .filter(Boolean),
  )).slice(0, 3)
  const pageUrls: string[] = []
  const errors: string[] = []
  let firstStatus: number | undefined
  let firstUrl = normalizedCandidates[0] || new URL("/sitemap.xml", origin).toString()
  let anyAvailable = false
  let anyValid = false
  const childSitemaps: string[] = []

  const fetched = await mapWithConcurrency(normalizedCandidates, 2, async url => {
    const response = await fetchOptional(url, 1_500_000, "application/xml,text/xml,text/plain;q=0.9,*/*;q=0.5")
    return { url, response }
  })
  for (const item of fetched) {
    if (!firstStatus && item.response.result) {
      firstStatus = item.response.result.status
      firstUrl = item.response.result.finalUrl
    }
    if (!item.response.result?.ok) {
      errors.push(`${item.url}：${item.response.error || `HTTP ${item.response.result?.status || 0}`}`)
      continue
    }
    anyAvailable = true
    const parsed = parseSitemapXml(item.response.result.text)
    anyValid ||= parsed.valid
    pageUrls.push(...parsed.pageUrls)
    childSitemaps.push(...parsed.sitemapUrls)
  }

  if (pageUrls.length === 0 && childSitemaps.length > 0) {
    const childFetched = await mapWithConcurrency(childSitemaps.slice(0, 3), 2, async url => ({
      url,
      response: await fetchOptional(url, 1_500_000, "application/xml,text/xml,text/plain;q=0.9,*/*;q=0.5"),
    }))
    for (const item of childFetched) {
      if (!item.response.result?.ok) {
        errors.push(`${item.url}：${item.response.error || `HTTP ${item.response.result?.status || 0}`}`)
        continue
      }
      const parsed = parseSitemapXml(item.response.result.text)
      anyValid ||= parsed.valid
      pageUrls.push(...parsed.pageUrls)
    }
  }

  const uniquePages = Array.from(new Set(pageUrls)).slice(0, 10_000)
  return {
    resource: {
      kind: "sitemap",
      url: firstUrl,
      status: firstStatus,
      available: anyAvailable,
      valid: anyValid,
      summary: anyValid
        ? `Sitemap 格式有效，发现 ${uniquePages.length} 个页面网址。`
        : anyAvailable
          ? "Sitemap 可以读取，但 XML 格式无效。"
          : "未发现可读取的 Sitemap。",
      ...(errors.length > 0 ? { error: errors.slice(0, 3).join("；") } : {}),
    },
    pageUrls: uniquePages,
  }
}

export async function auditWebsite(args: {
  website: string
  expectedEntityName: string
  subjectType: AnalysisSubjectType
  maxPages?: number
}): Promise<WebsiteGeoAudit> {
  const startedAt = Date.now()
  const requestUrl = normalizeWebsiteInput(args.website)
  const homepageResult = await fetchSafeWebText(requestUrl, {
    timeoutMs: 18_000,
    maxBytes: 2_500_000,
    userAgent: AUDIT_USER_AGENT,
    allowedContentTypes: HTML_CONTENT_TYPES,
    allowHttpErrors: true,
  })
  const homepageAnalysis = analyzeAuditPage(homepageResult)
  const homepage = homepageAnalysis.page
  const origin = new URL(homepageResult.finalUrl).origin
  const robotsUrl = new URL("/robots.txt", origin).toString()
  const llmsUrl = new URL("/llms.txt", origin).toString()

  const [robotsFetch, llmsFetch] = await Promise.all([
    fetchOptional(robotsUrl, 500_000, "text/plain,text/*;q=0.9,*/*;q=0.5"),
    fetchOptional(llmsUrl, 1_000_000, "text/markdown,text/plain,text/*;q=0.9,*/*;q=0.5"),
  ])

  const robotsAvailability = robotsFetch.result?.status === 404
    ? "missing"
    : robotsFetch.result?.ok
      ? "available"
      : "unknown"
  const parsedRobots = parseRobots(
    robotsUrl,
    robotsFetch.result?.text || "",
    homepage.finalUrl,
    robotsAvailability,
  )
  const robotsResource: GeoAuditResource = {
    kind: "robots",
    url: robotsFetch.result?.finalUrl || robotsUrl,
    status: robotsFetch.result?.status,
    available: robotsAvailability === "available",
    valid: robotsAvailability !== "unknown",
    summary: robotsAvailability === "available"
      ? "robots.txt 可以读取，已分别检查通用规则与各 AI 爬虫规则。"
      : robotsAvailability === "missing"
        ? "未设置 robots.txt，按协议默认允许访问，但缺少明确的爬虫管理规则。"
        : "robots.txt 无法读取，当前访问规则无法确认。",
    ...(robotsFetch.error ? { error: robotsFetch.error } : {}),
  }

  const llmsValidation = llmsFetch.result?.ok
    ? validateLlmsText(llmsFetch.result.text)
    : { valid: false, summary: "未发现可读取的 /llms.txt。" }
  const llmsResource: GeoAuditResource = {
    kind: "llms",
    url: llmsFetch.result?.finalUrl || llmsUrl,
    status: llmsFetch.result?.status,
    available: Boolean(llmsFetch.result?.ok),
    valid: llmsValidation.valid,
    summary: llmsValidation.summary,
    ...(llmsFetch.error ? { error: llmsFetch.error } : {}),
  }

  const sitemapCandidates = [
    ...parsedRobots.sitemapUrls,
    new URL("/sitemap.xml", origin).toString(),
  ]
  const sitemap = await readSitemaps(sitemapCandidates, origin)
  const maxPages = Math.max(1, Math.min(15, Math.round(args.maxPages || MAX_AUDIT_PAGES)))
  const candidateUrls = selectRepresentativeUrls(
    [...sitemap.pageUrls, ...homepageAnalysis.internalUrls],
    origin,
    homepage.finalUrl,
    maxPages - 1,
  ).filter(url => parsedRobots.isAllowed(url))

  const additionalPages = await mapWithConcurrency(candidateUrls, 3, async url => {
    try {
      const result = await fetchSafeWebText(url, {
        timeoutMs: 15_000,
        maxBytes: 2_000_000,
        userAgent: AUDIT_USER_AGENT,
        allowedContentTypes: HTML_CONTENT_TYPES,
        allowHttpErrors: true,
      })
      return analyzeAuditPage(result).page
    } catch (error) {
      return failedPage(url, error)
    }
  })
  const pages = [homepage, ...additionalPages]
  const resources = [robotsResource, sitemap.resource, llmsResource]
  const scored = scoreWebsiteAudit({
    expectedEntityName: args.expectedEntityName,
    pages,
    resources,
    botPolicies: parsedRobots.policies,
  })
  const pagesFetched = pages.filter(page => !page.error && page.status >= 200 && page.status < 300).length
  const confidence = pagesFetched >= 8 ? "high" : pagesFetched >= 3 ? "medium" : "low"
  const confidenceLabel = confidence === "high"
    ? "高：已覆盖多个代表页面"
    : confidence === "medium"
      ? "中：已覆盖部分代表页面"
      : "低：可读取样本较少，请先修复访问或站内发现问题"

  return {
    version: 2,
    requestUrl,
    finalUrl: homepage.finalUrl,
    auditedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    pagesRequested: pages.length,
    pagesFetched,
    confidence,
    confidenceLabel,
    resources,
    botPolicies: parsedRobots.policies,
    pages,
    checks: scored.checks,
    dimensions: scored.dimensions,
    score: scored.score,
    aiSummary: scored.summary,
  }
}
