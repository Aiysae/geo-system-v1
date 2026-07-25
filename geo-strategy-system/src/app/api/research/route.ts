import { NextRequest, NextResponse } from "next/server"
import type {
  AnalysisSubjectType,
  ResearchDimension,
  ResearchMode,
  ResearchResult,
  ResearchSourceMode,
} from "@/types"
import {
  isAdapterCredentialConfigured,
  runAdapterCredentialPoolChat,
} from "@/lib/ai-credential-adapter"
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
export const maxDuration = 180
export const dynamic = "force-dynamic"

function asStringArray(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, limit)
}

function score(value: unknown, fallback = 60): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(100, Math.round(n)))
}

function text(value: unknown, fallback = ""): string {
  const s = String(value ?? "").trim()
  return s || fallback
}

function buildPenetrationContext(
  penetration: unknown,
  subjectType: AnalysisSubjectType = "brand",
): string {
  if (!penetration || typeof penetration !== "object") return "暂无疑问句检测数据。"
  const p = penetration as {
    aggregated?: {
      penetrationRate?: number
      ourMentions?: number
      totalSlots?: number
      ourRanking?: number | null
      topCompetitors?: string[]
      missedQuestions?: string[]
      industryShare?: Array<{ brand?: string; count?: number; ratio?: number }>
      perModelRate?: Array<{ model?: string; rate?: number; mentions?: number; total?: number }>
    }
    byModel?: Record<string, Array<{ question?: string; answer?: string; hitOur?: boolean; mentionedBrands?: string[] }>>
  }
  const agg = p.aggregated
  if (!agg) return "暂无疑问句检测数据。"
  const isPerson = subjectType === "person"

  const sampleAnswers = Object.entries(p.byModel ?? {})
    .flatMap(([model, items]) =>
      (items ?? []).slice(0, 3).map(item => ({
        model,
        question: item.question || "",
        answer: (item.answer || "").slice(0, 260),
        hitOur: item.hitOur === true,
        brands: (item.mentionedBrands || []).join("、"),
      }))
    )
    .slice(0, 10)

  return `【疑问句检测摘要】
- 综合渗透率：${typeof agg.penetrationRate === "number" ? `${(agg.penetrationRate * 100).toFixed(1)}%` : "未知"}（${agg.ourMentions ?? 0}/${agg.totalSlots ?? 0}）
- ${isPerson ? "同行人物" : "行业"}排位：${agg.ourRanking ? `第 ${agg.ourRanking} 名` : "未上榜"}
- Top ${isPerson ? "同行人物" : "竞品"}：${(agg.topCompetitors || []).join("、") || "暂无"}
- 未命中问题：${(agg.missedQuestions || []).slice(0, 8).join("；") || "暂无"}
- ${isPerson ? "人物可见度" : "行业占有率"}：${(agg.industryShare || []).slice(0, 8).map(i => `${i.brand}(${i.count})`).join("、") || "暂无"}
- 各模型提及率：${(agg.perModelRate || []).map(i => `${i.model}:${typeof i.rate === "number" ? `${(i.rate * 100).toFixed(0)}%` : "?"}`).join("、") || "暂无"}

【AI 回答样本】
${sampleAnswers.map((item, i) => `${i + 1}. [${item.model}] ${item.hitOur ? "命中" : "未命中"}｜提及：${item.brands || "无"}｜问：${item.question}｜答：${item.answer}`).join("\n") || "暂无"}`
}

function buildPrompt(args: {
  mode: ResearchMode
  sourceMode: ResearchSourceMode
  ourBrand: string
  industry: string
  website: string
  competitors: string[]
  region: string
  aliases: string[]
  hypothesis: string
  penetrationContext: string
  subjectType: AnalysisSubjectType
  personProfileContext: string
}): { system: string; user: string } {
  const isPerson = args.subjectType === "person"
  const subjectNoun = isPerson ? "个人 IP / 专业人物" : "品牌"
  const peerNoun = isPerson ? "同行人物" : "竞品"
  const system = `你是一个做 GEO / AI 搜索心智研究的资深${isPerson ? "个人 IP" : "品牌"}研究员。你只使用豆包视角进行深度调研：目标不是泛泛介绍${subjectNoun}，而是判断"当用户在豆包里问相关问题时，这个${subjectNoun}在模型心智里的形象、可信度、推荐概率、短板和可优化空间"。

【研究要求】
1. 必须基于公开可验证信息、用户给定数据、疑问句检测样本进行推断；不确定处要写成"证据不足/需要验证"，禁止编造事实。
2. ${args.mode === "hypothesis" ? "用户会提供一个假设。请围绕这个假设做验证式研究：哪些现象支持它、哪些现象反驳它、需要补哪些证据。" : `请做 AI 深度调研：完整刻画${subjectNoun}在豆包里的心智位置、用户感知、信任信号、风险与机会。`}
3. 结论要能指导后续内容、官网或个人资料页、第三方信源、问答和${peerNoun}对比策略。
${isPerson ? `4. 必须把人物与所在医院、律所、公司、学校、协会等机构分开；只把同职业、同专业方向、同地区或同类服务场景中的具名人物视作同行，不得把机构名、职称或普通形容词当成人名。
5. 人物姓名相同但身份无法确认时必须提示同名歧义；不得凭姓名自行补造履历、资质、职称、案例或任职机构。` : ""}

【输出格式 — 严格 JSON，禁止 markdown 包裹、禁止额外文字】
{
  "executiveSummary": "150-220 字总体结论",
  "brandImage": "豆包可能形成的${isPerson ? "个人 IP" : "品牌"}总体形象",
  "modelMentality": "模型为什么会/不会推荐该${isPerson ? "人物" : "品牌"}的机制性解释",
  "dimensions": [
    { "name": "认知清晰度", "score": 0-100, "insight": "具体洞察", "evidence": ["证据或样本1", "证据或样本2"] },
    { "name": "可信度", "score": 0-100, "insight": "具体洞察", "evidence": ["..."] },
    { "name": "差异化", "score": 0-100, "insight": "具体洞察", "evidence": ["..."] },
    { "name": "推荐友好度", "score": 0-100, "insight": "具体洞察", "evidence": ["..."] },
    { "name": "风险暴露", "score": 0-100, "insight": "分数越高风险越低", "evidence": ["..."] }
  ],
  "audiencePerception": ["目标用户可能如何理解这个${isPerson ? "人物" : "品牌"}，4-6 条"],
  "trustSignals": ["豆包可抓取/可采信的信任信号，4-6 条"],
  "evidenceGaps": ["证据缺口，4-6 条"],
  "risks": ["AI 回答中可能出现的不利形象，4-6 条"],
  "opportunities": ["可以放大的机会，4-6 条"],
  "recommendations": ["具体行动建议，6-10 条"]
}`

  const sourceNote = args.sourceMode === "manual"
    ? `本次使用用户手动填写的地区、行业、${isPerson ? "人物姓名和姓名别名" : "品牌全称和别名"}作为独立调研输入，不依赖渗透率检测结果。`
    : `本次优先使用渗透率情报中的${isPerson ? "人物、职业、资料页、同行人物" : "品牌、行业、官网、竞品"}和疑问句检测结果作为独立调研输入。`

  const user = `请对以下${subjectNoun}做${args.mode === "hypothesis" ? "假设验证式" : "AI 深度"}调研：

数据来源：${sourceNote}
${isPerson ? "人物姓名" : "品牌名"}：${args.ourBrand}
${isPerson ? "姓名别名" : "品牌别名"}：${args.aliases.join("、") || "未提供"}
地区：${args.region || "未指定"}
行业：${args.industry || "未指定"}
官网/主阵地：${args.website || "未提供"}
已知${peerNoun}：${args.competitors.join("、") || "未提供"}
${isPerson ? `\n【人物身份资料】\n${args.personProfileContext}` : ""}
调研模式：${args.mode === "hypothesis" ? "假设验证" : "AI 深度调研"}
用户假设：${args.mode === "hypothesis" ? args.hypothesis || "未填写具体假设，请自行提出可验证假设并评估。" : "无"}

${args.sourceMode === "module" ? args.penetrationContext : "【疑问句检测摘要】\n手动输入模式未使用渗透率检测数据；请基于公开可验证信息和用户填写资料保守调研。"}`

  return { system, user }
}

function normalizeResult(
  raw: unknown,
  mode: ResearchMode,
  sourceMode: ResearchSourceMode,
  hypothesis: string,
  region: string,
  aliases: string[]
): ResearchResult {
  const data = raw as Record<string, unknown>
  const dimensionsRaw = Array.isArray(data.dimensions) ? data.dimensions : []
  const dimensions: ResearchDimension[] = dimensionsRaw
    .map(item => {
      const row = item as Record<string, unknown>
      return {
        name: text(row.name, "未命名维度"),
        score: score(row.score),
        insight: text(row.insight, "暂无洞察"),
        evidence: asStringArray(row.evidence, 4),
      }
    })
    .filter(item => item.name && item.insight)
    .slice(0, 6)

  return {
    mode,
    sourceMode,
    hypothesis: mode === "hypothesis" ? hypothesis : undefined,
    region: region || undefined,
    aliases: aliases.length ? aliases : undefined,
    executiveSummary: text(data.executiveSummary, "豆包已完成调研，但未返回摘要。"),
    brandImage: text(data.brandImage, "暂无品牌形象结论。"),
    modelMentality: text(data.modelMentality, "暂无模型心智解释。"),
    dimensions,
    audiencePerception: asStringArray(data.audiencePerception, 6),
    trustSignals: asStringArray(data.trustSignals, 6),
    evidenceGaps: asStringArray(data.evidenceGaps, 6),
    risks: asStringArray(data.risks, 6),
    opportunities: asStringArray(data.opportunities, 6),
    recommendations: asStringArray(data.recommendations, 10),
    generatedAt: new Date().toISOString(),
  }
}

async function handler(req: NextRequest) {
  let reservation: CreditReservation | null = null
  try {
    const body = await req.json()
    const sourceMode: ResearchSourceMode = body.sourceMode === "manual" ? "manual" : "module"
    const aliases: string[] = Array.isArray(body.aliases)
      ? body.aliases.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 12)
      : String(body.aliases || "").split(/[\n,，、]/).map(s => s.trim()).filter(Boolean).slice(0, 12)
    const ourBrand = String(body.ourBrand || "").trim()
    const industry = String(body.industry || "").trim()
    const website = String(body.website || "").trim()
    const region = String(body.region || "").trim()
    const mode = body.mode === "hypothesis" ? "hypothesis" : "ai"
    const hypothesis = String(body.hypothesis || "").trim()
    const subjectType = normalizeAnalysisSubjectType(body.subjectType)
    const personProfile = normalizePersonSubjectProfile(body.personProfile)
    const competitors: string[] = Array.isArray(body.competitors)
      ? body.competitors.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 20)
      : []

    if (!ourBrand) {
      return NextResponse.json({
        error: subjectType === "person"
          ? "请填写目标人物姓名"
          : sourceMode === "manual" ? "请填写品牌全称" : "请填写我方品牌名",
      }, { status: 400 })
    }
    if (sourceMode === "manual" && !industry) {
      return NextResponse.json({ error: "请填写行业" }, { status: 400 })
    }
    if (mode === "hypothesis" && !hypothesis) {
      return NextResponse.json({ error: "请填写要验证的假设" }, { status: 400 })
    }
    if (!(await isAdapterCredentialConfigured("doubao", "research", { jsonMode: true }))) {
      return NextResponse.json({ error: "豆包 API 未配置，无法执行调研" }, { status: 400 })
    }

    const featureKey = mode === "hypothesis" ? "researchHypothesis" : "researchAi"
    const cost = estimateFeatureCredits(featureKey)
    const guard = await authAndReserveCreditsForRequest(req, cost, {
      featureKey,
      source: "api:research",
      description: getFeaturePrice(featureKey).label,
      metadata: { mode, sourceMode, subjectType },
    })
    if (!guard.ok) return guard.response
    reservation = guard.reservation

    const { system, user } = buildPrompt({
      mode,
      sourceMode,
      ourBrand,
      industry,
      website,
      competitors,
      region,
      aliases,
      hypothesis,
      penetrationContext: buildPenetrationContext(body.penetration, subjectType),
      subjectType,
      personProfileContext: formatPersonSubjectContext(personProfile),
    })

    const raw = await runAdapterCredentialPoolChat("doubao", "research", {
      system,
      user,
      temperature: 0.35,
      maxTokens: 4096,
      jsonMode: true,
      mode: "judge",
    })
    const parsed = parseJsonStrict<Record<string, unknown>>(raw, "豆包调研")
    const result = normalizeResult(parsed, mode, sourceMode, hypothesis, region, aliases)

    await settleReservedCredits(reservation, cost)
    reservation = null
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    await refundReservedCreditsQuietly(reservation)
    console.error("[research]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "服务器错误" },
      { status: 500 }
    )
  }
}

export const POST = handler
