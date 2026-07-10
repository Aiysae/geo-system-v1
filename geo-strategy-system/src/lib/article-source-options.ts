import { isAuditableSourceUrl, normalizeSourceDomain } from "@/lib/llm/source-extract"
import { MODEL_LABELS } from "@/lib/model-labels"
import type { ModelKey, PenetrationResult, PenetrationSource } from "@/types"

const MODEL_ORDER: ModelKey[] = ["doubao", "deepseek", "qwen", "kimi", "ernie", "hunyuan"]

export interface ArticleSourceOption extends Omit<PenetrationSource, "query"> {
  questions: string[]
}

export interface ArticleSourceDomainGroup {
  domain: string
  sources: ArticleSourceOption[]
}

export interface ArticleSourceModelGroup {
  model: ModelKey
  label: string
  sourceCount: number
  domains: ArticleSourceDomainGroup[]
}

function normalizeWebUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    parsed.hash = ""
    return parsed.toString()
  } catch {
    return null
  }
}

function appendUnique(values: string[], value: string): string[] {
  const nextValue = value.trim()
  if (!nextValue || values.includes(nextValue)) return values
  return [...values, nextValue]
}

export function buildArticleSourceModelGroups(
  penetration?: PenetrationResult,
): ArticleSourceModelGroup[] {
  if (!penetration) return []

  return MODEL_ORDER.flatMap(model => {
    const items = penetration.byModel[model] || []
    const sourcesByUrl = new Map<string, ArticleSourceOption>()

    for (const item of items) {
      for (const source of item.searchSources || []) {
        const title = String(source.title || "").trim()
        const snippet = String(source.snippet || "").trim()
        const question = String(item.question || "").trim()
        const url = normalizeWebUrl(String(source.url || ""))
        if (!url || !isAuditableSourceUrl(url, title, snippet)) continue

        const existing = sourcesByUrl.get(url)
        if (existing) {
          existing.questions = appendUnique(existing.questions, question)
          if (!existing.title && title) existing.title = title
          if (!existing.snippet && snippet) existing.snippet = snippet
          continue
        }

        const domain = normalizeSourceDomain(url)
        sourcesByUrl.set(url, {
          title: title || domain,
          snippet,
          url,
          domain,
          questions: question ? [question] : [],
        })
      }
    }

    if (sourcesByUrl.size === 0) return []

    const sourcesByDomain = new Map<string, ArticleSourceOption[]>()
    for (const source of sourcesByUrl.values()) {
      const sources = sourcesByDomain.get(source.domain) || []
      sources.push(source)
      sourcesByDomain.set(source.domain, sources)
    }

    const domains = Array.from(sourcesByDomain.entries())
      .map(([domain, sources]) => ({ domain, sources }))
      .sort((a, b) => b.sources.length - a.sources.length || a.domain.localeCompare(b.domain))

    return [{
      model,
      label: MODEL_LABELS[model],
      sourceCount: sourcesByUrl.size,
      domains,
    }]
  })
}
