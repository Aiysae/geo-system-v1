import type { PenetrationSource } from "@/types"

export function normalizeSourceDomain(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "")
    return host || "unknown"
  } catch {
    return "unknown"
  }
}

function cleanUrl(raw: string): string | null {
  const trimmed = raw
    .trim()
    .replace(/[)\]}>，。；;、"'`]+$/g, "")
    .replace(/^[(<[{，。；;、"'`]+/g, "")
  if (!/^https?:\/\//i.test(trimmed)) return null
  try {
    return new URL(trimmed).toString()
  } catch {
    return null
  }
}

const STATIC_ASSET_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".bmp",
  ".avif",
  ".heic",
  ".mp4",
  ".mov",
  ".webm",
  ".mp3",
  ".wav",
  ".m4a",
  ".m3u8",
  ".css",
  ".js",
  ".map",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
])

const IMAGE_CDN_HOST_PATTERNS = [
  /(^|\.)qpic\.cn$/,
  /(^|\.)gtimg\.com$/,
  /^n\.sinaimg\.cn$/,
  /^p\d*\.itc\.cn$/,
  /^(?:ss|t|img|pic)\d*\.baidu\.com$/,
  /(^|\.)bdimg\.com$/,
  /(^|\.)bdstatic\.com$/,
  /(^|\.)alicdn\.com$/,
  /(^|\.)aliyuncs\.com$/,
]

function pathExt(pathname: string): string {
  const match = pathname.toLowerCase().match(/\.[a-z0-9]{2,6}$/)
  return match?.[0] || ""
}

function textKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
}

function titleLooksWeak(title: string, parsed: URL): boolean {
  const trimmed = title.trim()
  if (!trimmed) return true
  const hostKey = textKey(parsed.hostname)
  const titleKey = textKey(trimmed)
  if (!titleKey) return true
  return titleKey === hostKey || titleKey === textKey(parsed.hostname.replace(/^www\./, ""))
}

function hasReadablePath(parsed: URL): boolean {
  const parts = parsed.pathname.split("/").filter(Boolean)
  if (parts.length >= 2) return true
  const last = parts[0] || ""
  return /[a-z0-9]{8,}/i.test(last) || /[\u4e00-\u9fa5]{4,}/.test(decodeURIComponent(last))
}

function fallbackTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const last = parsed.pathname.split("/").filter(Boolean).pop() || ""
    const decoded = decodeURIComponent(last)
      .replace(/\.[a-z0-9]{2,6}$/i, "")
      .replace(/[-_]+/g, " ")
      .trim()
    return decoded.length >= 4 ? decoded.slice(0, 80) : ""
  } catch {
    return ""
  }
}

export function isAuditableSourceUrl(rawUrl: string, title = "", snippet = ""): boolean {
  const clean = cleanUrl(rawUrl)
  if (!clean) return false

  let parsed: URL
  try {
    parsed = new URL(clean)
  } catch {
    return false
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "")
  const pathname = decodeURIComponent(parsed.pathname || "/").toLowerCase()
  const ext = pathExt(pathname)
  if (STATIC_ASSET_EXTENSIONS.has(ext)) return false
  if (IMAGE_CDN_HOST_PATTERNS.some(pattern => pattern.test(host))) return false
  if (/(^|[?&])(x-oss-process|imageview2?|resize|thumbnail|watermark)=/i.test(parsed.search)) {
    return false
  }

  const weakTitle = titleLooksWeak(title, parsed)
  const hasSnippet = snippet.trim().length >= 12
  const rootOnly = pathname === "/" || pathname === ""
  if (rootOnly && weakTitle && !hasSnippet) return false

  const staticPath = /(^|\/)(static|assets?|images?|imgs?|pics?|logos?|icons?|avatars?|upload|uploads|media|file|files)(\/|$)/i.test(pathname)
  if (staticPath && weakTitle && !hasSnippet) return false

  if (!hasReadablePath(parsed) && weakTitle && !hasSnippet) return false
  return true
}

function findUrlStrings(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s"'<>]+/g) ?? []
  return matches.map(x => cleanUrl(x)).filter((x): x is string => !!x)
}

function firstString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

function pushSource(
  out: PenetrationSource[],
  query: string,
  url: string,
  title = "",
  snippet = ""
) {
  const clean = cleanUrl(url)
  if (!clean) return
  if (!isAuditableSourceUrl(clean, title, snippet)) return
  const displayTitle = title.trim() || fallbackTitleFromUrl(clean) || normalizeSourceDomain(clean)
  out.push({
    title: displayTitle,
    snippet,
    url: clean,
    domain: normalizeSourceDomain(clean),
    query,
  })
}

export function dedupePenetrationSources(sources: PenetrationSource[]): PenetrationSource[] {
  const seen = new Set<string>()
  const out: PenetrationSource[] = []
  for (const source of sources) {
    const key = source.url
    if (seen.has(key)) continue
    seen.add(key)
    out.push(source)
  }
  return out
}

export function extractSourcesFromUnknown(payload: unknown, query: string): PenetrationSource[] {
  const out: PenetrationSource[] = []
  const seenObjects = new WeakSet<object>()

  function walk(value: unknown, depth: number) {
    if (depth > 8 || value == null) return
    if (typeof value === "string") {
      for (const url of findUrlStrings(value)) pushSource(out, query, url)
      return
    }
    if (typeof value !== "object") return
    if (seenObjects.has(value)) return
    seenObjects.add(value)

    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)
      return
    }

    const obj = value as Record<string, unknown>
    const title = firstString(obj, ["title", "name", "site_name", "source_name", "hostname"])
    const snippet = firstString(obj, ["snippet", "summary", "description", "content", "text"])
    for (const key of [
      "url",
      "link",
      "href",
      "source_url",
      "citation_url",
      "site_url",
      "reference_url",
    ]) {
      const maybeUrl = obj[key]
      if (typeof maybeUrl === "string") pushSource(out, query, maybeUrl, title, snippet)
    }

    for (const item of Object.values(obj)) walk(item, depth + 1)
  }

  walk(payload, 0)
  return dedupePenetrationSources(out)
}
