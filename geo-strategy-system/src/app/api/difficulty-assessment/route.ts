import { NextRequest, NextResponse } from "next/server"
import type {
  DifficultyAssessmentResult,
  DifficultyDimensionResult,
  DifficultyLevel,
  DifficultyProcess,
  DifficultyStageKey,
  DifficultyStageOutput,
  ModelKey,
} from "@/types"
import { ADAPTERS, MODEL_LABELS } from "@/lib/llm"
import { parseJsonStrict } from "@/lib/score-utils"
import {
  authAndReserveCredits,
  refundReservedCreditsQuietly,
  settleReservedCredits,
  type CreditReservation,
} from "@/lib/with-credits"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"
export const revalidate = 0

const DIMENSIONS = [
  { key: "dimension1", name: "头部品牌曝光集中度", max: 25 },
  { key: "dimension2", name: "推荐品牌多样性", max: 20 },
  { key: "dimension3", name: "本地化信息垄断程度", max: 20 },
  { key: "dimension4", name: "内容真实性与投毒程度", max: 15 },
  { key: "dimension5", name: "GEO准入门槛与马太效应", max: 10 },
  { key: "dimension6", name: "信息来源单一性", max: 10 },
] as const

const STAGES: Array<{
  key: DifficultyStageKey
  title: string
}> = [
  { key: "research", title: "调研取样" },
  { key: "comparison", title: "品牌/渠道对比" },
  { key: "scoring", title: "规则评分" },
  { key: "review", title: "一致性复核" },
  { key: "report", title: "生成报告" },
]

const SCORE_STANDARDS = [
  {
    name: "头部品牌曝光集中度",
    easy: "0-6：没有明显头部，谁都有机会",
    medium: "7-12：有头部但仍有缝隙",
    hard: "13-19：头部占据主要曝光位",
    super: "20-25：头部霸屏，新品牌难插足",
  },
  {
    name: "推荐品牌多样性",
    easy: "0-5：AI 能推荐几十上百个品牌",
    medium: "6-10：推荐池约 20-30 个品牌",
    hard: "11-15：推荐池约 10-15 个品牌",
    super: "16-20：推荐池不足 10 个品牌",
  },
  {
    name: "本地化信息垄断程度",
    easy: "0-5：本地服务商容易出现",
    medium: "6-10：全国品牌和本地商家混合出现",
    hard: "11-15：外地或全国品牌压过本地商家",
    super: "16-20：本地真实服务商几乎不可见",
  },
  {
    name: "内容真实性与投毒程度",
    easy: "0-4：真实体验和权威信息较多",
    medium: "5-8：软文和真实内容混杂",
    hard: "9-12：大量 SEO/AI 批量内容影响判断",
    super: "13-15：虚假榜单和投毒内容严重主导",
  },
  {
    name: "GEO准入门槛与马太效应",
    easy: "0-3：小品牌可通过内容快速进入",
    medium: "4-6：需要稳定内容和基础信任源",
    hard: "7-8：头部信任资产明显占优",
    super: "9-10：没有强品牌/强信源很难进入",
  },
  {
    name: "信息来源单一性",
    easy: "0-3：来源分散，多平台可突破",
    medium: "4-6：部分渠道权重高",
    hard: "7-8：少数渠道控制主要答案",
    super: "9-10：高度依赖单一榜单/平台/媒体",
  },
]

const TOTAL_LEVELS = [
  "0-24：容易，AI 推荐池开放，适合快速切入",
  "25-49：中等，需要内容矩阵和基础信任源",
  "50-74：困难，头部和渠道已有明显占位",
  "75-100：超难，信息垄断强，需要系统性 GEO 战役",
]

type StageContext = {
  industry: string
  city: string
  target: string
  research?: Record<string, unknown>
  comparison?: Record<string, unknown>
  scoring?: Record<string, unknown>
  review?: Record<string, unknown>
  process: Partial<DifficultyProcess>
}

function text(value: unknown, fallback = ""): string {
  const result = String(value ?? "").trim()
  return result || fallback
}

function asStringArray(value: unknown, fallback: string[], limit = 3): string[] {
  const list = Array.isArray(value)
    ? value.map(item => String(item ?? "").trim()).filter(Boolean)
    : []
  return [...list, ...fallback].slice(0, limit)
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

function normalizeLevel(value: unknown): DifficultyLevel | null {
  const raw = text(value)
  if (raw.includes("超难")) return "超难"
  if (raw.includes("困难")) return "困难"
  if (raw.includes("中等")) return "中等"
  if (raw.includes("容易")) return "容易"
  return null
}

function levelForDimension(score: number, max: number): DifficultyLevel {
  const ratio = max > 0 ? score / max : 0
  if (ratio >= 0.78) return "超难"
  if (ratio >= 0.55) return "困难"
  if (ratio >= 0.28) return "中等"
  return "容易"
}

function levelForTotal(score: number): DifficultyLevel {
  if (score >= 75) return "超难"
  if (score >= 50) return "困难"
  if (score >= 25) return "中等"
  return "容易"
}

function periodForLevel(level: DifficultyLevel, score: number): string {
  if (level === "超难") return score >= 90 ? "约60-90天" : "约45-60天"
  if (level === "困难") return score >= 65 ? "约25-30天" : "约20-25天"
  if (level === "中等") return "约10-20天"
  return "约3-10天"
}

function normalizeStageOutput(value: unknown, stage: { title: string }): DifficultyStageOutput {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {}
  return {
    title: text(source.title, stage.title),
    summary: text(source.summary, "该阶段暂无可展示的过程摘要。"),
    evidence: asStringArray(source.evidence, ["等待评估流程补充该阶段证据。"], 4),
    tags: asStringArray(source.tags, [stage.title], 5),
  }
}

function normalizeProcess(process: Partial<DifficultyProcess>): DifficultyProcess {
  return STAGES.reduce((acc, stage) => {
    acc[stage.key] = normalizeStageOutput(process[stage.key], stage)
    return acc
  }, {} as DifficultyProcess)
}

function normalizeResult(input: unknown, process: Partial<DifficultyProcess>, providerLabel: string): DifficultyAssessmentResult {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {}
  const rawDimensions = source.dimensions && typeof source.dimensions === "object"
    ? source.dimensions as Record<string, unknown>
    : {}
  const dimensions: Record<string, DifficultyDimensionResult> = {}
  let sum = 0

  for (const dimension of DIMENSIONS) {
    const raw = rawDimensions[dimension.key]
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}
    const score = clampNumber(row.score, 0, dimension.max, 0)
    sum += score
    dimensions[dimension.key] = {
      name: text(row.name, dimension.name),
      score,
      max: dimension.max,
      level: normalizeLevel(row.level) ?? levelForDimension(score, dimension.max),
      analysis: text(row.analysis, "该维度缺少详细分析，建议重新评估或补充行业公开信息。"),
    }
  }

  let totalScore = clampNumber(source.totalScore ?? source.total_score, 0, 100, sum)
  if (Math.abs(totalScore - sum) > 2) totalScore = sum
  const level = levelForTotal(totalScore)

  return {
    totalScore,
    level,
    stableMentionPeriod: text(source.stableMentionPeriod, periodForLevel(level, totalScore)),
    summary: text(
      source.summary,
      "本次评估已完成，但模型未返回完整总结。请结合六个维度分数判断行业在 AI 搜索推荐池中的进入难度。"
    ),
    dimensions,
    insights: asStringArray(source.insights, [
      "推荐池结构决定曝光入口，需要先判断头部品牌是否已经稳定占位。",
      "本地搜索位往往比全国大词更容易出现错配，是 GEO 突围的关键观察点。",
      "内容来源越集中，越需要围绕权威渠道和真实案例建立可抓取资产。",
    ], 5),
    suggestions: asStringArray(source.suggestions, [
      "先从长尾问题和本地场景切入，避开被头部品牌长期占位的大词。",
      "持续发布结构化案例、服务流程和对比内容，提高被 AI 摘要引用的概率。",
      "建立多渠道内容矩阵，定期复测 AI 回答中的品牌提及变化。",
    ], 6),
    process: normalizeProcess(process),
    generatedAt: new Date().toISOString(),
    providerLabel,
  }
}

async function pickAdapter(): Promise<ModelKey | null> {
  const order: ModelKey[] = ["doubao", "deepseek", "qwen", "kimi", "ernie", "hunyuan"]
  for (const key of order) {
    if (await ADAPTERS[key].configured()) return key
  }
  return null
}

function buildStagePrompt(stageKey: DifficultyStageKey, context: StageContext): { system: string; user: string } {
  const system = "你是严格的 JSON 输出器，也是 AI 搜索/GEO 信息垄断评估专家。只返回一个 JSON 对象，不返回 Markdown、解释文字或代码块。"
  const common = `评估对象：「${context.target}」
当前任务采用分阶段评估，不能直接拍脑袋给总分；必须基于上一步证据继续分析。
行业/赛道：${context.industry}
城市/地区：${context.city}
输出要求：只返回 JSON 对象。`
  const prior = JSON.stringify({
    research: context.research ?? null,
    comparison: context.comparison ?? null,
    scoring: context.scoring ?? null,
    review: context.review ?? null,
  }, null, 2)

  if (stageKey === "research") {
    return {
      system,
      user: `${common}
阶段1：调研取样。
请模拟真实 AI 搜索/GEO 调研，不要求联网，但要按行业常识生成足够可审查的调研样本。
请完成：
1. 生成 8-12 个用户真实会问的问题，覆盖全国大词、本地词、场景词、价格/口碑/排名词。
2. 推断这些问题下 AI 可能会提及的品牌/机构/平台类型。
3. 判断主要信息来源渠道，如官网、新闻、知乎、小红书、行业站、榜单软文、地图/本地生活平台等。
4. 输出不确定性和需要用户二次验证的点。
返回 JSON：
{
  "summary": "本阶段调研摘要，120字左右",
  "questions": ["问题1", "问题2"],
  "candidate_brands": ["可能出现的品牌或机构"],
  "source_channels": ["主要渠道"],
  "uncertainties": ["不确定点"],
  "evidence": ["证据摘要1", "证据摘要2", "证据摘要3"],
  "tags": ["标签1", "标签2"]
}`,
    }
  }

  if (stageKey === "comparison") {
    return {
      system,
      user: `${common}
阶段2：品牌与渠道对比。
上一阶段 JSON：
${prior}
请基于调研结果，比较品牌曝光集中度、推荐池宽度、本地服务商可见度、内容真实性、准入门槛、信息来源渠道。
返回 JSON：
{
  "summary": "本阶段对比摘要，120字左右",
  "top_brands": [{"name": "品牌/机构名", "exposure_reason": "为什么容易被AI提及", "estimated_visibility": "高/中/低"}],
  "brand_pool_estimate": "推荐池数量判断，如10-15个",
  "local_visibility": "本地真实服务商在AI推荐里的可见度判断",
  "source_concentration": "渠道集中度判断",
  "content_quality": "软文/虚假/AI批量内容情况",
  "entry_barrier": "中小商家进入AI推荐池的门槛判断",
  "evidence": ["对比证据1", "对比证据2", "对比证据3"],
  "tags": ["标签1", "标签2"]
}`,
    }
  }

  if (stageKey === "scoring") {
    return {
      system,
      user: `${common}
阶段3：按规则评分。
上一阶段 JSON：
${prior}
评分标准：
${JSON.stringify(SCORE_STANDARDS, null, 2)}
总分等级：
${JSON.stringify(TOTAL_LEVELS, null, 2)}
请严格按六维满分加权打分，不要让总分和六维分数不一致。每个维度必须说明证据如何对应分数。
返回 JSON：
{
  "summary": "评分摘要，120字左右",
  "dimension_scores": {
    "dimension1": {"score": 0, "level": "容易/中等/困难/超难", "reason": "证据如何对应分数"},
    "dimension2": {"score": 0, "level": "容易/中等/困难/超难", "reason": "证据如何对应分数"},
    "dimension3": {"score": 0, "level": "容易/中等/困难/超难", "reason": "证据如何对应分数"},
    "dimension4": {"score": 0, "level": "容易/中等/困难/超难", "reason": "证据如何对应分数"},
    "dimension5": {"score": 0, "level": "容易/中等/困难/超难", "reason": "证据如何对应分数"},
    "dimension6": {"score": 0, "level": "容易/中等/困难/超难", "reason": "证据如何对应分数"}
  },
  "total_score": 0,
  "level": "容易/中等/困难/超难",
  "evidence": ["评分证据1", "评分证据2", "评分证据3"],
  "tags": ["标签1", "标签2"]
}`,
    }
  }

  if (stageKey === "review") {
    return {
      system,
      user: `${common}
阶段4：一致性复核。
上一阶段 JSON：
${prior}
请检查调研、对比、评分之间是否一致，重点找：
1. 维度分数是否和证据匹配。
2. 总分是否等于六维分数之和。
3. 是否存在打分过高/过低。
4. 哪些结论置信度低，需要在报告中提示。
返回 JSON：
{
  "summary": "复核结论，120字左右",
  "confidence": "高/中高/中/低",
  "adjustments": [{"dimension": "维度名", "before": "原判断", "after": "建议调整", "reason": "原因"}],
  "warnings": ["低置信度或需人工验证的点"],
  "evidence": ["复核证据1", "复核证据2", "复核证据3"],
  "tags": ["标签1", "标签2"]
}`,
    }
  }

  return {
    system,
    user: `${common}
阶段5：生成最终报告。
上一阶段 JSON：
${prior}
请基于调研、对比、评分、复核，生成最终可展示报告。必须使用六维评分结构，分数必须等于各维度加总；如果复核有调整，应采用调整后的合理分数。
维度名称必须保持：
dimension1 头部品牌曝光集中度，满分25
dimension2 推荐品牌多样性，满分20
dimension3 本地化信息垄断程度，满分20
dimension4 内容真实性与投毒程度，满分15
dimension5 GEO准入门槛与马太效应，满分10
dimension6 信息来源单一性，满分10
返回 JSON：
{
  "total_score": 0,
  "level": "容易 / 中等 / 困难 / 超难",
  "stableMentionPeriod": "被 AI 稳定提及周期，如约25-30天",
  "dimensions": {
    "dimension1": {"name": "头部品牌曝光集中度", "score": 0, "level": "容易/中等/困难/超难", "analysis": "结合调研和对比证据的详细分析，100字左右"},
    "dimension2": {"name": "推荐品牌多样性", "score": 0, "level": "容易/中等/困难/超难", "analysis": "详细分析"},
    "dimension3": {"name": "本地化信息垄断程度", "score": 0, "level": "容易/中等/困难/超难", "analysis": "详细分析"},
    "dimension4": {"name": "内容真实性与投毒程度", "score": 0, "level": "容易/中等/困难/超难", "analysis": "详细分析"},
    "dimension5": {"name": "GEO准入门槛与马太效应", "score": 0, "level": "容易/中等/困难/超难", "analysis": "详细分析"},
    "dimension6": {"name": "信息来源单一性", "score": 0, "level": "容易/中等/困难/超难", "analysis": "详细分析"}
  },
  "summary": "整体评估总结，200字左右，必须说明分数来自前面哪些证据",
  "insights": ["关键洞察1", "关键洞察2", "关键洞察3"],
  "suggestions": ["GEO策略建议1", "GEO策略建议2", "GEO策略建议3"],
  "process": {
    "report": {
      "summary": "最终报告如何由前四步得出，100字左右",
      "evidence": ["报告依据1", "报告依据2", "报告依据3"],
      "tags": ["最终报告", "置信度"]
    }
  }
}`,
  }
}

async function handler(req: NextRequest) {
  let reservation: CreditReservation | null = null
  try {
    const body = await req.json()
    const industry = text(body.industry)
    const city = text(body.city, "全国")

    if (!industry) {
      return NextResponse.json({ error: "请填写行业/赛道名称" }, { status: 400 })
    }

    const picked = await pickAdapter()
    if (!picked) {
      return NextResponse.json(
        { error: "没有任何已配置的大模型可用，请先在后台管理页配置至少一个 API Key" },
        { status: 400 }
      )
    }

    const guard = await authAndReserveCredits(5)
    if (!guard.ok) return guard.response
    reservation = guard.reservation

    const providerLabel = MODEL_LABELS[picked]
    const context: StageContext = {
      industry,
      city,
      target: city && city !== "全国" ? `${city}${industry}` : industry,
      process: {},
    }

    let finalParsed: Record<string, unknown> | null = null
    for (const stage of STAGES) {
      const { system, user } = buildStagePrompt(stage.key, context)
      const raw = await ADAPTERS[picked].chat({
        system,
        user,
        temperature: stage.key === "report" ? 0.28 : 0.35,
        maxTokens: stage.key === "report" ? 4096 : 2200,
        jsonMode: true,
        mode: "judge",
      })
      const parsed = parseJsonStrict<Record<string, unknown>>(raw, stage.title)

      if (stage.key === "report") {
        finalParsed = parsed
        const reportProcess = parsed.process && typeof parsed.process === "object"
          ? (parsed.process as Record<string, unknown>).report
          : undefined
        context.process.report = normalizeStageOutput(reportProcess ?? {
          summary: parsed.summary,
          evidence: parsed.insights,
          tags: ["最终报告", text(parsed.level, "已评分")],
        }, stage)
      } else {
        context.process[stage.key] = normalizeStageOutput(parsed, stage)
        if (stage.key === "research") context.research = parsed
        if (stage.key === "comparison") context.comparison = parsed
        if (stage.key === "scoring") context.scoring = parsed
        if (stage.key === "review") context.review = parsed
      }
    }

    if (!finalParsed) throw new Error("多阶段评估未生成最终报告。")

    const result = normalizeResult(finalParsed, context.process, providerLabel)
    await settleReservedCredits(reservation, 5)
    reservation = null
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    await refundReservedCreditsQuietly(reservation)
    console.error("[difficulty-assessment]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "服务器错误" },
      { status: 500 }
    )
  }
}

export const POST = handler
