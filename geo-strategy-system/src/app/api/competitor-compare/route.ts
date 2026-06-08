import { NextRequest, NextResponse } from "next/server"
import type { CompetitorCompareResult, CompetitorComparison } from "@/types"
import { ADAPTERS } from "@/lib/llm"
import { parseJsonStrict } from "@/lib/score-utils"
import { authAndCheckCredits, chargeCredits } from "@/lib/with-credits"

export const runtime = "nodejs"
export const maxDuration = 180
export const dynamic = "force-dynamic"

function list(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => String(item ?? "").trim()).filter(Boolean).slice(0, limit)
}

function text(value: unknown, fallback = ""): string {
  const s = String(value ?? "").trim()
  return s || fallback
}

function buildPenetrationContext(penetration: unknown, ourBrand: string, selectedCompetitors: string[]): string {
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
- 我方渗透率：${typeof agg?.penetrationRate === "number" ? `${(agg.penetrationRate * 100).toFixed(1)}%` : "未知"}（${agg?.ourMentions ?? 0}/${agg?.totalSlots ?? 0}）
- 我方行业排位：${agg?.ourRanking ? `第 ${agg.ourRanking} 名` : "未上榜"}
- Top 竞品：${(agg?.topCompetitors || []).join("、") || "暂无"}
- 行业占有率：${(agg?.industryShare || []).slice(0, 10).map(item => `${item.brand}(${item.count})`).join("、") || "暂无"}
- 未命中疑问句：${(agg?.missedQuestions || []).slice(0, 8).join("；") || "暂无"}

【与我方或所选竞品相关的 AI 回答样本】
${relevantAnswers.map((item, i) => `${i + 1}. [${item.model}] ${item.hitOur ? "命中我方" : "未命中我方"}｜提及：${item.brands || "无"}｜问：${item.question}｜答：${item.answer}`).join("\n") || "暂无直接相关样本，请基于检测摘要和公开信息保守分析。"}`
}

function buildPrompt(args: {
  ourBrand: string
  selectedCompetitors: string[]
  industry: string
  website: string
  competitors: string[]
  penetrationContext: string
}): { system: string; user: string } {
  const system = `你是一个做 GEO 竞品攻防的资深策略顾问。你需要站在豆包模型视角，分析"用户问行业问题时，为什么模型更可能推荐我方/竞品"，并给出可执行的优劣势对比报告。

【分析要求】
1. 必须区分：事实优势、模型心智优势、信源优势、表达优势、内容覆盖优势。
2. 不确定的地方写成"证据不足"，不要编造客户案例、价格、资质。
3. 每条优劣势必须具体到可以指导官网内容、第三方测评、问答文章、替代品对比页的建设。

【输出格式 — 严格 JSON，禁止 markdown 包裹、禁止额外文字】
{
  "comparisons": [
    {
      "competitor": "竞品名",
      "positioningSummary": "120-180 字，说明我方与该竞品在豆包心智里的相对位置",
      "ourAdvantages": ["我方相对该竞品的优势，3-6 条"],
      "competitorAdvantages": ["该竞品相对我方的优势，3-6 条"],
      "ourWeaknesses": ["我方面对该竞品时暴露的短板，3-6 条"],
      "competitorWeaknesses": ["该竞品短板，3-6 条"],
      "differentiators": ["最应该放大的差异化叙事，3-6 条"],
      "userChoiceDrivers": ["用户在两者之间选择时的关键决策因素，3-6 条"],
      "contentActions": ["针对该竞品的内容/信源打法，4-8 条"]
    }
  ],
  "ourWeaknessSummary": ["把我方对标所有所选竞品后反复出现的共性劣势汇总，5-10 条"]
}`

  const user = `请生成我方品牌与所选竞品的优劣势对比报告。所选竞品共 ${args.selectedCompetitors.length} 个，请每个竞品各生成一份对比，并额外汇总我方对标这些竞品时的共同劣势：

我方品牌：${args.ourBrand}
所选竞品：${args.selectedCompetitors.join("、")}
行业：${args.industry || "未指定"}
官网：${args.website || "未提供"}
其它已知竞品：${args.competitors.filter(c => !args.selectedCompetitors.includes(c)).join("、") || "无"}

${args.penetrationContext}`

  return { system, user }
}

function normalizeComparison(parsed: unknown, fallbackCompetitor: string): CompetitorComparison {
  const data = parsed as Record<string, unknown>
  return {
    competitor: text(data.competitor, fallbackCompetitor),
    positioningSummary: text(data.positioningSummary, "豆包已完成对比，但未返回定位摘要。"),
    ourAdvantages: list(data.ourAdvantages, 7),
    competitorAdvantages: list(data.competitorAdvantages, 7),
    ourWeaknesses: list(data.ourWeaknesses, 7),
    competitorWeaknesses: list(data.competitorWeaknesses, 6),
    differentiators: list(data.differentiators, 7),
    userChoiceDrivers: list(data.userChoiceDrivers, 7),
    contentActions: list(data.contentActions, 10),
  }
}

function normalize(parsed: unknown, selectedCompetitors: string[]): CompetitorCompareResult {
  const data = parsed as Record<string, unknown>
  const comparisonsRaw = Array.isArray(data.comparisons) ? data.comparisons : []
  const comparisons = selectedCompetitors.map((competitor, index) =>
    normalizeComparison(comparisonsRaw[index] || {}, competitor)
  )
  const first = comparisons[0] || normalizeComparison({}, selectedCompetitors[0] || "竞品")
  return {
    ...first,
    selectedCompetitors,
    comparisons,
    ourWeaknessSummary: list(data.ourWeaknessSummary, 10),
    generatedAt: new Date().toISOString(),
  }
}

async function handler(req: NextRequest) {
  try {
    const body = await req.json()
    const ourBrand = String(body.ourBrand || "").trim()
    const rawSelectedCompetitors: string[] = Array.isArray(body.selectedCompetitors)
      ? body.selectedCompetitors.map((s: unknown) => String(s).trim()).filter(Boolean)
      : [String(body.competitor || "").trim()].filter(Boolean)
    const selectedCompetitors = rawSelectedCompetitors.slice(0, 5)
    const industry = String(body.industry || "").trim()
    const website = String(body.website || "").trim()
    const competitors: string[] = Array.isArray(body.competitors)
      ? body.competitors.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 20)
      : []

    if (!ourBrand) {
      return NextResponse.json({ error: "请填写我方品牌名" }, { status: 400 })
    }
    if (selectedCompetitors.length === 0) {
      return NextResponse.json({ error: "请选择要对比的竞品" }, { status: 400 })
    }
    if (rawSelectedCompetitors.length > 5) {
      return NextResponse.json({ error: "最多只能选择 5 个竞品" }, { status: 400 })
    }
    if (!(await ADAPTERS.doubao.configured())) {
      return NextResponse.json({ error: "豆包 API 未配置，无法生成竞品对比报告" }, { status: 400 })
    }

    const guard = await authAndCheckCredits(5 * selectedCompetitors.length)
    if (!guard.ok) return guard.response

    const { system, user } = buildPrompt({
      ourBrand,
      selectedCompetitors,
      industry,
      website,
      competitors,
      penetrationContext: buildPenetrationContext(body.penetration, ourBrand, selectedCompetitors),
    })
    const raw = await ADAPTERS.doubao.chat({
      system,
      user,
      temperature: 0.35,
      maxTokens: 4096,
      jsonMode: true,
      mode: "judge",
    })
    const parsed = parseJsonStrict<Record<string, unknown>>(raw, "豆包竞品对比")
    const result = normalize(parsed, selectedCompetitors)

    await chargeCredits(guard.userId, 5 * selectedCompetitors.length)
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    console.error("[competitor-compare]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "服务器错误" },
      { status: 500 }
    )
  }
}

export const POST = handler
