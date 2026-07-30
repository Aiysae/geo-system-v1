import { NextRequest, NextResponse } from "next/server"
import { getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { runAdapterCredentialPoolChat } from "@/lib/ai-credential-adapter"
import { parseJsonLoose } from "@/lib/score-utils"
import {
  authAndReserveCreditsForRequest,
  refundReservedCreditsQuietly,
  type CreditReservation,
} from "@/lib/with-credits"
import type {
  GeoStrategyPlan,
  KeywordStrategyGenerationSettings,
  KeywordStrategyResearchAudit,
  SourcePlatformSnapshot,
} from "@/types/geo-strategy"
import { estimateFeatureCredits, getFeaturePrice } from "@/lib/pricing"
import {
  linkStrategyToSourcePlatforms,
  sourcePlatformPromptContext,
} from "@/lib/source-platform-intelligence"
import {
  KEYWORD_STRATEGY_METHODOLOGY_VERSION,
  auditKeywordStrategyPlan,
  buildKeywordMethodologyInstruction,
  keywordLanguageInstruction,
  normalizeKeywordStrategySettings,
} from "@/lib/geo-strategy/keyword-strategy-methodology"
import {
  isKeywordStrategyWebReady,
  researchKeywordStrategyContext,
} from "@/lib/geo-strategy/keyword-strategy-research"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

const FEATURE_KEY = "keywordStrategyGenerate"
const CREDIT_COST = estimateFeatureCredits(FEATURE_KEY)

const SYSTEM_PROMPT = `你是一个资深 GEO（生成式引擎优化）策略顾问，服务对象包括企业品牌、产品、专业服务者和个人 IP，目标是提升其在 ChatGPT、DeepSeek、豆包、Kimi、通义等生成式引擎中的被理解、被引用和被推荐概率。

你需要基于客户资料、调研报告、AI 提及检测报告、截图 OCR 文本和用户补充说明，生成可直接交付给客户的 GEO 优化策略方案。

必须遵守：
1. GEO 策略分为官网/第三方网站和自媒体内容两条主线。
2. 官网或个人官方资料主阵地是第一事实源，必须先给出建设策略；第三方网站负责信息包围、劣势转优势和交叉验证。
3. 自媒体内容负责关键词、疑问句和目标客户真实提问方式覆盖。
4. 关键词按痛点/优势、主要劣势、客户场景需求三类制定。
5. 疑问句使用七类真实搜索意图：榜单推荐、痛点解决、竞品对比、采购决策、场景人群、品牌认知和风险疑虑；每条问题还要能映射到更细的用户子意图。
6. 第三方网站策略不是普通媒体发布计划，而是“搭建第三方网站”的策略，例如测评类网站、交流论坛、问答知识库、案例口碑站、对比榜单站等。
7. 每个第三方网站都必须说明它针对哪类劣势，以及如何把这个劣势转化为优势叙事。
8. 疑问句检测已经命中的自媒体和行业垂直平台必须进入自媒体发文策略；官媒、政府和协会信源必须单独进入权威媒体策略，不能混写。
9. 关键词必须结合本次豆包官方联网研究，不得脱离目标地域和真实用户表达凭空罗列。
10. 输出必须是严格 JSON，不要输出 Markdown，不要解释 JSON 外的任何文字。

${buildKeywordMethodologyInstruction()}`

function buildUserPrompt(
  profile: Record<string, unknown>,
  settings: KeywordStrategyGenerationSettings,
  research: KeywordStrategyResearchAudit,
  sourcePlatformSnapshot?: SourcePlatformSnapshot,
): string {
  const isPerson = profile.subject_type === "person"
  const sourcePlatforms = sourcePlatformPromptContext(sourcePlatformSnapshot)
  const sections: string[] = [
    "请基于以下“已确认的结构化客户资料”和规则引擎草稿，生成一份完整、具体、可交付的 GEO 优化策略 JSON。",
    "",
    "本次先不要生成完整 question_strategy，只生成：",
    "- summary",
    "- profile",
    "- keyword_strategy",
    "- official_site_strategy",
    "- third_party_site_strategy",
    "- media_plan",
    "- authority_media_plan",
    "- geo_monitoring_plan",
    "- execution_roadmap",
    "",
    "【已确认的客户资料】",
  ]

  for (const [key, value] of Object.entries(profile)) {
    if (Array.isArray(value)) {
      const enabled = value.filter((v: unknown) => typeof v === "object" && (v as Record<string, unknown>).enabled !== false)
      if (enabled.length > 0) {
        sections.push(`${key}:`)
        enabled.forEach((v: unknown) => {
          const item = v as Record<string, unknown>
          sections.push(`  - ${item.text || item.name || ""}${item.confidence === "low" ? " (置信度低)" : ""}`)
        })
      }
    } else if (value) {
      sections.push(`${key}: ${value}`)
    }
  }

  sections.push(
    "",
    "【本次关键词策略设置】",
    `目标地域：${settings.target_region}`,
    `语言风格：${keywordLanguageInstruction(settings)}`,
    `用户指定核心关键词：${settings.custom_keywords.length > 0 ? settings.custom_keywords.join("、") : "未指定，由系统结合联网研究提炼"}`,
    "",
    "【豆包官方联网研究】",
    `研究时间：${research.searched_at}`,
    `联网请求编号：${research.provider_request_id || "无"}`,
    `联网研究摘要：${research.brief}`,
    `真实表达模式：${research.user_language_patterns.join("、") || "暂无"}`,
    `决策信号：${research.decision_signals.join("、") || "暂无"}`,
    `地域表达：${research.regional_expressions.join("、") || "暂无"}`,
    "可审计网页来源：",
    JSON.stringify(research.sources, null, 2),
  )

  if (sourcePlatforms.length > 0) {
    sections.push(
      "",
      "【疑问句检测信源平台情报】",
      `成功联网回答数：${sourcePlatformSnapshot?.successful_answer_count || 0}`,
      `有效引用事件数：${sourcePlatformSnapshot?.total_citation_events || 0}`,
      "采信率表示：引用该平台的独立联网回答数 ÷ 全部成功联网回答数。同一网址被不同模型或不同独立回答引用时必须分别保留权重。",
      JSON.stringify(sourcePlatforms, null, 2),
    )
  }

  sections.push(
    "",
    "要求：",
    "- 不要把 OCR 噪声、评分表、页码、模型名错误拼进策略。",
    "- 不要编造无法从资料推断的硬事实。",
    isPerson
      ? "- 本项目是个人 IP：必须把人物与所在医院、律所、公司、学校、协会等机构分开；competitors 只填写具名同行人物，不得把机构、职称或普通词当作同行。"
      : "- 本项目是品牌/产品：竞品应按真实经营主体及其明确别名归并。",
    isPerson
      ? "- 个人 IP 的策略要覆盖个人官方资料页、专业履历/资质、案例或作品、公开观点、媒体/机构背书和同名消歧；不得编造人物经历。"
      : "- 品牌策略要覆盖官网事实页、产品/服务、案例、资质、第三方验证和品牌别名一致性。",
    "- 可以基于资料做策略推断，但表达要具体。",
    "- 将优势内容转化为 GEO 可信事实资产：围绕优势中的具体数字，规划官网/第三方/自媒体的引用布局。",
    "- official_site_strategy 必须是“官网建设策略”，并且排在第三方网站策略之前。至少包含：首页信任首屏、产品/服务详情页、优势数据页、案例/口碑页、FAQ/对比页、结构化数据与 About/品牌事实页。",
    "- keyword_strategy 必须包含 core_keywords、pain_advantage_keywords、weakness_conversion_keywords、scenario_keywords。",
    "- keyword_strategy 每个分组都必须输出至少 3 个语义不同、可直接用于内容规划的关键词；每个关键词都必须填写具体 logic。",
    settings.custom_keywords.length > 0
      ? `- 用户指定的核心关键词必须全部进入 core_keywords 或在 logic 中明确说明其长尾拆解，不得遗漏：${settings.custom_keywords.join("、")}。`
      : "- core_keywords 要优先使用联网研究发现的真实用户表达和行业决策词。",
    `- 所有关键词与后续问题方向必须适配目标地域“${settings.target_region}”及语言风格“${keywordLanguageInstruction(settings)}”。`,
    "- 不要在关键词里堆叠未经核实的排名、销量、认证、客户数量或效果承诺。",
    "- third_party_site_strategy 必须是“搭建第三方网站”的策略，不要写成知乎、小红书、公众号、百家号、头条号、B站这些自媒体平台。",
    "- third_party_site_strategy 至少 5 个站点类型，优先包含：测评类网站、交流论坛、问答知识库、案例/口碑站、对比/榜单站、行业资料库。",
    "- 每个 third_party_site_strategy 条目必须填写 weakness_conversion：说明这个站点迎合哪个劣势，并如何把劣势打造为优势。",
    sourcePlatforms.length > 0
      ? "- media_plan 必须逐一包含上方 category 为 self_media 或 industry_vertical 的全部检测命中平台，不得遗漏；platform_key、platform 名称必须原样返回。"
      : "- 当前没有可用的检测信源平台情报，media_plan 至少包含知乎、小红书、公众号、百家号、头条号、B站专栏。",
    "- authority_media_plan 必须逐一包含上方 category 为 authority_media 或 government_association 的全部检测命中平台，不得遗漏；官媒要写投稿、采访、媒体合作或发稿策略，政府/协会信源要写政策、标准、资质等可核验引用策略，不能写成可自行注册发布。",
    "- 检测命中平台的 source_origin 填 penetration_detected；自行补充的平台填 system_recommended。",
    "- platform_type 只能使用 self_media、industry_vertical、authority_media、government_association、brand_official、other。",
    "- 可以补充资料和检测结果之外的适配平台，但必须排在检测命中平台之后，并明确标为 system_recommended。",
    `- geo_monitoring_plan 至少包含${isPerson ? "人物主动提及率、同名身份准确率" : "品牌主动提及率"}、引用/事实一致性、第三方交叉验证覆盖、疑问句内容覆盖率。`,
    "- 每个 geo_monitoring_plan 条目同时给出复盘频率、触发改进的内容动作和需要核验的证据；不要只写抽象指标。",
    "- execution_roadmap 至少包含第1周、第2-3周、第3-5周、持续执行。",
    "",
    "输出 JSON Schema：",
    `{
  "project_name": "",
  "summary": "",
  "profile": {
    "subject_type": "${isPerson ? "person" : "brand"}",
    "person_profile": ${isPerson ? JSON.stringify(profile.person_profile || {}) : "null"},
    "brand_or_product": "", "industry": "", "audience": "",
    "product_description": "", "business_goals": "",
    "competitors": [], "terms": [],
    "pain_points": [], "advantages": [],
    "weaknesses": [], "scenes": []
  },
  "keyword_strategy": {
    "core_keywords": [{"priority": "1", "keyword": "", "logic": ""}],
    "pain_advantage_keywords": [{"priority": "1", "keyword": "", "logic": ""}],
    "weakness_conversion_keywords": [{"priority": "1", "keyword": "", "logic": ""}],
    "scenario_keywords": [{"priority": "1", "keyword": "", "logic": ""}]
  },
  "official_site_strategy": [{"module": "官网建设模块", "action": "具体建设动作", "goal": "作为第一事实源的目标"}],
  "third_party_site_strategy": [
    {"priority": "1", "site_type": "", "suggested_name": "", "positioning": "", "content_pillars": "", "weakness_conversion": "", "cross_validation_role": ""}
  ],
  "media_plan": [
    {"platform_key": "", "platform": "", "platform_type": "self_media", "source_origin": "penetration_detected", "role": "", "keyword_focus": "", "sample_title": "", "cadence": ""}
  ],
  "authority_media_plan": [
    {"platform_key": "", "platform": "", "platform_type": "authority_media", "source_origin": "penetration_detected", "role": "", "keyword_focus": "", "sample_title": "", "cadence": ""}
  ],
  "geo_monitoring_plan": [{"metric": "", "method": "", "target": "", "cadence": "每周/每月", "contentAction": "指标未达标时优先制作或更新什么内容", "evidenceRequired": "复盘时需要核验的回答、信源或资料"}],
  "execution_roadmap": [{"phase": "", "focus": "", "deliverable": ""}]
}`
  )

  return sections.join("\n")
}

async function callLlm(args: {
  system: string
  user: string
  attempt: number
  timeoutSec: number
}): Promise<string> {
  return runAdapterCredentialPoolChat("doubao", "keywordStrategy", {
    system: args.attempt === 0
      ? args.system
      : `${args.system}\n\n注意：上次输出无法解析、字段不完整或关键词质量校验失败。请严格输出完整合法 JSON，不要包含额外文字、代码块标记或注释。`,
    user: args.attempt === 0
      ? args.user
      : `${args.user}\n\n请确保本次只输出完整 JSON 对象，并包含 project_name、summary、profile、keyword_strategy、official_site_strategy、third_party_site_strategy、media_plan、authority_media_plan、geo_monitoring_plan、execution_roadmap。四个关键词分组都至少 3 条，keyword 和 logic 均不可为空，跨分组不得重复。`,
    temperature: args.attempt === 0 ? 0.3 : 0.15,
    maxTokens: 16384,
    jsonMode: true,
    allowWebSearch: false,
    timeoutSec: args.timeoutSec,
  })
}

function parseJsonResult(raw: string): unknown {
  return parseJsonLoose(raw)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasRequiredStrategyShape(
  value: unknown,
  customKeywords: string[] = [],
): value is GeoStrategyPlan {
  if (!isRecord(value)) return false
  if (!value.project_name || !value.summary) return false
  if (!isRecord(value.profile)) return false
  if (!isRecord(value.keyword_strategy)) return false
  const keywordGroups = [
    value.keyword_strategy.core_keywords,
    value.keyword_strategy.pain_advantage_keywords,
    value.keyword_strategy.weakness_conversion_keywords,
    value.keyword_strategy.scenario_keywords,
  ]
  if (keywordGroups.some(group => !Array.isArray(group) || group.length < 3)) return false
  const seenKeywords = new Set<string>()
  const keywordTexts: string[] = []
  for (const group of keywordGroups) {
    for (const item of group as unknown[]) {
      if (!isRecord(item)) return false
      const keyword = String(item.keyword || "").trim()
      const logic = String(item.logic || "").trim()
      const key = keyword.replace(/\s+/g, "").toLowerCase()
      if (!keyword || !logic || seenKeywords.has(key)) return false
      seenKeywords.add(key)
      keywordTexts.push(`${keyword}${logic}`.replace(/\s+/g, "").toLowerCase())
    }
  }
  if (customKeywords.some(keyword => {
    const key = keyword.replace(/\s+/g, "").toLowerCase()
    return key && !keywordTexts.some(item => item.includes(key))
  })) return false
  if (!Array.isArray(value.official_site_strategy)) return false
  if (!Array.isArray(value.third_party_site_strategy)) return false
  if (!Array.isArray(value.media_plan)) return false
  if (!Array.isArray(value.geo_monitoring_plan)) return false
  if (!Array.isArray(value.execution_roadmap)) return false
  return true
}

async function generateStrategyWithRetries(args: {
  userPrompt: string
  timeoutSec: number
  customKeywords?: string[]
}): Promise<GeoStrategyPlan> {
  let lastRaw = ""
  let lastError = ""

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      lastRaw = await callLlm({
        system: SYSTEM_PROMPT,
        user: args.userPrompt,
        attempt,
        timeoutSec: args.timeoutSec,
      })
      const parsed = parseJsonResult(lastRaw)
      if (hasRequiredStrategyShape(parsed, args.customKeywords)) return parsed
      lastError = parsed
        ? "AI 返回 JSON 但缺少必要策略字段"
        : "AI 返回内容无法解析为 JSON"
      console.warn(`[geo-strategy] attempt ${attempt + 1} invalid: ${lastError}`)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      console.warn(`[geo-strategy] attempt ${attempt + 1} failed:`, error)
      if (attempt === 2) throw error
    }
  }

  throw new Error(lastError || "AI 返回格式异常")
}

async function handler(req: NextRequest) {
  let reservation: CreditReservation | null = null
  try {
    const body = await req.json()
    const { profile } = body
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      return NextResponse.json({ error: "请提供客户资料" }, { status: 400 })
    }
    const sourcePlatformSnapshot = isRecord(body.sourcePlatformContext)
      && Array.isArray(body.sourcePlatformContext.platforms)
      ? body.sourcePlatformContext as unknown as SourcePlatformSnapshot
      : undefined
    const settings = normalizeKeywordStrategySettings(
      body.strategySettings,
      String(
        body.strategySettings?.target_region
        || profile.person_profile?.region
        || (Array.isArray(profile.terms) ? profile.terms.join("、") : "")
        || "不限地域",
      ),
    )

    const aiConfig = await getAiProviderRuntimeSetting("doubao")
    const timeoutSec = Math.min(aiConfig.timeout || 300, 240)
    if (!await isKeywordStrategyWebReady()) {
      return NextResponse.json({
        error: "后台尚未配置可用于关键词策略的豆包官方联网模型，请管理员补全豆包 API Key、模型和联网能力后重试",
      }, { status: 400 })
    }

    const creditGuard = await authAndReserveCreditsForRequest(req, CREDIT_COST, {
      featureKey: FEATURE_KEY,
      source: "api:geo-strategy:generate",
      description: getFeaturePrice(FEATURE_KEY).label,
    })
    if (!creditGuard.ok) return creditGuard.response
    reservation = creditGuard.reservation

    const research = await researchKeywordStrategyContext({
      profile,
      settings,
    })
    const userPrompt = buildUserPrompt(profile, settings, research, sourcePlatformSnapshot)
    const generatedStrategy = await generateStrategyWithRetries({
      userPrompt,
      timeoutSec,
      customKeywords: settings.custom_keywords,
    })
    generatedStrategy.profile.subject_type = profile.subject_type === "person" ? "person" : "brand"
    if (generatedStrategy.profile.subject_type === "person") {
      generatedStrategy.profile.person_profile = (
        profile.person_profile
        && typeof profile.person_profile === "object"
        && !Array.isArray(profile.person_profile)
      )
        ? profile.person_profile as GeoStrategyPlan["profile"]["person_profile"]
        : undefined
    }
    generatedStrategy.strategy_engine_version = KEYWORD_STRATEGY_METHODOLOGY_VERSION
    generatedStrategy.generation_settings = settings
    generatedStrategy.keyword_research = research
    generatedStrategy.quality_audit = auditKeywordStrategyPlan(generatedStrategy, research)
    const strategy = linkStrategyToSourcePlatforms(generatedStrategy, sourcePlatformSnapshot)

    reservation = null
    return NextResponse.json(strategy)
  } catch (error) {
    await refundReservedCreditsQuietly(reservation)
    console.error("[geo-strategy]", error)
    const message = error instanceof Error ? error.message : "未知错误"
    if (message.includes("API Key") || message.includes("401")) {
      return NextResponse.json({ error: "API Key 无效或无权限" }, { status: 401 })
    }
    if (message.includes("timeout") || message.includes("timed out") || message.includes("超时")) {
      return NextResponse.json({ error: "策略生成时间过长，请稍后重试，或在后台增加关键词策略模型超时时间" }, { status: 504 })
    }
    if (message.includes("fetch") || message.includes("连接失败")) {
      return NextResponse.json({ error: "API 连接失败，请检查接口地址和网络连接" }, { status: 502 })
    }
    if (/JSON|无法解析|格式异常|缺少必要策略字段/i.test(message)) {
      return NextResponse.json({ error: "AI 返回的策略格式不完整，系统自动重试后仍未恢复，请重新生成。" }, { status: 422 })
    }
    return NextResponse.json({ error: `策略生成失败: ${message}` }, { status: 500 })
  }
}

export const POST = handler
