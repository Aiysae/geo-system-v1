import type { AnalysisSubjectType, ModelKey, PenetrationByModel } from "@/types"
import {
  collectObservedSubjects,
  createSubjectResolver,
} from "@/lib/subject-canonicalization"
import type { CanonicalBrand } from "@/lib/brand-canonicalization"
import { isPenetrationExtractionUsable } from "@/lib/penetration/entity-extraction"

export interface BrandVoiceItem {
  rank: number
  brand: string
  mentions: number
  ratio: number
  penetrationRate: number
  models: ModelKey[]
  modelCount: number
  isTarget: boolean
}

export interface KeywordCompetitionItem {
  question: string
  totalMentions: number
  participatingModels: number
  perModelMentions: Partial<Record<ModelKey, number>>
}

// 把一个 slot 里的 mentionedBrands 去重后返回（去掉平台/渠道、空字符串和过短串），
// 并把同一主体的多种变体归一到稳定 key，以便上层累加。
function extractValidBrands(
  brands: string[],
  canonicalize: (value: string) => CanonicalBrand | null,
): CanonicalBrand[] {
  const out: CanonicalBrand[] = []
  const seen = new Set<string>()
  for (const raw of brands) {
    const canonical = canonicalize(raw ?? "")
    if (!canonical || seen.has(canonical.key)) continue
    seen.add(canonical.key)
    out.push(canonical)
  }
  return out
}

export function computeBrandVoice(
  byModel: PenetrationByModel,
  ourBrand: string,
  brandAliases: string[] = [],
  competitors: string[] = [],
  subjectType: AnalysisSubjectType = "brand",
): BrandVoiceItem[] {
  const resolver = createSubjectResolver({
    subjectType,
    ourBrand,
    brandAliases,
    competitors,
    observedBrands: collectObservedSubjects(byModel, subjectType),
  })
  // brandKey → { display, mentions, modelSet }
  const acc = new Map<
    string,
    { display: string; mentions: number; models: Set<ModelKey>; isOur: boolean }
  >()

  for (const [model, items] of Object.entries(byModel)) {
    if (!items) continue
    const mk = model as ModelKey
    for (const slot of items) {
      if (!slot.answer?.trim()) continue
      if (!isPenetrationExtractionUsable(slot)) continue
      const cleaned = extractValidBrands(slot.mentionedBrands, resolver.canonicalize)
      for (const b of cleaned) {
        const prev = acc.get(b.key)
        if (prev) {
          prev.mentions += 1
          prev.models.add(mk)
          // 我方品牌优先采用最初登记的 display（即 ourBrand 字面）
          if (!prev.isOur && b.isTarget) {
            prev.display = b.display
            prev.isOur = true
          }
        } else {
          acc.set(b.key, {
            display: b.display,
            mentions: 1,
            models: new Set([mk]),
            isOur: b.isTarget,
          })
        }
      }
    }
  }

  const totalMentions = Array.from(acc.values()).reduce((s, v) => s + v.mentions, 0)
  const totalSlots = Object.values(byModel).reduce(
    (sum, items) => sum + (items?.filter(slot => slot.answer?.trim()).length ?? 0),
    0
  )
  const list = Array.from(acc.values())
    .map(v => ({
      brand: v.display,
      mentions: v.mentions,
      ratio: totalMentions > 0 ? v.mentions / totalMentions : 0,
      penetrationRate: totalSlots > 0 ? v.mentions / totalSlots : 0,
      models: Array.from(v.models),
      modelCount: v.models.size,
      isTarget: v.isOur,
    }))
    .sort((a, b) => {
      if (b.mentions !== a.mentions) return b.mentions - a.mentions
      return b.modelCount - a.modelCount
    })

  return list.map((it, i) => ({ ...it, rank: i + 1 }))
}

export function computeKeywordCompetition(
  byModel: PenetrationByModel,
  ourBrand = "",
  brandAliases: string[] = [],
  competitors: string[] = [],
  subjectType: AnalysisSubjectType = "brand",
): KeywordCompetitionItem[] {
  const resolver = createSubjectResolver({
    subjectType,
    ourBrand,
    brandAliases,
    competitors,
    observedBrands: collectObservedSubjects(byModel, subjectType),
  })
  // question → per-model brand-mention count
  const agg = new Map<
    string,
    { perModel: Partial<Record<ModelKey, number>>; total: number }
  >()

  for (const [model, items] of Object.entries(byModel)) {
    if (!items) continue
    const mk = model as ModelKey
    for (const slot of items) {
      if (!slot.answer?.trim()) continue
      if (!isPenetrationExtractionUsable(slot)) continue
      // 拒答 / 空回答 视为"该模型未参与"，提及计数为 0
      const count = resolver.canonicalizeList(slot.mentionedBrands).length

      const cur = agg.get(slot.question) ?? { perModel: {}, total: 0 }
      // 同题可以独立重复采样，每一份有效原始回答都应参与竞争热度统计。
      cur.perModel[mk] = (cur.perModel[mk] ?? 0) + count
      cur.total += count
      agg.set(slot.question, cur)
    }
  }

  const items: KeywordCompetitionItem[] = []
  for (const [question, v] of agg.entries()) {
    const participatingModels = (Object.keys(v.perModel) as ModelKey[]).filter(
      m => (v.perModel[m] ?? 0) > 0,
    ).length
    // 防呆过滤：0 个模型给出有效品牌回答的"拒答题"直接剔除
    if (participatingModels === 0 || v.total === 0) continue
    items.push({
      question,
      totalMentions: v.total,
      participatingModels,
      perModelMentions: v.perModel,
    })
  }

  return items.sort((a, b) => b.totalMentions - a.totalMentions)
}
