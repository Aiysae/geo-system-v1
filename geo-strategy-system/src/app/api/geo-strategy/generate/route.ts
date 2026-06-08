import { NextRequest, NextResponse } from "next/server"
import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { openaiCompatChat } from "@/lib/llm/openai-compat"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

const SYSTEM_PROMPT = `你是一个资深 GEO（生成式引擎优化）策略顾问，服务对象是帮助企业提升在 ChatGPT、DeepSeek、豆包、Kimi、通义等生成式引擎中的被理解、被引用和被推荐概率。

你需要基于客户资料、调研报告、AI 提及检测报告、截图 OCR 文本和用户补充说明，生成可直接交付给客户的 GEO 优化策略方案。

必须遵守：
1. GEO 策略分为官网/第三方网站和自媒体内容两条主线。
2. 官网是第一事实源，必须先给出官网建设策略；第三方网站负责信息包围、劣势转优势和交叉验证。
3. 自媒体内容负责关键词、疑问句和目标客户真实提问方式覆盖。
4. 关键词按痛点/优势、主要劣势、客户场景需求三类制定。
5. 疑问句采用两层挖掘法，第二层比例受控。
6. 第三方网站策略不是普通媒体发布计划，而是“搭建第三方网站”的策略，例如测评类网站、交流论坛、问答知识库、案例口碑站、对比榜单站等。
7. 每个第三方网站都必须说明它针对哪类劣势，以及如何把这个劣势转化为优势叙事。
8. 输出必须是严格 JSON，不要输出 Markdown，不要解释 JSON 外的任何文字。`

function buildUserPrompt(profile: Record<string, unknown>): string {
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
    "要求：",
    "- 不要把 OCR 噪声、评分表、页码、模型名错误拼进策略。",
    "- 不要编造无法从资料推断的硬事实。",
    "- 可以基于资料做策略推断，但表达要具体。",
    "- 将优势内容转化为 GEO 可信事实资产：围绕优势中的具体数字，规划官网/第三方/自媒体的引用布局。",
    "- official_site_strategy 必须是“官网建设策略”，并且排在第三方网站策略之前。至少包含：首页信任首屏、产品/服务详情页、优势数据页、案例/口碑页、FAQ/对比页、结构化数据与 About/品牌事实页。",
    "- keyword_strategy 必须包含 core_keywords、pain_advantage_keywords、weakness_conversion_keywords、scenario_keywords。",
    "- third_party_site_strategy 必须是“搭建第三方网站”的策略，不要写成知乎、小红书、公众号、百家号、头条号、B站这些自媒体平台。",
    "- third_party_site_strategy 至少 5 个站点类型，优先包含：测评类网站、交流论坛、问答知识库、案例/口碑站、对比/榜单站、行业资料库。",
    "- 每个 third_party_site_strategy 条目必须填写 weakness_conversion：说明这个站点迎合哪个劣势，并如何把劣势打造为优势。",
    "- media_plan 至少包含知乎、小红书、公众号、百家号、头条号、B站专栏。",
    "- geo_monitoring_plan 至少包含品牌主动提及率、引用/事实一致性、第三方交叉验证覆盖、疑问句内容覆盖率。",
    "- execution_roadmap 至少包含第1周、第2-3周、第3-5周、持续执行。",
    "",
    "输出 JSON Schema：",
    `{
  "project_name": "",
  "summary": "",
  "profile": {
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
    {"platform": "", "role": "", "keyword_focus": "", "sample_title": "", "cadence": ""}
  ],
  "geo_monitoring_plan": [{"metric": "", "method": "", "target": ""}],
  "execution_roadmap": [{"phase": "", "focus": "", "deliverable": ""}]
}`
  )

  return sections.join("\n")
}

async function callLlm(url: string, apiKey: string, model: string, system: string, user: string, retries = 2): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await openaiCompatChat({
        url,
        apiKey,
        model,
        system: attempt === 0 ? system : `${system}\n\n注意：上次输出 JSON 解析失败，请严格输出合法 JSON，不要包含任何额外文字、代码块标记或注释。`,
        user,
        temperature: attempt === 0 ? 0.4 : 0.2,
        maxTokens: 16384,
        jsonMode: true,
        label: "GEO策略",
      })
      return result
    } catch (err) {
      if (attempt === retries) throw err
      console.warn(`[geo-strategy] LLM call attempt ${attempt + 1} failed, retrying...`, err)
    }
  }
  throw new Error("LLM 调用全部失败")
}

function parseJsonResult(raw: string): unknown {
  let cleaned = raw.trim()
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenceMatch) cleaned = fenceMatch[1].trim()
  else if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    const repaired = cleaned
      .replace(/\/\/.*$/gm, "")
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/'/g, '"')
    try {
      return JSON.parse(repaired)
    } catch {
      return null
    }
  }
}

async function handler(req: NextRequest) {
  try {
    const body = await req.json()
    const { profile } = body

    if (!profile) {
      return NextResponse.json({ error: "请提供客户资料" }, { status: 400 })
    }

    const aiConfig = await getAiProviderRuntimeSetting("keywordStrategy")
    const url = buildAiChatUrl(aiConfig)

    if (!aiConfig.apiKey) {
      return NextResponse.json({ error: "后台未配置关键词策略模型 API Key，请联系管理员在后台管理页配置" }, { status: 400 })
    }

    const userPrompt = buildUserPrompt(profile)
    const raw = await callLlm(url, aiConfig.apiKey, aiConfig.model, SYSTEM_PROMPT, userPrompt)

    const parsed = parseJsonResult(raw)
    if (!parsed) {
      const raw2 = await callLlm(url, aiConfig.apiKey, aiConfig.model,
        SYSTEM_PROMPT + "\n\n重要：上次输出 JSON 解析失败。请只输出纯 JSON，不要任何代码块标记、注释或额外文字。",
        userPrompt + "\n\n请确保输出是纯粹合法的 JSON 对象。",
        1
      )
      const parsed2 = parseJsonResult(raw2)
      if (!parsed2) {
        return NextResponse.json({
          error: "AI 返回格式异常，即使重试后仍无法解析",
          raw: raw2.slice(0, 2000),
        }, { status: 422 })
      }
      return NextResponse.json(parsed2)
    }

    return NextResponse.json(parsed)
  } catch (error) {
    console.error("[geo-strategy]", error)
    const message = error instanceof Error ? error.message : "未知错误"
    if (message.includes("API Key") || message.includes("401")) {
      return NextResponse.json({ error: "API Key 无效或无权限" }, { status: 401 })
    }
    if (message.includes("timeout") || message.includes("timed out")) {
      return NextResponse.json({ error: "模型响应超时（LLM 思考时间过长），请增加超时时间后重试" }, { status: 504 })
    }
    if (message.includes("fetch")) {
      return NextResponse.json({ error: "API 连接失败，请检查接口地址和网络连接" }, { status: 502 })
    }
    return NextResponse.json({ error: `策略生成失败: ${message}` }, { status: 500 })
  }
}

export const POST = handler
