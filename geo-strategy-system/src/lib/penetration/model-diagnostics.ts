import { isPenetrationExtractionUsable } from "@/lib/penetration/entity-extraction"
import type { ModelKey, PenetrationModelStats, PenetrationResult } from "@/types"

export type { PenetrationModelStats }

// Per-model figures that show whether one model's data can be trusted. They
// back both the anomaly alerts and the single-model re-run comparison, and are
// small enough to send on every poll, unlike the answers themselves.

export type PenetrationModelAnomalyCode =
  | "target_rate_high"
  | "target_rate_low"
  | "no_brand_answers"
  | "extraction_failed"
  | "search_declined"
  | "source_concentrated"
  | "short_answers"
  | "few_sources"

export interface PenetrationModelAnomaly {
  model: ModelKey
  code: PenetrationModelAnomalyCode
  title: string
  detail: string
}

const TOP_BRANDS = 5
const TOP_DOMAINS = 5

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function buildPenetrationModelStats(result: PenetrationResult): PenetrationModelStats[] {
  const leading = result.aggregated.industryShare.filter(item => item.perModel).slice(0, TOP_BRANDS)
  return result.aggregated.perModelRate.map(rate => {
    const items = (result.byModel[rate.model] || []).filter(item => item.answer?.trim())
    const recognised = items.filter(item => isPenetrationExtractionUsable(item))
    const domains = new Map<string, number>()
    let sourceCount = 0
    for (const item of items) {
      for (const source of item.searchSources || []) {
        sourceCount += 1
        if (source.domain) domains.set(source.domain, (domains.get(source.domain) || 0) + 1)
      }
    }
    return {
      model: rate.model,
      answers: items.length,
      ourMentions: rate.mentions,
      ourRate: rate.rate,
      noBrandAnswers: recognised.filter(item => (item.mentionedBrands || []).length === 0).length,
      recognisedAnswers: recognised.length,
      extractionFailed: items.length - recognised.length,
      searchDeclined: items.filter(item => item.webSearchDeclined === true).length,
      avgSources: items.length ? sourceCount / items.length : 0,
      medianAnswerLength: median(items.map(item => item.answer.length)),
      topDomains: [...domains.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_DOMAINS)
        .map(([domain, count]) => ({ domain, count })),
      sourceCount,
      topBrands: leading.map(item => {
        const cell = item.perModel?.[rate.model]
        return {
          brand: item.brand,
          mentions: cell?.mentions ?? 0,
          rate: cell && cell.total > 0 ? cell.mentions / cell.total : 0,
        }
      }),
    }
  })
}

/**
 * Flags models whose data looks off, using the patterns traced on real runs:
 * our brand far above the other models (DeepSeek on Baidu-indexed content),
 * answers that name nobody (Kimi stopping mid-search), unread answers, answers
 * given without searching, and sources piled on one site.
 */
export function detectPenetrationModelAnomalies(
  stats: PenetrationModelStats[],
  options: { subjectType?: "brand" | "person" } = {},
): PenetrationModelAnomaly[] {
  const anomalies: PenetrationModelAnomaly[] = []
  const measured = stats.filter(item => item.answers >= 10)

  for (const item of measured) {
    const others = measured.filter(other => other.model !== item.model).map(other => other.ourRate)
    if (others.length >= 2) {
      const typical = median(others)
      if (item.ourMentions >= 3 && item.ourRate >= Math.max(typical * 3, typical + 0.1)) {
        anomalies.push({
          model: item.model,
          code: "target_rate_high",
          title: "我方提及率明显偏高",
          detail: `${percent(item.ourRate)}，其他模型中位数 ${percent(typical)}。可能是搜索来源偏向我方已发布的内容，建议重新检测核实。`,
        })
      } else if (typical >= 0.15 && item.ourRate <= typical / 3) {
        anomalies.push({
          model: item.model,
          code: "target_rate_low",
          title: "我方提及率明显偏低",
          detail: `${percent(item.ourRate)}，其他模型中位数 ${percent(typical)}。`,
        })
      }
    }

    if (options.subjectType !== "person" && item.recognisedAnswers >= 10
      && item.noBrandAnswers / item.recognisedAnswers >= 0.15) {
      anomalies.push({
        model: item.model,
        code: "no_brand_answers",
        title: "较多回答没有推荐任何公司",
        detail: `${item.noBrandAnswers}/${item.recognisedAnswers} 条回答没提到任何品牌，可能回答不完整。`,
      })
    }
    if (item.extractionFailed / item.answers >= 0.1) {
      anomalies.push({
        model: item.model,
        code: "extraction_failed",
        title: "品牌识别失败较多",
        detail: `${item.extractionFailed}/${item.answers} 条回答没能识别品牌，可点“重新整理品牌榜”或重新检测。`,
      })
    }
    if (item.searchDeclined / item.answers >= 0.2) {
      anomalies.push({
        model: item.model,
        code: "search_declined",
        title: "较多回答没有联网",
        detail: `${item.searchDeclined}/${item.answers} 条回答由模型判断无需联网、直接作答。`,
      })
    }
    const top = item.topDomains[0]
    if (top && item.sourceCount >= 30 && top.count / item.sourceCount >= 0.3) {
      anomalies.push({
        model: item.model,
        code: "source_concentrated",
        title: "来源过于集中",
        detail: `${percent(top.count / item.sourceCount)} 的来源来自 ${top.domain}。`,
      })
    }
    if (item.medianAnswerLength < 300) {
      anomalies.push({
        model: item.model,
        code: "short_answers",
        title: "回答明显偏短",
        detail: `回答长度中位数只有 ${Math.round(item.medianAnswerLength)} 字。`,
      })
    }
    if (item.avgSources < 3) {
      anomalies.push({
        model: item.model,
        code: "few_sources",
        title: "联网来源偏少",
        detail: `平均每条回答只有 ${item.avgSources.toFixed(1)} 条来源。`,
      })
    }
  }
  return anomalies
}
