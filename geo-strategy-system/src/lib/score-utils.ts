import type {
  IndustryShareItem,
  ModelKey,
  PenetrationAggregated,
  PenetrationByModel,
  PerModelRate,
} from "@/types"
import { isPlatformName } from "@/lib/platform-blacklist"

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "")
}

// 宽松匹配：把空格/大小写差异都抹掉后，任一方包含另一方即视为同一品牌
// 例：用户填 "势途"、模型返回 "势途GEO" / "势途 GEO" → 都识别为我方
export function isSameBrand(a: string, b: string): boolean {
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return false
  if (na === nb) return true
  // 仅当较短串长度 >= 2 时启用包含匹配，避免 1 个汉字误命中
  const shorter = na.length <= nb.length ? na : nb
  const longer = na.length <= nb.length ? nb : na
  return shorter.length >= 2 && longer.includes(shorter)
}

export function aggregatePenetration(
  byModel: PenetrationByModel,
  ourBrand: string
): PenetrationAggregated {
  // brandCount: normalized key → { displayName, count }
  // displayName 优先用与 ourBrand 匹配的写法；其它品牌取首次出现的原始写法
  const brandCount = new Map<string, { displayName: string; count: number }>()
  const perModelRate: PerModelRate[] = []
  let ourMentions = 0
  let totalSlots = 0

  const mentionedByAnyModel = new Set<string>()
  const allQuestions = new Set<string>()
  const ourKey = norm(ourBrand)

  for (const [model, items] of Object.entries(byModel)) {
    if (!items) continue
    let modelMentions = 0
    for (const it of items) {
      allQuestions.add(it.question)
      totalSlots++
      const cleanBrands = it.mentionedBrands.filter(b => !isPlatformName(b))

      // ★ 命中判定的"唯一真理"来自 route 层的 it.hitOur（基于盲测回答文本的 includes 匹配）。
      // 兼容旧数据（无 hitOur 字段）时，回退到对 mentionedBrands 的同品牌匹配。
      const hitOurInThisSlot =
        typeof it.hitOur === "boolean"
          ? it.hitOur
          : cleanBrands.some(b => isSameBrand(b, ourBrand))
      if (hitOurInThisSlot) {
        ourMentions++
        modelMentions++
        mentionedByAnyModel.add(it.question)
      }

      // 累计 brandCount：我方所有变体合并到 ourKey 下；
      // 同一 slot 内若同时出现 "势途" + "势途GEO" 只算 1 次（按 normalized key 去重）
      const seenInSlot = new Set<string>()
      for (const b of cleanBrands) {
        const raw = b.trim()
        if (!raw) continue
        const isOur = isSameBrand(raw, ourBrand)
        const key = isOur ? ourKey : norm(raw)
        if (!key || seenInSlot.has(key)) continue
        seenInSlot.add(key)
        const prev = brandCount.get(key)
        if (prev) {
          prev.count += 1
        } else {
          brandCount.set(key, {
            displayName: isOur ? ourBrand.trim() || raw : raw,
            count: 1,
          })
        }
      }
    }
    perModelRate.push({
      model: model as ModelKey,
      total: items.length,
      mentions: modelMentions,
      rate: items.length ? modelMentions / items.length : 0,
    })
  }

  const totalMentionsAll = Array.from(brandCount.values()).reduce((s, v) => s + v.count, 0)
  const industryShare: IndustryShareItem[] = Array.from(brandCount.entries())
    .map(([, v]) => ({
      brand: v.displayName,
      count: v.count,
      ratio: totalMentionsAll ? v.count / totalMentionsAll : 0,
    }))
    .sort((a, b) => b.count - a.count)

  const rankingIdx = industryShare.findIndex(s => isSameBrand(s.brand, ourBrand))
  const ourRanking = rankingIdx >= 0 ? rankingIdx + 1 : null

  const missedQuestions = Array.from(allQuestions).filter(q => !mentionedByAnyModel.has(q))

  const topCompetitors = industryShare
    .filter(s => !isSameBrand(s.brand, ourBrand))
    .slice(0, 3)
    .map(s => s.brand)

  return {
    penetrationRate: totalSlots ? ourMentions / totalSlots : 0,
    ourMentions,
    totalSlots,
    industryShare: industryShare.slice(0, 10),
    ourRanking,
    perModelRate,
    missedQuestions,
    topCompetitors,
  }
}

export function parseJsonLoose(raw: string): unknown {
  let s = raw.trim()
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "")
  }
  const first = s.indexOf("{")
  const last = s.lastIndexOf("}")
  if (first >= 0 && last > first) s = s.slice(first, last + 1)
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
