import { NextRequest, NextResponse } from "next/server"
import { createHash } from "crypto"
import type {
  AnalysisSubjectType,
  ResearchContentBlueprint,
  ResearchDimension,
  ResearchEvidenceReference,
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
import { kv } from "@/lib/kv"
import {
  buildResearchSearchQueries,
  collectResearchEvidence,
  formatResearchEvidenceForModel,
  type ResearchEvidenceBundle,
} from "@/lib/research/web-evidence"
import {
  DOUBAO_RESEARCH_STABLE_MODEL,
  RESEARCH_STAGE_TIMEOUT_SECONDS,
} from "@/lib/research/runtime"

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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function sourceIds(value: unknown, available: Set<string>): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .map(item => String(item || "").trim().toUpperCase())
      .filter(id => available.has(id)),
  )).slice(0, 8)
}

function addReference(
  references: ResearchEvidenceReference[],
  path: string,
  ids: string[],
): void {
  if (ids.length === 0) return
  references.push({ path, sourceIds: ids })
}

function sourcedTextArray(
  value: unknown,
  path: string,
  available: Set<string>,
  references: ResearchEvidenceReference[],
  limit = 8,
): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const item of value) {
    const row = record(item)
    const itemText = typeof item === "string"
      ? item.trim()
      : text(row.text ?? row.claim ?? row.value)
    if (!itemText) continue
    const index = result.length
    result.push(itemText)
    addReference(references, `${path}.${index}`, sourceIds(row.sourceIds, available))
    if (result.length >= limit) break
  }
  return result
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

function enumText<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  const candidate = String(value || "") as T
  return allowed.includes(candidate) ? candidate : fallback
}

function normalizeContentBlueprints(value: unknown): ResearchContentBlueprint[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
    const item = raw as Record<string, unknown>
    const question = text(item.question)
    if (!question) return []
    return [{
      question: question.slice(0, 240),
      rationale: text(item.rationale, "根据调研结论补齐认知或证据缺口").slice(0, 400),
      methodKey: enumText(item.methodKey, [
        "problemSolution", "primaryEvidence", "evidenceStory", "explainer",
        "industryWhitepaper", "entityKnowledge", "recommendationComparison",
      ] as const, "problemSolution"),
      articleFormat: enumText(item.articleFormat, [
        "directAnswerGuide", "primaryEvidenceDossier", "evidenceCaseStory",
        "professionalExplainer", "industryWhitepaper", "entityKnowledgeProfile",
        "recommendationRoundup", "fieldReviewQa", "tieredEvaluation",
        "neutralComparisonReview", "localPitfallGuide",
      ] as const, "directAnswerGuide"),
      titleStrategy: enumText(item.titleStrategy, [
        "directAnswer", "audienceScenario", "decisionCriteria", "evidenceHook",
        "riskAvoidance", "localService", "comparisonMatrix", "tieredList",
        "marketTrend", "priceTransparency",
      ] as const, "directAnswer"),
      targetPlatform: enumText(item.targetPlatform, [
        "universal", "officialSite", "sohu", "toutiao", "netease", "baijiahao",
        "zhihu", "xiaohongshu", "douyin",
      ] as const, "universal"),
      evidenceNeeded: asStringArray(item.evidenceNeeded, 8),
    }]
  }).slice(0, 5)
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
  evidenceContext: string
  section: "analysis" | "strategy"
}): { system: string; user: string } {
  const isPerson = args.subjectType === "person"
  const subjectNoun = isPerson ? "个人 IP / 专业人物" : "品牌"
  const peerNoun = isPerson ? "同行人物" : "竞品"
  const analysisSchema = `{
  "executiveSummary": "150-220 字总体结论",
  "executiveSummarySourceIds": ["S1", "S2"],
  "brandImage": "豆包可能形成的${isPerson ? "个人 IP" : "品牌"}总体形象",
  "brandImageSourceIds": ["S1"],
  "modelMentality": "模型为什么会/不会推荐的机制性解释",
  "modelMentalitySourceIds": ["S1", "S3"],
  "dimensions": [
    { "name": "认知清晰度", "score": 65, "insight": "具体洞察", "sourceIds": ["S1"], "evidence": [{"text": "证据或样本", "sourceIds": ["S1"]}] },
    { "name": "可信度", "score": 70, "insight": "具体洞察", "sourceIds": ["S2"], "evidence": [{"text": "证据或样本", "sourceIds": ["S2"]}] },
    { "name": "差异化", "score": 60, "insight": "具体洞察", "sourceIds": ["S1", "S3"], "evidence": [{"text": "证据或样本", "sourceIds": ["S3"]}] },
    { "name": "推荐友好度", "score": 55, "insight": "具体洞察", "sourceIds": ["S2"], "evidence": [{"text": "证据或样本", "sourceIds": ["S2"]}] },
    { "name": "风险暴露", "score": 75, "insight": "分数越高风险越低", "sourceIds": ["S1"], "evidence": [{"text": "证据或样本", "sourceIds": ["S1"]}] }
  ],
  "audiencePerception": [{"text": "目标用户可能如何理解", "sourceIds": ["S1"]}],
  "trustSignals": [{"text": "可抓取的信任信号", "sourceIds": ["S2"]}],
  "evidenceGaps": [{"text": "证据缺口", "sourceIds": ["S1"]}],
  "risks": [{"text": "不利形象", "sourceIds": ["S1"]}],
  "opportunities": [{"text": "可放大机会", "sourceIds": ["S2"]}]
}`
  const strategySchema = `{
  "recommendations": [{"text": "具体行动建议", "sourceIds": ["S1", "S2"]}],
  "contentBlueprints": [{
    "question": "真实用户问题",
    "rationale": "为什么优先制作这篇内容",
    "methodKey": "problemSolution | primaryEvidence | evidenceStory | explainer | industryWhitepaper | entityKnowledge | recommendationComparison",
    "articleFormat": "directAnswerGuide | primaryEvidenceDossier | evidenceCaseStory | professionalExplainer | industryWhitepaper | entityKnowledgeProfile | recommendationRoundup | fieldReviewQa | tieredEvaluation | neutralComparisonReview | localPitfallGuide",
    "titleStrategy": "directAnswer | audienceScenario | decisionCriteria | evidenceHook | riskAvoidance | localService | comparisonMatrix | tieredList | marketTrend | priceTransparency",
    "targetPlatform": "universal | officialSite | sohu | toutiao | netease | baijiahao | zhihu | xiaohongshu | douyin",
    "evidenceNeeded": ["生成前需要准备或核验的资料"]
  }]
}`
  const sectionInstruction = args.section === "analysis"
    ? "本轮只负责心智分析和证据判断，不输出行动建议或内容蓝图。5 个维度均按 0-100 分评估，各列表输出 3-6 条。"
    : "本轮只负责行动建议和内容蓝图，不重复输出心智分析。recommendations 输出 5-8 条，contentBlueprints 输出 3-5 条。"
  const outputSchema = args.section === "analysis" ? analysisSchema : strategySchema
  const system = `你是一个做 GEO / AI 搜索心智研究的资深${isPerson ? "个人 IP" : "品牌"}研究员。你只使用豆包视角进行深度调研：目标不是泛泛介绍${subjectNoun}，而是判断"当用户在豆包里问相关问题时，这个${subjectNoun}在模型心智里的形象、可信度、推荐概率、短板和可优化空间"。

【研究要求】
1. 必须基于本次服务器已打开验证的公开网页、用户给定数据、疑问句检测样本进行推断；不得使用模型记忆补造公开事实。
2. 每一条外部事实、评价、优劣势或结论都要填写 sourceIds，只能使用证据包中的 S1、S2 等编号。无法被证据包支持时，明确写"证据不足/需要验证"。
3. ${args.mode === "hypothesis" ? "用户会提供一个假设。请围绕这个假设做验证式研究：哪些现象支持它、哪些现象反驳它、需要补哪些证据。" : `请做 AI 深度调研：完整刻画${subjectNoun}在豆包里的心智位置、用户感知、信任信号、风险与机会。`}
4. 结论要能指导后续内容、官网或个人资料页、第三方信源、问答和${peerNoun}对比策略。
5. ${sectionInstruction}
${isPerson ? `6. 必须把人物与所在医院、律所、公司、学校、协会等机构分开；只把同职业、同专业方向、同地区或同类服务场景中的具名人物视作同行，不得把机构名、职称或普通形容词当成人名。
7. 人物姓名相同但身份无法确认时必须提示同名歧义；不得凭姓名自行补造履历、资质、职称、案例或任职机构。` : ""}

【输出格式 — 严格 JSON，禁止 markdown 包裹、禁止额外文字】
${outputSchema}`

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

  const evidence = `\n\n【本次已验证的联网证据包】\n${args.evidenceContext}\n\n只能用上述编号做外部事实引用，不得虚构其他来源。`

  return { system, user: `${user}${evidence}` }
}

function normalizeResult(
  raw: unknown,
  mode: ResearchMode,
  sourceMode: ResearchSourceMode,
  hypothesis: string,
  region: string,
  aliases: string[],
  evidenceBundle: ResearchEvidenceBundle,
): ResearchResult {
  const data = raw as Record<string, unknown>
  const available = new Set(evidenceBundle.sources.map(source => source.id))
  const references: ResearchEvidenceReference[] = []
  const dimensionsRaw = Array.isArray(data.dimensions) ? data.dimensions : []
  const dimensions: ResearchDimension[] = dimensionsRaw
    .map((item, dimensionIndex) => {
      const row = item as Record<string, unknown>
      const evidence = sourcedTextArray(
        row.evidence,
        `dimensions.${dimensionIndex}.evidence`,
        available,
        references,
        4,
      )
      const dimensionSourceIds = sourceIds(row.sourceIds ?? row.insightSourceIds, available)
      addReference(references, `dimensions.${dimensionIndex}.insight`, dimensionSourceIds)
      return {
        name: text(row.name, "未命名维度"),
        score: score(row.score),
        insight: text(row.insight, "暂无洞察"),
        evidence,
        sourceIds: dimensionSourceIds,
      }
    })
    .filter(item => item.name && item.insight)
    .slice(0, 6)

  addReference(references, "executiveSummary", sourceIds(data.executiveSummarySourceIds, available))
  addReference(references, "brandImage", sourceIds(data.brandImageSourceIds, available))
  addReference(references, "modelMentality", sourceIds(data.modelMentalitySourceIds, available))

  const result: ResearchResult = {
    mode,
    sourceMode,
    hypothesis: mode === "hypothesis" ? hypothesis : undefined,
    region: region || undefined,
    aliases: aliases.length ? aliases : undefined,
    executiveSummary: text(data.executiveSummary, "豆包已完成调研，但未返回摘要。"),
    brandImage: text(data.brandImage, "暂无品牌形象结论。"),
    modelMentality: text(data.modelMentality, "暂无模型心智解释。"),
    dimensions,
    audiencePerception: sourcedTextArray(data.audiencePerception, "audiencePerception", available, references, 6),
    trustSignals: sourcedTextArray(data.trustSignals, "trustSignals", available, references, 6),
    evidenceGaps: sourcedTextArray(data.evidenceGaps, "evidenceGaps", available, references, 6),
    risks: sourcedTextArray(data.risks, "risks", available, references, 6),
    opportunities: sourcedTextArray(data.opportunities, "opportunities", available, references, 6),
    recommendations: sourcedTextArray(data.recommendations, "recommendations", available, references, 10),
    contentBlueprints: normalizeContentBlueprints(data.contentBlueprints),
    sources: evidenceBundle.sources,
    evidenceReferences: references,
    evidenceAudit: evidenceBundle.audit,
    generatedAt: new Date().toISOString(),
  }

  const corePaths = new Set(references.map(reference => reference.path))
  const missingCore = ["executiveSummary", "brandImage", "modelMentality"]
    .filter(path => !corePaths.has(path))
  const supportedDetails = references.filter(reference =>
    reference.path.startsWith("dimensions.")
      || /^(audiencePerception|trustSignals|risks|opportunities|recommendations)\./.test(reference.path),
  ).length
  if (missingCore.length > 0 || supportedDetails < 6) {
    throw new Error("调研结论没有完整绑定联网证据")
  }
  return result
}

type ResearchSection = "analysis" | "strategy"

interface ResearchTaskInput {
  sourceMode: ResearchSourceMode
  aliases: string[]
  ourBrand: string
  industry: string
  website: string
  region: string
  mode: ResearchMode
  hypothesis: string
  subjectType: AnalysisSubjectType
  personProfile: ReturnType<typeof normalizePersonSubjectProfile>
  competitors: string[]
  penetration: unknown
}

export interface ResearchTaskExecutionOptions {
  signal?: AbortSignal
  onProgress?: (percent: number, stage: string) => void | Promise<void>
}

class ResearchTaskInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ResearchTaskInputError"
  }
}

function parseResearchTaskInput(body: Record<string, unknown>): ResearchTaskInput {
  const sourceMode: ResearchSourceMode = body.sourceMode === "manual" ? "manual" : "module"
  const aliases = Array.isArray(body.aliases)
    ? body.aliases.map(value => String(value).trim()).filter(Boolean).slice(0, 12)
    : String(body.aliases || "").split(/[\n,，、]/).map(value => value.trim()).filter(Boolean).slice(0, 12)
  const input: ResearchTaskInput = {
    sourceMode,
    aliases,
    ourBrand: String(body.ourBrand || "").trim(),
    industry: String(body.industry || "").trim(),
    website: String(body.website || "").trim(),
    region: String(body.region || "").trim(),
    mode: body.mode === "hypothesis" ? "hypothesis" : "ai",
    hypothesis: String(body.hypothesis || "").trim(),
    subjectType: normalizeAnalysisSubjectType(body.subjectType),
    personProfile: normalizePersonSubjectProfile(body.personProfile),
    competitors: Array.isArray(body.competitors)
      ? body.competitors.map(value => String(value).trim()).filter(Boolean).slice(0, 20)
      : [],
    penetration: body.penetration,
  }

  if (!input.ourBrand) {
    throw new ResearchTaskInputError(
      input.subjectType === "person"
        ? "请填写目标人物姓名"
        : sourceMode === "manual" ? "请填写品牌全称" : "请填写我方品牌名",
    )
  }
  if (sourceMode === "manual" && !input.industry) {
    throw new ResearchTaskInputError("请填写行业")
  }
  if (input.mode === "hypothesis" && !input.hypothesis) {
    throw new ResearchTaskInputError("请填写要验证的假设")
  }
  return input
}

async function reportProgress(
  options: ResearchTaskExecutionOptions,
  percent: number,
  stage: string,
): Promise<void> {
  await options.onProgress?.(percent, stage)
}

function stageCacheKey(
  section: ResearchSection,
  system: string,
  user: string,
): string {
  const digest = createHash("sha256")
    .update(["research-v2", DOUBAO_RESEARCH_STABLE_MODEL, section, system, user].join("\u001f"))
    .digest("hex")
  return `geo:research-stage:v2:${digest}`
}

function citationCount(value: unknown, available: Set<string>): number {
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + citationCount(item, available), 0)
  }
  const row = record(value)
  return Object.entries(row).reduce((sum, [key, item]) => {
    if (/sourceIds$/i.test(key) && Array.isArray(item)) {
      return sum + sourceIds(item, available).length
    }
    return sum + citationCount(item, available)
  }, 0)
}

function validateResearchSection(
  section: ResearchSection,
  value: Record<string, unknown>,
  available: Set<string>,
): void {
  if (section === "analysis") {
    if (
      text(value.executiveSummary).length < 40
      || text(value.brandImage).length < 20
      || text(value.modelMentality).length < 20
      || !Array.isArray(value.dimensions)
      || value.dimensions.length < 4
      || sourceIds(value.executiveSummarySourceIds, available).length === 0
      || sourceIds(value.brandImageSourceIds, available).length === 0
      || sourceIds(value.modelMentalitySourceIds, available).length === 0
      || citationCount(value, available) < 10
    ) {
      throw new Error("心智分析字段或证据引用不完整")
    }
    return
  }
  if (
    !Array.isArray(value.recommendations)
    || value.recommendations.length < 3
    || !Array.isArray(value.contentBlueprints)
    || value.contentBlueprints.length < 2
    || citationCount(value.recommendations, available) < 3
  ) {
    throw new Error("策略建议或内容蓝图不完整")
  }
}

async function generateResearchSection(
  section: ResearchSection,
  prompt: { system: string; user: string },
  available: Set<string>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const cacheKey = stageCacheKey(section, prompt.system, prompt.user)
  const startedAt = Date.now()
  try {
    const cached = await kv.get<Record<string, unknown>>(cacheKey)
    if (cached) {
      validateResearchSection(section, cached, available)
      console.info("[research] stage cache hit", section)
      return cached
    }
  } catch (error) {
    console.warn("[research] stage cache read skipped", section, error)
  }

  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let upstreamCompleted = false
    try {
      const raw = await runAdapterCredentialPoolChat("doubao", "research", {
        system: attempt === 0
          ? prompt.system
          : `${prompt.system}\n\n上一次该分段输出不完整。请严格补齐字段和有效 sourceIds，只输出一个完整 JSON 对象。`,
        user: prompt.user,
        temperature: attempt === 0 ? 0.3 : 0.15,
        maxTokens: section === "analysis" ? 3000 : 1800,
        jsonMode: true,
        mode: "judge",
        allowWebSearch: false,
        timeoutSec: RESEARCH_STAGE_TIMEOUT_SECONDS,
        preferredModel: DOUBAO_RESEARCH_STABLE_MODEL,
        workloadClass: "long",
        credentialAttemptLimit: 2,
        signal,
      })
      upstreamCompleted = true
      const parsed = parseJsonStrict<Record<string, unknown>>(
        raw,
        section === "analysis" ? "豆包调研心智分析" : "豆包调研策略蓝图",
      )
      validateResearchSection(section, parsed, available)
      try {
        await kv.set(cacheKey, parsed, { ex: 2 * 60 * 60 })
      } catch (error) {
        console.warn("[research] stage cache write skipped", section, error)
      }
      console.info("[research] stage completed", section, `${Date.now() - startedAt}ms`)
      return parsed
    } catch (error) {
      lastError = error
      console.warn(
        `[research] ${section} stage attempt ${attempt + 1} failed`,
        error instanceof Error ? error.message : error,
      )
      // The adapter has already failed over across independent accounts.
      // Only malformed structured output receives an additional stage retry.
      if (!upstreamCompleted) throw error
    }
  }
  throw lastError instanceof Error ? lastError : new Error("调研分段生成失败")
}

export async function executeResearchTask(
  rawBody: unknown,
  options: ResearchTaskExecutionOptions = {},
): Promise<ResearchResult> {
  const body = record(rawBody)
  const input = parseResearchTaskInput(body)
  await reportProgress(options, 15, "正在准备调研资料")

  const adapterArgs = {
    jsonMode: true,
    preferredModel: DOUBAO_RESEARCH_STABLE_MODEL,
    workloadClass: "long" as const,
  }
  if (!(await isAdapterCredentialConfigured("doubao", "research", adapterArgs))) {
    throw new Error("豆包调研通道当前不可用，请稍后重试")
  }

  await reportProgress(options, 25, "正在联网检索并验证证据")
  const evidenceBundle = await collectResearchEvidence({
    queries: buildResearchSearchQueries({
      subject: input.ourBrand,
      aliases: input.aliases,
      industry: input.industry,
      region: input.region,
      website: input.website,
      competitors: input.competitors,
      hypothesis: input.mode === "hypothesis" ? input.hypothesis : undefined,
      subjectType: input.subjectType,
    }),
    minimumSources: 4,
    minimumDomains: 2,
    maximumSources: 12,
    signal: options.signal,
  })
  await reportProgress(options, 45, `已验证 ${evidenceBundle.sources.length} 条可读联网来源`)

  const promptArgs = {
    mode: input.mode,
    sourceMode: input.sourceMode,
    ourBrand: input.ourBrand,
    industry: input.industry,
    website: input.website,
    competitors: input.competitors,
    region: input.region,
    aliases: input.aliases,
    hypothesis: input.hypothesis,
    penetrationContext: buildPenetrationContext(input.penetration, input.subjectType),
    subjectType: input.subjectType,
    personProfileContext: formatPersonSubjectContext(input.personProfile),
    evidenceContext: formatResearchEvidenceForModel(evidenceBundle),
  }
  const analysisPrompt = buildPrompt({ ...promptArgs, section: "analysis" })
  const strategyPrompt = buildPrompt({ ...promptArgs, section: "strategy" })
  const availableSourceIds = new Set(evidenceBundle.sources.map(source => source.id))

  await reportProgress(options, 52, "正在并行生成心智分析与行动策略")
  let completedSections = 0
  const completeSection = async (stage: string) => {
    completedSections += 1
    await reportProgress(
      options,
      completedSections === 1 ? 70 : 86,
      stage,
    )
  }
  const [analysis, strategy] = await Promise.all([
    generateResearchSection("analysis", analysisPrompt, availableSourceIds, options.signal).then(async result => {
      await completeSection("心智分析已完成")
      return result
    }),
    generateResearchSection("strategy", strategyPrompt, availableSourceIds, options.signal).then(async result => {
      await completeSection("行动策略已完成")
      return result
    }),
  ])

  await reportProgress(options, 92, "正在合并结论并校验证据引用")
  return normalizeResult(
    { ...analysis, ...strategy },
    input.mode,
    input.sourceMode,
    input.hypothesis,
    input.region,
    input.aliases,
    evidenceBundle,
  )
}

async function handler(req: NextRequest) {
  let reservation: CreditReservation | null = null
  try {
    const body = record(await req.json())
    const mode: ResearchMode = body.mode === "hypothesis" ? "hypothesis" : "ai"
    const sourceMode: ResearchSourceMode = body.sourceMode === "manual" ? "manual" : "module"
    const subjectType = normalizeAnalysisSubjectType(body.subjectType)
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

    const result = await executeResearchTask(body, { signal: req.signal })

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
      { status: error instanceof ResearchTaskInputError ? 400 : 500 }
    )
  }
}

export const POST = handler
