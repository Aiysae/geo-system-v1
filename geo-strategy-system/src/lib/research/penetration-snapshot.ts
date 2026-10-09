type PlainRecord = Record<string, unknown>

function record(value: unknown): PlainRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as PlainRecord
    : {}
}
function text(value: unknown, maximum: number): string {
  return String(value || "").trim().slice(0, maximum)
}

function stringArray(value: unknown, limit: number, maximum: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => text(item, maximum))
    .filter(Boolean)
    .slice(0, limit)
}

function compactIndustryShare(value: unknown): PlainRecord[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 24).map(item => {
    const row = record(item)
    return {
      brand: text(row.brand, 120),
      count: Number(row.count) || 0,
      ratio: Number(row.ratio) || 0,
    }
  }).filter(item => item.brand)
}

function compactPerModelRate(value: unknown): PlainRecord[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 16).map(item => {
    const row = record(item)
    return {
      model: text(row.model, 80),
      rate: Number(row.rate) || 0,
      mentions: Number(row.mentions) || 0,
      total: Number(row.total) || 0,
    }
  }).filter(item => item.model)
}

/**
 * Research only needs a representative, auditable snapshot of penetration data.
 * Raw provider payloads and duplicated source metadata stay in report history.
 */
export function compactResearchPenetrationSnapshot(value: unknown): unknown {
  const source = record(value)
  const aggregated = record(source.aggregated)
  if (Object.keys(aggregated).length === 0) return undefined

  const byModel = record(source.byModel)
  const compactByModel = Object.fromEntries(
    Object.entries(byModel).flatMap(([model, rawItems]) => {
      if (!Array.isArray(rawItems)) return []
      const items = rawItems.slice(0, 8).map(rawItem => {
        const item = record(rawItem)
        return {
          question: text(item.question, 260),
          answer: text(item.answer, 520),
          hitOur: item.hitOur === true,
          mentionedBrands: stringArray(item.mentionedBrands, 20, 120),
        }
      }).filter(item => item.question || item.answer)
      return items.length > 0 ? [[text(model, 80), items] as const] : []
    }),
  )

  return {
    aggregated: {
      penetrationRate: Number(aggregated.penetrationRate) || 0,
      ourMentions: Number(aggregated.ourMentions) || 0,
      totalSlots: Number(aggregated.totalSlots) || 0,
      ourRanking: Number.isFinite(Number(aggregated.ourRanking))
        ? Number(aggregated.ourRanking)
        : null,
      topCompetitors: stringArray(aggregated.topCompetitors, 24, 120),
      missedQuestions: stringArray(aggregated.missedQuestions, 24, 260),
      industryShare: compactIndustryShare(aggregated.industryShare),
      perModelRate: compactPerModelRate(aggregated.perModelRate),
    },
    byModel: compactByModel,
  }
}
