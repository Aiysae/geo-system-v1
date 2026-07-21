import { NextRequest, NextResponse } from "next/server"
import { openaiCompatChat } from "@/lib/llm/openai-compat"
import { getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import {
  authAndReserveCreditsForRequest,
  refundReservedCreditsQuietly,
  settleReservedCredits,
  type CreditReservation,
} from "@/lib/with-credits"
import { estimateFeatureCredits, getFeaturePrice } from "@/lib/pricing"
import {
  arePenetrationQuestionsSemanticallySimilar,
  buildPenetrationCategoryQuotas,
  buildPenetrationQuestionSamples,
  buildPenetrationSampleQuality,
  inferPenetrationQuestionCategory,
  normalizePenetrationQuestionCategories,
  normalizePenetrationQuestionCategory,
  normalizePenetrationQuestionGenerationSettings,
  PENETRATION_QUESTION_CATEGORY_LABELS,
} from "@/lib/penetration/sample-design"
import type {
  AnalysisSubjectType,
  PenetrationQuestionCategory,
  PenetrationQuestionIntentHint,
} from "@/types"

// 高频疑问句智能生成 · 豆包专用 (Volcengine Ark)
//
// 设计纪律：
//   - 优先使用后台配置的 Bot ID（bot-xxxx），走 /api/v3/bots/chat/completions。
//   - 未配置 Bot 时，允许回退到后台配置的 Endpoint ID（ep-xxxx），走 /api/v3/chat/completions。
//   - 避免部署环境只配置普通 Endpoint 时，智能生成入口被错误阻断。
//   - 系统提示强约束模型按七类意图输出结构化 JSON。
//   - 后端对返回做宽松解析：兼容 markdown 代码块、双引号/单引号、对象/数组两种 shape。
//   - 任何上游失败一律把具体错误（含 Volcengine 的 code/message）透传到前端 Toast。

export const runtime = "nodejs"
export const maxDuration = 180
export const dynamic = "force-dynamic"
export const revalidate = 0

const ARK_BOT_URL = "https://ark.cn-beijing.volces.com/api/v3/bots/chat/completions"
const ARK_ENDPOINT_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions"

const SYSTEM_PROMPT =
  "你是一个顶级的 GEO (生成式引擎优化) 样本设计专家。你的唯一任务是站在【完全中立的真实用户视角】，按指定的问题意图和数量生成高频疑问句。" +
  "【绝对禁令】疑问句中严禁出现任何具体品牌名、公司名、产品名、服务商名或人物姓名；目标对象只用于理解行业，绝对不可写进问题。" +
  "同一类别不得只换词重复，问题必须在需求、决策阶段、场景或风险上真正不同。" +
  "你必须只返回 JSON 数组，每项格式为 {\"question\":\"问题\",\"category\":\"指定的中文类别名称\"}，不要输出任何解释或 markdown。"

const CATEGORY_GUIDANCE: Record<PenetrationQuestionCategory, string> = {
  recommendation: "寻找行业榜单、常见选择或值得推荐的对象",
  pain_solution: "围绕失败、效果不佳、使用难题及解决办法",
  comparison: "比较不同方案、路线或供应类型的差异与取舍",
  purchase_decision: "预算、价格、参数、合同、交付及采购判断",
  scenario_audience: "具体地区、人群、身份、规模或使用场景",
  brand_cognition: "了解行业品牌实力、口碑、地位和判断依据",
  risk_concern: "风险、避坑、资质、安全、隐形收费及售后疑虑",
}

type GeneratedQuestionItem = {
  question: string
  category: PenetrationQuestionCategory
}

type QuestionQuota = {
  category: PenetrationQuestionCategory
  count: number
}

function buildUserPrompt(args: {
  industry: string
  brand: string
  subjectType: AnalysisSubjectType
  keywords: string
  quotas: QuestionQuota[]
  refill: boolean
}): string {
  const industryDesc = args.industry || (args.subjectType === "person" ? "专业服务人物" : "通用消费场景")
  const count = args.quotas.reduce((sum, item) => sum + item.count, 0)
  const kw = args.keywords.trim()
  const kwLine = kw
    ? `问题可以自然包含这些行业关键词（不必每句全含）：[${kw}]。`
    : ""
  const targetLabel = args.subjectType === "person" ? "目标人物姓名" : "目标品牌"
  const targetForbid = args.brand
    ? `【硬性禁令】严禁出现"${args.brand}"及其变体、简称或拼音，也不要通过暗示答案来指向它。`
    : `【硬性禁令】严禁出现任何具体的${args.subjectType === "person" ? "人物姓名或机构名称" : "品牌名、公司名或产品名"}。`
  const quotaLines = args.quotas.map(({ category, count: quota }) => {
    const guidance = category === "brand_cognition" && args.subjectType === "person"
      ? "了解行业人物的专业能力、口碑、地位和判断依据"
      : CATEGORY_GUIDANCE[category]
    const label = category === "brand_cognition" && args.subjectType === "person"
      ? "人物认知型"
      : PENETRATION_QUESTION_CATEGORY_LABELS[category]
    return `- ${label}：${quota} 条；${guidance}`
  })

  return [
    `请为【行业/描述：${industryDesc}】${args.refill ? "补充生成" : "生成"} ${count} 句高频疑问句。`,
    `这些问题用于盲测主流 AI 在没有${targetLabel}提示时的自然回答，必须站在完全中立、不了解目标对象的真实用户视角。`,
    targetForbid,
    kwLine,
    "本次只允许生成以下问题意图，并严格满足各类数量：",
    ...quotaLines,
    "要求：",
    "1. category 只能使用上面列出的类别，禁止生成未选择的类别；",
    "2. 使用口语化中文，模拟真实用户会在搜索框中输入的完整问句；",
    "3. 每句必须是不同的真实搜索意图，不得只替换形容词、地区或语序凑数；",
    "4. 不预设答案，不植入目标对象优势，不带编号；",
    "5. 严格只输出 JSON 数组，例如：[{\"question\":\"这个行业有哪些值得推荐的服务商？\",\"category\":\"榜单推荐型\"}]。",
  ]
    .filter(Boolean)
    .join("\n")
}

// 后端兜底过滤：万一 AI 不听话，把含品牌名的句子剔除掉
function stripBrandedQuestions(
  questions: GeneratedQuestionItem[],
  brand: string,
): GeneratedQuestionItem[] {
  if (!brand) return questions
  const b = brand.toLowerCase().replace(/\s+/g, "")
  return questions.filter(item => {
    const norm = item.question.toLowerCase().replace(/\s+/g, "")
    return !norm.includes(b)
  })
}

function parseQuestionArray(value: unknown): GeneratedQuestionItem[] | null {
  if (!Array.isArray(value)) return null
  const items = value.flatMap(item => {
    if (typeof item === "string") {
      const question = item.trim()
      return question
        ? [{ question, category: inferPenetrationQuestionCategory(question) }]
        : []
    }
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    const question = String(
      record.question || record.query || record.text || record.title || "",
    ).trim()
    if (!question) return []
    const category = normalizePenetrationQuestionCategory(record.category)
      || inferPenetrationQuestionCategory(question)
    return [{ question, category }]
  })
  return items.length > 0 ? items : null
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    try {
      return JSON.parse(value.replace(/'/g, '"'))
    } catch {
      return null
    }
  }
}

// 宽松解析：兼容 ```json 包裹、对象 {questions:[...]}、字符串数组与结构化数组。
function parseQuestionsFromLLM(raw: string): GeneratedQuestionItem[] | null {
  let s = raw.trim()
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "")
  }

  // 优先尝试纯数组
  const lb = s.indexOf("[")
  const rb = s.lastIndexOf("]")
  if (lb >= 0 && rb > lb) {
    const arrSlice = s.slice(lb, rb + 1)
    const arr = parseQuestionArray(tryParseJson(arrSlice))
    if (arr) return arr
  }

  const lc = s.indexOf("{")
  const rc = s.lastIndexOf("}")
  if (lc >= 0 && rc > lc) {
    const parsed = tryParseJson(s.slice(lc, rc + 1))
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>
      for (const k of ["questions", "data", "items", "list", "result"]) {
        const items = parseQuestionArray(obj[k])
        if (items) return items
      }
    }
  }

  return null
}

function deduplicateGeneratedQuestions(
  items: GeneratedQuestionItem[],
): GeneratedQuestionItem[] {
  const accepted: GeneratedQuestionItem[] = []
  for (const item of items) {
    const duplicate = accepted.some(previous => (
      previous.category === item.category
      && arePenetrationQuestionsSemanticallySimilar(previous.question, item.question)
    ))
    if (!duplicate) accepted.push(item)
  }
  return accepted
}

function selectQuestionsByQuotas(
  items: GeneratedQuestionItem[],
  quotas: QuestionQuota[],
): GeneratedQuestionItem[] {
  const selected: GeneratedQuestionItem[] = []
  for (const { category, count } of quotas) {
    selected.push(...items.filter(item => item.category === category).slice(0, count))
  }
  return selected
}

function missingQuestionQuotas(
  selected: GeneratedQuestionItem[],
  quotas: QuestionQuota[],
): QuestionQuota[] {
  return quotas.flatMap(item => {
    const selectedCount = selected.filter(candidate => candidate.category === item.category).length
    const missing = Math.max(0, item.count - selectedCount)
    return missing > 0 ? [{ category: item.category, count: missing }] : []
  })
}

// 从 openai-compat 抛出的 Error.message（形如：`豆包 接口调用失败 HTTP 404：{...}`）
// 中提取 Volcengine 的 code/message，给前端 Toast 一个可读的中文摘要。
function humanizeUpstreamError(rawMsg: string, currentModel: string, modelType: string): string {
  // 先尝试找到 JSON 片段
  const lb = rawMsg.indexOf("{")
  const rb = rawMsg.lastIndexOf("}")
  if (lb >= 0 && rb > lb) {
    try {
      const obj = JSON.parse(rawMsg.slice(lb, rb + 1)) as {
        error?: { code?: string; message?: string }
        code?: string
        message?: string
      }
      const code = obj?.error?.code || obj?.code || ""
      const message = obj?.error?.message || obj?.message || ""
      if (code === "InvalidEndpointOrModel.NotFound" || /not.?found/i.test(code)) {
        return `豆包调用失败：未找到该 ${modelType}（${currentModel || "未配置"}）。请到火山方舟控制台确认模型已创建/发布，且后台模型配置正确。`
      }
      if (/quota|balance|insufficient/i.test(code) || /余额|额度|配额/i.test(message)) {
        return `豆包调用失败：账户余额或配额不足。请到火山方舟控制台充值后重试。原始信息：${message || code}`
      }
      if (/auth|unauthorized|api.?key/i.test(code) || /鉴权|未授权|key/i.test(message)) {
        return `豆包调用失败：鉴权失败。请检查后台管理页中的豆包 API Key 是否正确并对当前 ${modelType} 有权限。原始信息：${message || code}`
      }
      if (code || message) {
        return `豆包调用失败：${code ? `[${code}] ` : ""}${message || rawMsg}`
      }
    } catch {
      /* fall-through to原文 */
    }
  }
  return `豆包调用失败：${rawMsg}`
}

async function handler(req: NextRequest) {
  let reservation: CreditReservation | null = null
  try {
    const doubaoConfig = await getAiProviderRuntimeSetting("doubao")
    const apiKey = doubaoConfig.apiKey
    const botId = typeof doubaoConfig.extra.botId === "string" ? doubaoConfig.extra.botId : ""
    const endpointId = doubaoConfig.model
    const currentModel = botId || endpointId
    const modelType = botId ? "Bot ID" : "Endpoint ID"

    if (!apiKey) {
      return NextResponse.json(
        { error: "生成失败：豆包 API Key 未配置，请在后台管理页补全后重试。" },
        { status: 500 }
      )
    }
    if (!botId) {
      if (!endpointId) {
        return NextResponse.json(
          {
            error:
              "生成失败：未配置豆包 Bot ID 或 Endpoint ID。请在后台管理页至少配置一个豆包 Bot（bot- 开头）或 Endpoint（ep- 开头）后重试。",
          },
          { status: 500 }
        )
      }
    }
    if (botId && !botId.startsWith("bot-")) {
      return NextResponse.json(
        {
          error: `生成失败：豆包 Bot ID 必须以 "bot-" 开头（当前值：${botId}）。如需使用 ep- 开头的 Endpoint，请配置到模型/Endpoint ID。`,
        },
        { status: 500 }
      )
    }
    if (!botId && endpointId && !endpointId.startsWith("ep-")) {
      return NextResponse.json(
        {
          error: `生成失败：豆包 Endpoint ID 必须以 "ep-" 开头（当前值：${endpointId}）。`,
        },
        { status: 500 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const industry = String(body?.industry ?? "").trim()
    const brand = String(body?.brand ?? "").trim()
    const subjectType: AnalysisSubjectType = body?.subjectType === "person" ? "person" : "brand"
    const requestedCategories = normalizePenetrationQuestionCategories(body?.categories)
    if (Array.isArray(body?.categories) && requestedCategories.length === 0) {
      return NextResponse.json(
        { error: "请至少选择一种有效的问题意图" },
        { status: 400 },
      )
    }
    const settings = normalizePenetrationQuestionGenerationSettings({
      count: body?.count,
      keywords: body?.keywords,
      allocationMode: body?.allocationMode,
      categories: requestedCategories.length > 0 ? requestedCategories : undefined,
      categoryCounts: body?.categoryCounts,
    })
    const quotas = buildPenetrationCategoryQuotas(
      settings.count,
      settings.categories,
      settings.allocationMode === "custom" ? settings.categoryCounts : undefined,
    )
    const count = quotas.reduce((sum, item) => sum + item.count, 0)
    if (count > 84) {
      return NextResponse.json(
        { error: "单次最多智能生成 84 条疑问句，请调整各意图数量" },
        { status: 400 },
      )
    }

    if (!industry && !brand) {
      return NextResponse.json(
        { error: `请先填写${subjectType === "person" ? "目标人物的专业领域" : "所属行业"}，再生成高频疑问句` },
        { status: 400 },
      )
    }

    const featureKey = "legacyQueryGenerateUnit"
    const cost = estimateFeatureCredits(featureKey, count)
    const guard = await authAndReserveCreditsForRequest(req, cost, {
      featureKey,
      source: "api:generate-queries",
      description: getFeaturePrice(featureKey).label,
      metadata: {
        requestedCount: count,
        categories: settings.categories.join(","),
        allocationMode: settings.allocationMode,
      },
    })
    if (!guard.ok) return guard.response
    reservation = guard.reservation

    const t0 = Date.now()
    const selectedCategories = new Set(settings.categories)
    let allCandidates: GeneratedQuestionItem[] = []
    let finalItems: GeneratedQuestionItem[] = []
    let requestedQuotas = quotas
    let rawGeneratedCount = 0
    let removedBrandCount = 0
    let removedCategoryCount = 0

    try {
      for (let attempt = 0; attempt < 2 && requestedQuotas.length > 0; attempt++) {
        const requestCount = requestedQuotas.reduce((sum, item) => sum + item.count, 0)
        const content = await openaiCompatChat({
          url: botId ? ARK_BOT_URL : ARK_ENDPOINT_URL,
          apiKey,
          model: currentModel,
          label: "豆包",
          system: SYSTEM_PROMPT,
          user: buildUserPrompt({
            industry,
            brand,
            subjectType,
            keywords: settings.keywords,
            quotas: requestedQuotas,
            refill: attempt > 0,
          }),
          temperature: 0.45,
          maxTokens: Math.min(12000, Math.max(2500, requestCount * 150)),
        })

        const parsed = parseQuestionsFromLLM(content)
        if (!parsed || parsed.length === 0) {
          console.error("[generate-queries] 豆包返回无法解析为疑问句数组：", content.slice(0, 300))
          throw new Error("生成失败：豆包返回内容无法解析为有效疑问句 JSON，请重试")
        }

        rawGeneratedCount += parsed.length
        const neutral = stripBrandedQuestions(parsed, brand)
        removedBrandCount += parsed.length - neutral.length
        const scoped = neutral.filter(item => selectedCategories.has(item.category))
        removedCategoryCount += neutral.length - scoped.length
        allCandidates = deduplicateGeneratedQuestions([...allCandidates, ...scoped])
        finalItems = selectQuestionsByQuotas(allCandidates, quotas)
        requestedQuotas = missingQuestionQuotas(finalItems, quotas)
      }
    } catch (upstream) {
      const raw = upstream instanceof Error ? upstream.message : String(upstream)
      const friendly = raw.startsWith("生成失败：")
        ? raw
        : humanizeUpstreamError(raw, currentModel, modelType)
      console.error("[generate-queries] 豆包 Bot 上游失败：", raw)
      await refundReservedCreditsQuietly(reservation)
      reservation = null
      return NextResponse.json({ error: friendly }, { status: 502 })
    }

    if (finalItems.length === 0) {
      console.error(
        `[generate-queries] AI 返回 ${rawGeneratedCount} 条，但品牌中立和意图过滤后无有效问题`,
      )
      await refundReservedCreditsQuietly(reservation)
      reservation = null
      return NextResponse.json(
        {
          error:
            "生成失败：AI 返回的问题未通过品牌中立和所选意图校验，请重试一次。",
        },
        { status: 502 },
      )
    }

    const final = finalItems.map(item => item.question)
    const questionIntents: PenetrationQuestionIntentHint[] = finalItems.map(item => ({
      question: item.question,
      category: item.category,
    }))
    const questionSamples = buildPenetrationQuestionSamples(final, questionIntents)
    const sampleQuality = buildPenetrationSampleQuality(final, {
      questionIntents,
      intendedCategories: settings.categories,
    })
    const missing = missingQuestionQuotas(finalItems, quotas)
    const warnings = missing.length > 0
      ? [
          `计划生成 ${count} 条，严格过滤后得到 ${final.length} 条；仍缺少${missing.map(item => `${PENETRATION_QUESTION_CATEGORY_LABELS[item.category]} ${item.count} 条`).join("、")}。`,
        ]
      : []

    console.log(
      `[generate-queries] ✓ 豆包返回 ${rawGeneratedCount} 条 → 去品牌 ${removedBrandCount} 条 → 去非目标意图 ${removedCategoryCount} 条 → 最终 ${final.length}/${count} 条 | ${Date.now() - t0}ms`,
    )

    await settleReservedCredits(reservation, estimateFeatureCredits(featureKey, final.length))
    reservation = null
    return NextResponse.json(
      {
        questions: final,
        questionItems: questionIntents,
        questionSamples,
        sampleQuality,
        requestedCount: count,
        warnings,
        generatedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
          Expires: "0",
        },
      },
    )
  } catch (e) {
    await refundReservedCreditsQuietly(reservation)
    const msg = e instanceof Error ? e.message : "未知错误"
    console.error("[generate-queries] 未捕获异常：", msg)
    return NextResponse.json({ error: `生成失败：${msg}` }, { status: 500 })
  }
}


export const POST = handler
