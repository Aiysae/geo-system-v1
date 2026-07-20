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
  normalizePenetrationQuestionCategory,
  PENETRATION_QUESTION_CATEGORY_LABELS,
} from "@/lib/penetration/sample-design"
import type { PenetrationQuestionCategory } from "@/types"

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
  "你是一个顶级的 GEO (生成式引擎优化) 样本设计专家。你的唯一任务是站在【完全中立的普通消费者视角】，生成覆盖七类真实搜索意图的高频疑问句。" +
  "【绝对禁令】这些疑问句中严禁出现任何具体的品牌名、公司名、产品名、服务商名（包括但不限于用户告诉你的目标品牌——目标品牌只用于让你理解所处行业，绝对不可写进任何疑问句中）。" +
  "同一意图不得只换词重复，问题应在需求、决策阶段、场景和风险上真正不同。" +
  "你必须只返回 JSON 数组，每项格式为 {\"question\":\"问题\",\"category\":\"七类中文名称之一\"}，不要输出任何解释或 markdown。"

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

function buildUserPrompt(args: {
  industry: string
  brand: string
  count: number
  keywords: string
}): string {
  // 注意：品牌名仅用于让 AI 理解"所处行业"上下文，绝不允许出现在生成的疑问句中。
  const industryDesc = args.industry || "通用消费场景"
  const kw = args.keywords.trim()
  const kwLine = kw
    ? `这些疑问句中可以自然地包含以下行业关键词（任意一个或多个，不必每句全含）：[${kw}]。`
    : ""
  const brandForbid = args.brand
    ? `【硬性禁令】严禁在任何疑问句中出现"${args.brand}"或其任何变体/缩写/拼音。若不慎写出，本次输出视为无效。`
    : "【硬性禁令】严禁在任何疑问句中出现任何具体的品牌名、公司名或产品名。"
  const quotas = buildPenetrationCategoryQuotas(args.count)
  const quotaLines = quotas.map(({ category, count }) => (
    `- ${PENETRATION_QUESTION_CATEGORY_LABELS[category]}：${count} 条；${CATEGORY_GUIDANCE[category]}`
  ))

  return [
    `请为【行业/描述：${industryDesc}】生成 ${args.count} 句高频疑问句。`,
    "这些疑问句用于检测该行业内主流 AI 大模型在没有任何品牌提示时会自然推荐哪些品牌，因此【必须站在完全中立的、还不认识任何品牌的普通消费者视角】，只问行业通用问题。",
    brandForbid,
    kwLine,
    "要求：",
    "1. 必须严格按以下七类配额生成，不能用大量推荐榜单问题代替其他类别：",
    ...quotaLines,
    "2. 站在真实潜在客户视角，用口语化中文，模拟普通消费者在搜索框里会输入的完整问句；",
    "3. 每句必须是不同的真实搜索意图，不得仅替换形容词、地区或语序来凑数；",
    "4. 问题中不要预设答案，不要植入目标对象优势，不要带编号；",
    "5. category 只能使用上面七类中文名称，数量必须严格匹配配额；",
    "6. 严格只输出 JSON 数组，例如：[{\"question\":\"这个行业有哪些值得推荐的服务商？\",\"category\":\"榜单推荐型\"}]。",
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

function selectBalancedQuestions(
  items: GeneratedQuestionItem[],
  count: number,
): GeneratedQuestionItem[] {
  const selected: GeneratedQuestionItem[] = []
  const selectedQuestions = new Set<string>()
  for (const { category, count: quota } of buildPenetrationCategoryQuotas(count)) {
    for (const item of items) {
      if (item.category !== category || selectedQuestions.has(item.question)) continue
      selected.push(item)
      selectedQuestions.add(item.question)
      if (selected.filter(candidate => candidate.category === category).length >= quota) break
    }
  }
  for (const item of items) {
    if (selected.length >= count) break
    if (selectedQuestions.has(item.question)) continue
    selected.push(item)
    selectedQuestions.add(item.question)
  }
  return selected.slice(0, count)
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
    const keywords = String(body?.keywords ?? "").trim()
    const rawCount = Number(body?.count)
    const count = Number.isFinite(rawCount) ? Math.max(1, Math.min(84, Math.round(rawCount))) : 28

    if (!industry && !brand) {
      return NextResponse.json(
        { error: "请先在客户信息中填写所属行业，再生成高频疑问句" },
        { status: 400 }
      )
    }

    const featureKey = "legacyQueryGenerateUnit"
    const cost = estimateFeatureCredits(featureKey, count)
    const guard = await authAndReserveCreditsForRequest(req, cost, {
      featureKey,
      source: "api:generate-queries",
      description: getFeaturePrice(featureKey).label,
      metadata: { requestedCount: count },
    })
    if (!guard.ok) return guard.response
    reservation = guard.reservation

    const t0 = Date.now()
    let content: string
    try {
      content = await openaiCompatChat({
        url: botId ? ARK_BOT_URL : ARK_ENDPOINT_URL,
        apiKey,
        model: currentModel,
        label: "豆包",
        system: SYSTEM_PROMPT,
        user: buildUserPrompt({ industry, brand, count, keywords }),
        temperature: 0.7,
        maxTokens: Math.min(12000, Math.max(2500, count * 130)),
      })
    } catch (upstream) {
      const raw = upstream instanceof Error ? upstream.message : String(upstream)
      const friendly = humanizeUpstreamError(raw, currentModel, modelType)
      console.error("[generate-queries] 豆包 Bot 上游失败：", raw)
      await refundReservedCreditsQuietly(reservation)
      reservation = null
      return NextResponse.json({ error: friendly }, { status: 502 })
    }

    const questions = parseQuestionsFromLLM(content)
    if (!questions || questions.length === 0) {
      console.error("[generate-queries] 豆包返回无法解析为疑问句数组：", content.slice(0, 300))
      await refundReservedCreditsQuietly(reservation)
      reservation = null
      return NextResponse.json(
        { error: "生成失败：豆包返回内容无法解析为有效疑问句 JSON，请重试" },
        { status: 502 }
      )
    }

    // 兜底：剔除任何含目标品牌名的问句，避免渗透率虚假 100%
    const neutralQuestions = stripBrandedQuestions(questions, brand)
    const filtered = deduplicateGeneratedQuestions(neutralQuestions)
    if (filtered.length === 0) {
      console.error(
        `[generate-queries] AI 生成的全部 ${questions.length} 句均含品牌名，已被兜底过滤丢弃。请重试。`
      )
      await refundReservedCreditsQuietly(reservation)
      reservation = null
      return NextResponse.json(
        {
          error:
            "生成失败：AI 不慎在所有疑问句中带上了品牌名，已被后端品牌中立过滤器拒绝。请重试一次。",
        },
        { status: 502 }
      )
    }
    if (neutralQuestions.length < questions.length) {
      console.warn(
        `[generate-queries] 已剔除 ${questions.length - neutralQuestions.length} 条含品牌名的问句`
      )
    }
    if (filtered.length < neutralQuestions.length) {
      console.warn(
        `[generate-queries] 已合并 ${neutralQuestions.length - filtered.length} 条语义重复问句`
      )
    }

    const finalItems = selectBalancedQuestions(filtered, count)
    const final = finalItems.map(item => item.question)
    const questionSamples = buildPenetrationQuestionSamples(final)
    const sampleQuality = buildPenetrationSampleQuality(final)
    console.log(
      `[generate-queries] ✓ 豆包返回 ${questions.length} 条 → 中立去重 ${filtered.length} 条 → 七类筛选 ${final.length} 条 | ${Date.now() - t0}ms`
    )

    await settleReservedCredits(reservation, estimateFeatureCredits(featureKey, final.length))
    reservation = null
    return NextResponse.json(
      {
        questions: final,
        questionSamples,
        sampleQuality,
        generatedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    )
  } catch (e) {
    await refundReservedCreditsQuietly(reservation)
    const msg = e instanceof Error ? e.message : "未知错误"
    console.error("[generate-queries] 未捕获异常：", msg)
    return NextResponse.json({ error: `生成失败：${msg}` }, { status: 500 })
  }
}


export const POST = handler
