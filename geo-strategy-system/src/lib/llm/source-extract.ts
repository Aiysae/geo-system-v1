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
  out.push({
    title: title || clean,
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
