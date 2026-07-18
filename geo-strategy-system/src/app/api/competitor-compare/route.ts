import { NextRequest, NextResponse } from "next/server"
import type {
  AnalysisSubjectType,
  CompetitorCompareResult,
  CompetitorComparison,
} from "@/types"
import { ADAPTERS } from "@/lib/llm"
import { parseJsonStrict } from "@/lib/score-utils"
import {
  formatPersonSubjectContext,
  normalizeAnalysisSubjectType,
  normalizePersonSubjectProfile,
} from "@/lib/analysis-subject"
import {
  authAndReserveCreditsForRequest,
  refundReservedCreditsQuietly,
  settleReservedCredits,
  type CreditReservation,
} from "@/lib/with-credits"
import { estimateFeatureCredits, getFeaturePrice } from "@/lib/pricing"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

function list(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => String(item ?? "").trim()).filter(Boolean).slice(0, limit)
}

function text(value: unknown, fallback = ""): string {
  const s = String(value ?? "").trim()
  return s || fallback
}

function buildPenetrationContext(
  penetration: unknown,
  ourBrand: string,
  selectedCompetitors: string[],
  subjectType: AnalysisSubjectType,
): string {
  if (!penetration || typeof penetration !== "object") return "暂无疑问句检测数据。"
  const p = penetration as {
    aggregated?: {
      penetrationRate?: number
      ourMentions?: number
      totalSlots?: number
      ourRanking?: number | null
      topCompetitors?: string[]
      industryShare?: Array<{ brand?: string; count?: number; ratio?: number }>
      missedQuestions?: string[]
    }
    byModel?: Record<string, Array<{ question?: string; answer?: string; hitOur?: boolean; mentionedBrands?: string[] }>>
  }
  const agg = p.aggregated
  const isPerson = subjectType === "person"
  const selectedSet = new Set(selectedCompetitors.map(item => item.trim()).filter(Boolean))
  const relevantAnswers = Object.entries(p.byModel ?? {})
    .flatMap(([model, items]) =>
      (items ?? [])
        .filter(item => {
          const answer = `${item.answer || ""}${(item.mentionedBrands || []).join(" ")}`
          return answer.includes(ourBrand) || Array.from(selectedSet).some(competitor => answer.includes(competitor))
        })
        .slice(0, 4)
        .map(item => ({
          model,
          question: item.question || "",
          answer: (item.answer || "").slice(0, 360),
          hitOur: item.hitOur === true,
          brands: (item.mentionedBrands || []).join("、"),
        }))
    )
    .slice(0, 12)

  return `【疑问句检测摘要】
- ${isPerson ? "目标人物可见率" : "我方渗透率"}：${typeof agg?.penetrationRate === "number" ? `${(agg.penetrationRate * 100).toFixed(1)}%` : "未知"}（${agg?.ourMentions ?? 0}/${agg?.totalSlots ?? 0}）
- ${isPerson ? "同行人物排位" : "我方行业排位"}：${agg?.ourRanking ? `第 ${agg.ourRanking} 名` : "未上榜"}
- Top ${isPerson ? "同行人物" : "竞品"}：${(agg?.topCompetitors || []).join("、") || "暂无"}
- ${isPerson ? "人物可见度" : "行业占有率"}：${(agg?.industryShare || []).slice(0, 10).map(item => `${item.brand}(${item.count})`).join("、") || "暂无"}
- 未命中疑问句：${(agg?.missedQuestions || []).slice(0, 8).join("；") || "暂无"}

【与目标${isPerson ? "人物或所选同行" : "品牌或所选竞品"}相关的 AI 回答样本】
${relevantAnswers.map((item, i) => `${i + 1}. [${item.model}] ${item.hitOur ? "命中目标" : "未命中目标"}｜提及：${item.brands || "无"}｜问：${item.question}｜答：${item.answer}`).join("\n") || "暂无直接相关样本，请基于检测摘要和公开信息保守分析。"}`
}

function buildPrompt(args: {
  ourBrand: string
  competitor: string
  industry: string
  website: string
  competitors: string[]
  penetrationContext: string
  subjectType: AnalysisSubjectType
  personProfileContext: string
}): { system: string; user: string } {
  const isPerson = args.subjectType === "person"
  const targetNoun = isPerson ? "目标人物" : "我方品牌"
  const competitorNoun = isPerson ? "同行人物" : "竞品"
  const system = `你是一个做 GEO ${isPerson ? "个人 IP 同行定位" : "竞品攻防"}的资深策略顾问。你需要站在豆包模型视角，分析"用户问行业问题时，为什么模型更可能推荐${targetNoun}/${competitorNoun}"，并给出可执行的优劣势对比报告。

【分析要求】
1. 必须区分：事实优势、模型心智优势、信源优势、表达优势、内容覆盖优势。
2. 不确定的地方写成"证据不足"，不要编造客户案例、价格、资质。
3. 每条优劣势必须具体到可以指导官网内容、第三方测评、问答文章、替代品对比页的建设。
${isPerson ? "4. 只比较具名人物的专业领域、公开信任资产、内容覆盖和模型心智；医院、律所、公司、学校等机构只能作为人物背景，不得当作同行人物。不得编造履历、职称、资质或案例。" : ""}

【输出格式 — 严格 JSON，禁止 markdown 包裹、禁止额外文字】
{
  "competitor": "${competitorNoun}姓名或名称",
  "positioningSummary": "120-180 字，说明${targetNoun}与该${competitorNoun}在豆包心智里的相对位置",
  "ourAdvantages": ["${targetNoun}相对该${competitorNoun}的优势，3-6 条"],
  "competitorAdvantages": ["该${competitorNoun}相对${targetNoun}的优势，3-6 条"],
  "ourWeaknesses": ["${targetNoun}面对该${competitorNoun}时暴露的短板，3-6 条"],
  "competitorWeaknesses": ["该${competitorNoun}短板，3-6 条"],
  "differentiators": ["最应该放大的差异化叙事，3-6 条"],
  "userChoiceDrivers": ["用户在两者之间选择时的关键决策因素，3-6 条"],
  "contentActions": ["针对该竞品的内容/信源打法，4-8 条"]
}`

  const user = `请生成${targetNoun}与指定${competitorNoun}的优劣势对比报告：

${targetNoun}：${args.ourBrand}
指定${competitorNoun}：${args.competitor}
行业：${args.industry || "未指定"}
官网：${args.website || "未提供"}
其它已知${competitorNoun}：${args.competitors.filter(c => c !== args.competitor).join("、") || "无"}
${isPerson ? `\n【目标人物身份资料】\n${args.personProfileContext}` : ""}

${args.penetrationContext}`

  return { system, user }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function comparisonPayload(parsed: unknown): Record<string, unknown> {
  const data = record(parsed)
  if (Array.isArray(data.comparisons) && data.comparisons.length > 0) {
    return record(data.comparisons[0])
  }
  return data
}

function normalizeComparison(parsed: unknown, fallbackCompetitor: string): CompetitorComparison {
  const data = comparisonPayload(parsed)
  return {
    competitor: text(data.competitor, fallbackCompetitor),
    positioningSummary: text(data.positioningSummary),
    ourAdvantages: list(data.ourAdvantages, 7),
    competitorAdvantages: list(data.competitorAdvantages, 7),
    ourWeaknesses: list(data.ourWeaknesses, 7),
    competitorWeaknesses: list(data.competitorWeaknesses, 6),
    differentiators: list(data.differentiators, 7),
    userChoiceDrivers: list(data.userChoiceDrivers, 7),
    contentActions: list(data.contentActions, 10),
  }
}

function isUsableComparison(comparison: CompetitorComparison): boolean {
  const detailCount = [
    comparison.ourAdvantages,
    comparison.competitorAdvantages,
    comparison.ourWeaknesses,
    comparison.competitorWeaknesses,
    comparison.differentiators,
    comparison.userChoiceDrivers,
    comparison.contentActions,
  ].reduce((total, items) => total + items.length, 0)
  return comparison.positioningSummary.length >= 20 && detailCount >= 8
}

function summarizeWeaknesses(comparisons: CompetitorComparison[]): string[] {
  const summary: string[] = []
  const seen = new Set<string>()
  const maxItems = Math.max(0, ...comparisons.map(item => item.ourWeaknesses.length))

  for (let index = 0; index < maxItems && summary.length < 10; index++) {
    for (const comparison of comparisons) {
      const weakness = comparison.ourWeaknesses[index]?.trim()
      const key = weakness?.replace(/\s+/g, "").toLowerCase()
      if (!weakness || !key || seen.has(key)) continue
      seen.add(key)
      summary.push(weakness)
      if (summary.length >= 10) break
    }
  }
  return summary
}

function normalize(comparisons: CompetitorComparison[], selectedCompetitors: string[]): CompetitorCompareResult {
  const first = comparisons[0] || normalizeComparison({}, selectedCompetitors[0] || "竞品")
  return {
    ...first,
    selectedCompetitors,
    comparisons,
    ourWeaknessSummary: summarizeWeaknesses(comparisons),
    generatedAt: new Date().toISOString(),
  }
}

async function generateComparison(args: {
  ourBrand: string
  competitor: string
  industry: string
  website: string
  competitors: string[]
  penetrationContext: string
  subjectType: AnalysisSubjectType
  personProfileContext: string
}): Promise<CompetitorComparison> {
  const { system, user } = buildPrompt(args)

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await ADAPTERS.doubao.chat({
      system: attempt === 0
        ? system
        : `${system}\n\n上一次输出无法解析或字段不完整。请只输出一个完整 JSON 对象，并确保所有数组和引号正确闭合。`,
      user,
      temperature: attempt === 0 ? 0.35 : 0.2,
      maxTokens: 3072,
      jsonMode: true,
      mode: "judge",
      allowWebSearch: false,
      timeoutSec: 150,
    })

    try {
      const parsed = parseJsonStrict<unknown>(raw, `豆包竞品对比（${args.competitor}）`)
      const comparison = normalizeComparison(parsed, args.competitor)
      if (!isUsableComparison(comparison)) {
        throw new Error("返回字段不完整")
      }
      return comparison
    } catch (error) {
      console.warn(
        `[competitor-compare] ${args.competitor} 第 ${attempt + 1} 次结构化输出无效：`,
        error instanceof Error ? error.message : error
      )
    }
  }

  throw new Error(`豆包生成「${args.competitor}」对比时返回的数据格式不完整，自动重试后仍未恢复`)
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  )
  return results
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "")
  if (/failed to fetch|fetch failed|networkerror|api 连接失败/i.test(message)) {
    return "豆包服务连接失败，可能是网络波动或上游服务暂时不可用，请稍后重试。"
  }
  if (/timeout|timed out|超时|abort/i.test(message)) {
    return "豆包响应超时，请减少同时对比的竞品数量后重试，或检查后台模型超时设置。"
  }
  if (/http 429|rate.?limit|请求触发限流/i.test(message)) {
    return "豆包请求过于频繁，请稍后再试。"
  }
  if (/无法解析为 json|返回的数据格式不完整|返回字段不完整/i.test(message)) {
    return "豆包返回的数据格式不完整，系统自动重试后仍未恢复，请重新生成。"
  }
  return message || "服务器错误"
}

async function handler(req: NextRequest) {
  let reservation: CreditReservation | null = null
  try {
    const body = await req.json()
    const ourBrand = String(body.ourBrand || "").trim()
    const rawSelectedCompetitors: string[] = Array.isArray(body.selectedCompetitors)
      ? body.selectedCompetitors.map((s: unknown) => String(s).trim()).filter(Boolean)
      : [String(body.competitor || "").trim()].filter(Boolean)
    const selectedCompetitors = rawSelectedCompetitors.slice(0, 5)
    const industry = String(body.industry || "").trim()
    const website = String(body.website || "").trim()
    const subjectType = normalizeAnalysisSubjectType(body.subjectType)
    const personProfile = normalizePersonSubjectProfile(body.personProfile)
    const competitors: string[] = Array.isArray(body.competitors)
      ? body.competitors.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 20)
      : []

    if (!ourBrand) {
      return NextResponse.json({
        error: subjectType === "person" ? "请填写目标人物姓名" : "请填写我方品牌名",
      }, { status: 400 })
    }
    if (selectedCompetitors.length === 0) {
      return NextResponse.json({
        error: `请选择要对比的${subjectType === "person" ? "同行人物" : "竞品"}`,
      }, { status: 400 })
    }
    if (rawSelectedCompetitors.length > 5) {
      return NextResponse.json({
        error: `最多只能选择 5 个${subjectType === "person" ? "同行人物" : "竞品"}`,
      }, { status: 400 })
    }
    if (!(await ADAPTERS.doubao.configured())) {
      return NextResponse.json({ error: "豆包 API 未配置，无法生成竞品对比报告" }, { status: 400 })
    }

    const featureKey = "competitorCompareUnit"
    const cost = estimateFeatureCredits(featureKey, selectedCompetitors.length)
    const guard = await authAndReserveCreditsForRequest(req, cost, {
      featureKey,
      source: "api:competitor-compare",
      description: getFeaturePrice(featureKey).label,
      metadata: { competitorCount: selectedCompetitors.length, subjectType },
    })
    if (!guard.ok) return guard.response
    reservation = guard.reservation

    const comparisons = await mapWithConcurrency(
      selectedCompetitors,
      3,
      competitor => generateComparison({
        ourBrand,
        competitor,
        industry,
        website,
        competitors,
        penetrationContext: buildPenetrationContext(body.penetration, ourBrand, [competitor], subjectType),
        subjectType,
        personProfileContext: formatPersonSubjectContext(personProfile),
      })
    )
    const result = normalize(comparisons, selectedCompetitors)

    await settleReservedCredits(reservation, cost)
    reservation = null
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    await refundReservedCreditsQuietly(reservation)
    console.error("[competitor-compare]", error)
    return NextResponse.json(
      { error: friendlyError(error) },
      { status: 500 }
    )
  }
}

export const POST = handler
