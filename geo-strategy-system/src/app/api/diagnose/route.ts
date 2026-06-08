import { NextRequest, NextResponse } from "next/server"
import type { Diagnosis } from "@/types"
import { ADAPTERS } from "@/lib/llm"
import { parseJsonLoose } from "@/lib/score-utils"
import { authAndCheckCredits, chargeCredits } from "@/lib/with-credits"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

function clampScore(v: unknown, fallback = 60): number {
  const n = Number(v)
  if (!isFinite(n)) return fallback
  return Math.max(0, Math.min(100, Math.round(n)))
}

function buildPrompt(args: {
  ourBrand: string
  industry: string
  website: string
  penetrationContext: string
}): { system: string; user: string } {
  const system = `你是国内 GEO（生成式引擎优化）领域的资深审计专家，熟悉豆包(字节)、通义千问(阿里)、DeepSeek、Kimi(Moonshot)四大主流国内大模型的内容抓取与推荐偏好。

你的任务：基于用户提供的品牌信息和（可选的）渗透率检测结果，对该品牌做一次"多维 AI 诊断"。

【输出格式 — 严格 JSON，禁止 markdown 包裹、禁止额外文字】
{
  "gemScore": 0-100 的整数，GEM 全局预估分（综合所有维度），
  "dimensions": {
    "authority": 0-100,    // 信源权威性：是否在百科/政府站/媒体/高权重站点出现
    "structure": 0-100,    // 内容结构化：FAQ、表格、列表、Schema 标记
    "traceability": 0-100, // 可追溯信息密度：具体数字、引用、案例、白皮书
    "coverage": 0-100,     // 关键词覆盖广度：是否覆盖目标行业核心长尾词
    "sentiment": 0-100     // 情感倾向：网络口碑是否正面
  },
  "modelDiagnosis": {
    "doubao":   { "preference": "豆包的抓取偏好（如：偏好头条号、稀土掘金、抖音图文）",
                  "weakness":   "我方在豆包派系中的核心失分项（具体）",
                  "fix":        "对应修复动作（可执行）" },
    "qwen":     { "preference": "...", "weakness": "...", "fix": "..." },
    "deepseek": { "preference": "...", "weakness": "...", "fix": "..." },
    "kimi":     { "preference": "...", "weakness": "...", "fix": "..." }
  }
}

诊断要求：
1. weakness 必须具体（例："缺乏知乎高赞回答 / 没有第三方评测站交叉验证 / 官网未做 FAQ Schema"）
2. fix 必须是可立即执行的动作，不要泛泛而谈
3. 如果没有渗透率数据，根据品牌信息和行业常识合理推断分数（保守一些）
4. 严格只输出 JSON，不要写其他文字`

  const user = `请对以下品牌做多维 AI 诊断：

品牌名：${args.ourBrand}
行业：${args.industry || "未指定"}
官网：${args.website || "未提供"}

${args.penetrationContext || "（暂无渗透率检测数据，请基于品牌+行业常识保守评估。）"}`

  return { system, user }
}

async function handler(req: NextRequest) {
  try {
    const guard = await authAndCheckCredits(1)
    if (!guard.ok) return guard.response

    const body = await req.json()
    const ourBrand = String(body.ourBrand || "").trim()
    const industry = String(body.industry || "").trim()
    const website = String(body.website || "").trim()
    const penetration = body.penetration

    if (!ourBrand) {
      return NextResponse.json({ error: "请填写我方品牌名" }, { status: 400 })
    }

    let penetrationContext = ""
    if (penetration?.aggregated) {
      const agg = penetration.aggregated
      penetrationContext = `【渗透率检测结果摘要】
- 综合渗透率: ${(agg.penetrationRate * 100).toFixed(1)}%（${agg.ourMentions}/${agg.totalSlots}）
- 行业排位: ${agg.ourRanking ? `第 ${agg.ourRanking} 名` : "未上榜"}
- 主要竞品: ${agg.topCompetitors.join("、") || "无"}
- 未被任一模型提及的问题数: ${agg.missedQuestions.length}
- 各模型提及率: ${agg.perModelRate
        .map((p: { model: string; rate: number }) => `${p.model}=${(p.rate * 100).toFixed(0)}%`)
        .join(", ")}`
    }

    // 优先用 DeepSeek（便宜稳）做诊断，未配置就降级到首个可用
    const order = ["deepseek", "doubao", "qwen", "kimi"] as const
    let picked: (typeof order)[number] | undefined
    for (const key of order) {
      if (await ADAPTERS[key].configured()) {
        picked = key
        break
      }
    }
    if (!picked) {
      return NextResponse.json(
        { error: "没有任何已配置的大模型可用，请先在后台管理页配置至少一个 API Key" },
        { status: 400 }
      )
    }

    const { system, user } = buildPrompt({ ourBrand, industry, website, penetrationContext })
    const raw = await ADAPTERS[picked].chat({
      system,
      user,
      temperature: 0.5,
      maxTokens: 2048,
    })
    const parsed = parseJsonLoose(raw) as Partial<Diagnosis> | null

    if (!parsed || !parsed.dimensions || !parsed.modelDiagnosis) {
      return NextResponse.json(
        { error: "AI 返回格式异常，请重试", raw: raw.slice(0, 500) },
        { status: 502 }
      )
    }

    const result: Diagnosis = {
      gemScore: clampScore(parsed.gemScore, 60),
      dimensions: {
        authority: clampScore(parsed.dimensions.authority),
        structure: clampScore(parsed.dimensions.structure),
        traceability: clampScore(parsed.dimensions.traceability),
        coverage: clampScore(parsed.dimensions.coverage),
        sentiment: clampScore(parsed.dimensions.sentiment),
      },
      modelDiagnosis: {
        doubao: parsed.modelDiagnosis.doubao ?? blank(),
        qwen: parsed.modelDiagnosis.qwen ?? blank(),
        deepseek: parsed.modelDiagnosis.deepseek ?? blank(),
        kimi: parsed.modelDiagnosis.kimi ?? blank(),
      },
      generatedAt: new Date().toISOString(),
    }

    await chargeCredits(guard.userId, 1)
    return NextResponse.json(result)
  } catch (e) {
    console.error("[diagnose]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "服务器错误" },
      { status: 500 }
    )
  }
}

function blank() {
  return { preference: "-", weakness: "-", fix: "-" }
}


export const POST = handler
