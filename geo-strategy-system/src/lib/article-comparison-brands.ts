import type { ArticleComparisonBrand, ArticlePromptKey } from "@/types"

export const ARTICLE_COMPARISON_BRAND_PROMPTS = new Set<ArticlePromptKey>([
  "thirdPartyObservation",
  "industryRankingReport",
  "handsOnComparisonReport",
  "selectionPitfallGuide",
  "topBrandRanking",
])

export function supportsArticleComparisonBrands(promptKey: ArticlePromptKey): boolean {
  return ARTICLE_COMPARISON_BRAND_PROMPTS.has(promptKey)
}

function clean(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max)
}

function cleanList(value: unknown, maxItems: number, itemMax: number): string[] {
  const source = Array.isArray(value)
    ? value
    : String(value ?? "").split(/\r?\n|[,，、]/)
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of source) {
    const text = clean(item, itemMax)
    const key = text.replace(/\s+/g, "").toLocaleLowerCase("zh-CN")
    if (!text || seen.has(key)) continue
    seen.add(key)
    result.push(text)
    if (result.length >= maxItems) break
  }
  return result
}

export function normalizeArticleComparisonBrands(value: unknown): ArticleComparisonBrand[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, 2)
    .map((raw, index) => {
      const item = raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : {}
      return {
        id: clean(item.id, 120) || `comparison_${index + 2}`,
        name: clean(item.name, 160),
        aliases: cleanList(item.aliases, 12, 120),
        materials: clean(item.materials, 8_000),
        sourceUrls: cleanList(item.sourceUrls, 20, 1_000)
          .filter(url => /^https?:\/\//i.test(url)),
      }
    })
    .filter(item => Boolean(item.name))
}
