import type { ModelKey, PenetrationByModel } from "@/types"
import { isSameBrand } from "@/lib/score-utils"
import { isPlatformName } from "@/lib/platform-blacklist"

export interface BrandVoiceItem {
  rank: number
  brand: string
  mentions: number
  ratio: number
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

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/[\s　]+/g, "")
}

// 把一个 slot 里的 mentionedBrands 去重后返回（去掉平台/渠道、空字符串和过短串），
// 并把"我方品牌"的多种变体归一到 ourBrand 字面，以便上层用稳定 key 累加。
function extractValidBrands(
  brands: string[],
  ourBrand: string,
): Array<{ key: string; display: string; isOur: boolean }> {
  const out: Array<{ key: string; display: string; isOur: boolean }> = []
  const seen = new Set<string>()
  for (const raw of brands) {
    const b = (raw ?? "").trim()
    if (!b || isPlatformName(b)) continue
    const isOur = !!ourBrand && isSameBrand(b, ourBrand)
    const key = isOur ? `__our__:${norm(ourBrand)}` : norm(b)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ key, display: isOur ? ourBrand.trim() || b : b, isOur })
  }
  return out
}

export function computeBrandVoice(
  byModel: PenetrationByModel,
  ourBrand: string,
): BrandVoiceItem[] {
  // brandKey → { display, mentions, modelSet }
  const acc = new Map<
    string,
    { display: string; mentions: number; models: Set<ModelKey>; isOur: boolean }
  >()

  for (const [model, items] of Object.entries(byModel)) {
    if (!items) continue
    const mk = model as ModelKey
    for (const slot of items) {
      const cleaned = extractValidBrands(slot.mentionedBrands, ourBrand)
      for (const b of cleaned) {
        const prev = acc.get(b.key)
        if (prev) {
          prev.mentions += 1
          prev.models.add(mk)
          // 我方品牌优先采用最初登记的 display（即 ourBrand 字面）
          if (!prev.isOur && b.isOur) {
            prev.display = b.display
            prev.isOur = true
          }
        } else {
          acc.set(b.key, {
            display: b.display,
            mentions: 1,
            models: new Set([mk]),
            isOur: b.isOur,
          })
        }
      }
    }
  }

  const totalMentions = Array.from(acc.values()).reduce((s, v) => s + v.mentions, 0)
  const list = Array.from(acc.values())
    .map(v => ({
      brand: v.display,
      mentions: v.mentions,
      ratio: totalMentions > 0 ? v.mentions / totalMentions : 0,
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
): KeywordCompetitionItem[] {
  // question → per-model brand-mention count
  const agg = new Map<
    string,
    { perModel: Partial<Record<ModelKey, number>>; total: number }
  >()

  for (const [model, items] of Object.entries(byModel)) {
    if (!items) continue
    const mk = model as ModelKey
    for (const slot of items) {
      // 拒答 / 空回答 视为"该模型未参与"，提及计数为 0
      const validBrands = slot.mentionedBrands.filter(b => !isPlatformName(b) && b.trim())
      const count = validBrands.length

      const cur = agg.get(slot.question) ?? { perModel: {}, total: 0 }
      // 同一 (model, question) 可能因后端去重已合并；累加为安全做法
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
