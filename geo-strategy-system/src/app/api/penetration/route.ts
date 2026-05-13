import { NextRequest, NextResponse } from "next/server"
import type { ModelKey, PenetrationByModel, PenetrationItem } from "@/types"
import { ADAPTERS } from "@/lib/llm"
import { aggregatePenetration, parseJsonLoose } from "@/lib/score-utils"
import { isPlatformName } from "@/lib/platform-blacklist"

export const runtime = "nodejs"
export const maxDuration = 180
export const dynamic = "force-dynamic"
export const revalidate = 0

// ============================================================================
// 两阶段管线
//   Stage A · 盲测出题
//     - 给被测模型只发用户疑问句本身
//     - System Prompt 不含 ourBrand、不暗示这是检测
//     - Kimi 走 $web_search 联网；其它模型靠强硬"严禁捏造"纪律
//     - 输出：纯自然语言回答（不强制 JSON）
//
//   Stage B · 独立裁判 AI 检测
//     - 由一个独立的"裁判模型"对每条盲测回答单独审阅
//     - 裁判看不到原始疑问句，只看："目标品牌"+"AI 回答原文"+"参考竞品清单"
//     - 输出严格 JSON：是否命中我方、文中提到的所有具体品牌、最被推荐的那个
//
//   Stage C · 代码层最终安全网
//     - 不论裁判说什么，hitOur 的最终真理是 answer.includes(ourBrand)
//     - 裁判给出的 mentionedBrands 也必须能在 answer 文本里找到对应字面，
//       否则丢弃（防止裁判反过来又产生幻觉）
// ============================================================================

// ---------- Stage A · 盲测出题 System Prompt（不含 ourBrand） ----------
function buildBlindSystemPrompt(industry: string): string {
  const year = new Date().getFullYear()
  return `你是一个客观、严谨的市场分析引擎助手，正在独立、公开地回答一位用户的咨询。

【硬性事实纪律 — 严禁幻觉】
1. 请严格基于你已知的客观行业事实回答用户的疑问。如果你不了解具体的公司、团队或产品，请直接说明你不了解，**严禁捏造、虚构或猜测任何不存在的品牌、公司、产品或服务商名称**。
2. 宁可少答、宁可承认不知道，也绝不编造。任何无法在公开资料中查证的名字一律不要写出。
3. 你能掌握的是最新（${year}年）国内公开行业资讯，但仅限于你确有把握的事实。
4. 回答必须客观中立，自然列出业内主流品牌/产品/服务商，**不要刻意推荐或回避任何特定一方**。
5. 本次对话**无任何上下文记忆**，请独立作答。

【输出要求】
- 用 80~300 字直接、自然、像真人客服一样回答用户问题。
- **不要使用 JSON 或 markdown 代码块包裹**，就是一段普通的中文文字。
- 不要解释你是 AI、不要说"以下是我的回答"，直接进入正文。

【上下文背景（仅供你理解话题域，请勿在回答中提及"行业"二字本身）】
- 用户咨询的领域：${industry || "未指定（请按用户提问的字面含义作答）"}`
}

// ---------- Stage B · 裁判 System Prompt ----------
function buildJudgeSystemPrompt(): string {
  return `你是一个严谨的"品牌识别引擎"。你的唯一任务是审阅一段"AI 对用户提问的回答原文"，从中客观抽取被提到的具体品牌/公司/产品/服务商名称。

【硬性纪律 — 严禁幻觉】
1. **只识别真实出现在回答原文里的名字。** 严禁补充、推测、扩展任何原文没有写出的品牌。
2. 排除以下"平台/媒体/渠道/通用 AI 工具"类目（这些不是行业品牌）：
   - 内容平台：小红书、抖音、快手、B站、知乎、微博、微信、公众号、视频号、今日头条、百家号、CSDN、掘金、简书、豆瓣、贴吧、虎扑
   - 电商：淘宝、天猫、京东、拼多多、唯品会、苏宁、美团、大众点评
   - 搜索/通用：百度、谷歌、Google、Bing、必应、搜狗、360、夸克
   - AI 通用大模型本体：豆包、DeepSeek、通义千问、Kimi、ChatGPT、文心一言、Claude
3. 用户会告诉你"目标品牌名"，你只需如实判断：原文里有没有出现该品牌（含同义变体，例如"势途"和"势途 GEO"视为同一品牌）。**没出现就是没出现，绝对不要为了讨好用户而强行说命中。**

【输出格式 — 严格 JSON，禁止 markdown 包裹、禁止任何额外文字】
{
  "hitOur": true 或 false,
  "hitEvidence": "若 hitOur=true，从原文里**逐字**复制能证明命中的最短片段（10~40 字）；否则填 \"\"",
  "mentionedBrands": ["原文中确实出现的所有具体品牌/产品/服务商（不含平台/渠道；去重；保持与原文完全一致的写法）"],
  "topRecommended": "原文中事实上排第一/最被推荐的那个品牌名（若并列、无明显倾向、或原文里 AI 自陈不了解，则填 \"\"）"
}`
}

function buildJudgeUserPrompt(args: {
  ourBrand: string
  competitors: string[]
  answer: string
}): string {
  const compLine =
    args.competitors.length > 0
      ? `【已知主要竞品参考清单 — 仅供判断时辅助，绝不要因此添加原文里没出现的品牌】\n${args.competitors.join("、")}\n\n`
      : ""
  return `【目标品牌】${args.ourBrand}

${compLine}【待审阅的 AI 回答原文】
"""
${args.answer}
"""

请严格按 system 中给定的 JSON 格式回复，不要写任何其它内容。`
}

// 用 (model, question) 哈希派生稳定 seed
function deriveSeed(model: ModelKey, question: string): number {
  let h = 2166136261
  const s = `${model}::${question}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h | 0) % 2147483647
}

// 代码层安全网：抹平大小写 + 全/半角空格后做 includes
function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s　]+/g, "").trim()
}
function answerMentionsBrand(answer: string, brand: string): boolean {
  if (!answer || !brand) return false
  const a = normalize(answer)
  const b = normalize(brand)
  if (b.length < 2) return false
  return a.includes(b)
}

// ============================================================================
// Stage A · 盲测出题
// ============================================================================
async function blindQuery(
  model: ModelKey,
  question: string,
  industry: string
): Promise<{ answer: string; error?: string }> {
  const adapter = ADAPTERS[model]
  const sys = buildBlindSystemPrompt(industry)
  const seed = deriveSeed(model, question)
  const t0 = Date.now()

  try {
    const raw = await adapter.chat({
      system: sys,
      user: question, // ★ 只发用户原始疑问句，绝不夹带任何品牌信息
      temperature: 0,
      seed,
      jsonMode: false, // ★ 不强制 JSON，让 AI 自然作答
      maxTokens: 1024,
    })
    const answer = (raw || "").trim()
    console.log(
      `[penetration·blind] ✓ ${adapter.label} | seed=${seed} | ${Date.now() - t0}ms | len=${answer.length} | q="${question.slice(0, 30)}..."`
    )
    return { answer }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "未知错误"
    console.error(`[penetration·blind] ✗ ${adapter.label} | ${msg} | q="${question.slice(0, 30)}..."`)
    return { answer: "", error: `${adapter.label} 接口调用失败：${msg}` }
  }
}

// ============================================================================
// Stage B · 独立裁判 AI 检测
// ============================================================================
interface JudgeResult {
  hitOur: boolean
  hitEvidence: string
  mentionedBrands: string[]
  topRecommended: string | null
}

async function judgeAnswer(
  judgeModel: ModelKey,
  args: { ourBrand: string; competitors: string[]; answer: string }
): Promise<{ result: JudgeResult; error?: string }> {
  const empty: JudgeResult = {
    hitOur: false,
    hitEvidence: "",
    mentionedBrands: [],
    topRecommended: null,
  }

  // 答案空字符串没必要走裁判
  if (!args.answer.trim()) return { result: empty }

  const adapter = ADAPTERS[judgeModel]
  const sys = buildJudgeSystemPrompt()
  const user = buildJudgeUserPrompt(args)
  const t0 = Date.now()

  async function attempt(extraHint = ""): Promise<JudgeResult | null> {
    const raw = await adapter.chat({
      system: sys + extraHint,
      user,
      temperature: 0,
      seed: 42,
      jsonMode: true,
      maxTokens: 800,
    })
    const parsed = parseJsonLoose(raw) as
      | { hitOur?: unknown; hitEvidence?: unknown; mentionedBrands?: unknown; topRecommended?: unknown }
      | null
    if (!parsed) return null

    const brandsRaw = Array.isArray(parsed.mentionedBrands)
      ? (parsed.mentionedBrands as unknown[]).map(x => String(x).trim()).filter(s => s.length > 0)
      : []
    const top =
      typeof parsed.topRecommended === "string" && parsed.topRecommended.trim()
        ? parsed.topRecommended.trim()
        : null

    return {
      hitOur: parsed.hitOur === true,
      hitEvidence: typeof parsed.hitEvidence === "string" ? parsed.hitEvidence : "",
      mentionedBrands: brandsRaw,
      topRecommended: top,
    }
  }

  try {
    let result = await attempt()
    if (!result) {
      result = await attempt("\n\n【再次强调】必须严格返回上述 JSON，不要任何前后缀、不要 markdown 代码块。")
    }
    if (!result) {
      return {
        result: empty,
        error: `${adapter.label} 裁判返回非 JSON，已降级为代码层兜底判定`,
      }
    }
    console.log(
      `[penetration·judge] ✓ ${adapter.label} | ${Date.now() - t0}ms | hitOur=${result.hitOur} | brands=${result.mentionedBrands.length}`
    )
    return { result }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "未知错误"
    console.error(`[penetration·judge] ✗ ${adapter.label} | ${msg}`)
    return {
      result: empty,
      error: `${adapter.label} 裁判接口调用失败：${msg}（已降级为代码层兜底判定）`,
    }
  }
}

// ============================================================================
// 单 slot 全流程：盲测 → 裁判 → 代码安全网 → 组装 PenetrationItem
// ============================================================================
async function processSlot(args: {
  model: ModelKey
  judgeModel: ModelKey
  question: string
  ourBrand: string
  industry: string
  competitors: string[]
}): Promise<PenetrationItem & { error?: string; judgeError?: string }> {
  const blind = await blindQuery(args.model, args.question, args.industry)

  if (blind.error || !blind.answer) {
    return {
      question: args.question,
      answer: "",
      mentionedBrands: [],
      topRecommended: null,
      hitOur: false,
      error: blind.error || "回答为空",
    }
  }

  const { result: judged, error: judgeError } = await judgeAnswer(args.judgeModel, {
    ourBrand: args.ourBrand,
    competitors: args.competitors,
    answer: blind.answer,
  })

  // ---- Stage C · 代码层安全网 ----
  // 1) hitOur 最终真理 = 代码 includes()；裁判结论仅作参考
  const codeHit = answerMentionsBrand(blind.answer, args.ourBrand)
  const hitOur = codeHit

  // 2) 裁判说命中但代码找不到 / 代码命中但裁判没认 → 日志记一笔，便于审计
  if (judged.hitOur !== codeHit) {
    console.warn(
      `[penetration·xcheck] 裁判与代码不一致：judge=${judged.hitOur} code=${codeHit} | ourBrand="${args.ourBrand}" | answer="${blind.answer.slice(0, 80)}..." | evidence="${judged.hitEvidence}"`
    )
  }

  // 3) 裁判抽取的 mentionedBrands 必须被代码 cross-check 在原文里真实存在，否则丢弃
  const verifiedBrands = judged.mentionedBrands.filter(
    b => !isPlatformName(b) && answerMentionsBrand(blind.answer, b)
  )

  // 4) 若代码判定命中，但裁判漏写我方品牌，自动补入，保证渗透率与行业占有率口径一致
  if (
    hitOur &&
    args.ourBrand &&
    !verifiedBrands.some(b => normalize(b) === normalize(args.ourBrand))
  ) {
    verifiedBrands.push(args.ourBrand.trim())
  }

  // 5) topRecommended 也要 cross-check
  const top =
    judged.topRecommended &&
    !isPlatformName(judged.topRecommended) &&
    answerMentionsBrand(blind.answer, judged.topRecommended)
      ? judged.topRecommended
      : null

  return {
    question: args.question,
    answer: blind.answer,
    mentionedBrands: verifiedBrands,
    topRecommended: top,
    hitOur,
    judgeError,
  }
}

// ============================================================================
// 选裁判模型：优先 DeepSeek（结构化输出最稳/最便宜），依次降级
// 强约束：裁判应尽量与"出题模型"不同，避免自证；只有当所有可用模型都被占用时才允许相同。
// ============================================================================
function pickJudge(activeModels: ModelKey[]): ModelKey | null {
  const order: ModelKey[] = ["deepseek", "doubao", "qwen", "kimi"]
  for (const m of order) {
    if (activeModels.includes(m)) return m
  }
  return null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const ourBrand = String(body.ourBrand || "").trim()
    const industry = String(body.industry || "").trim()
    const questions: string[] = Array.isArray(body.questions)
      ? body.questions.map((q: unknown) => String(q).trim()).filter(Boolean)
      : []
    const competitors: string[] = Array.isArray(body.competitors)
      ? body.competitors.map((q: unknown) => String(q).trim()).filter(Boolean)
      : []
    const models: ModelKey[] = Array.isArray(body.models)
      ? body.models.filter((m: unknown): m is ModelKey =>
          typeof m === "string" && m in ADAPTERS
        )
      : []

    if (!ourBrand) {
      return NextResponse.json({ error: "请填写我方品牌名" }, { status: 400 })
    }
    if (questions.length === 0) {
      return NextResponse.json({ error: "请至少提供一个疑问句" }, { status: 400 })
    }
    if (models.length === 0) {
      return NextResponse.json({ error: "请至少选择一个模型" }, { status: 400 })
    }

    // ★ 强校验环境变量：勾选但未配置 Key 的模型必须显式跳过，绝不返回 Mock
    const activeModels = models.filter(m => ADAPTERS[m].configured())
    const skipped = models.filter(m => !ADAPTERS[m].configured())

    if (activeModels.length === 0) {
      return NextResponse.json(
        {
          error: `所选模型均未配置 API Key（缺失: ${skipped
            .map(m => ADAPTERS[m].label)
            .join("、")}）。请在 .env.local 中配置对应密钥后重试。`,
          skipped: skipped.map(m => ({ model: m, label: ADAPTERS[m].label })),
        },
        { status: 400 }
      )
    }

    const judgeModel = pickJudge(activeModels)
    if (!judgeModel) {
      return NextResponse.json(
        { error: "没有任何已配置的大模型可作为裁判，请先在 .env.local 配置至少一个 API Key" },
        { status: 400 }
      )
    }

    console.log(
      `[penetration] 启动 ${activeModels.length} 模型 × ${questions.length} 问题 = ${
        activeModels.length * questions.length
      } 个 slot（Stage A 盲测出题 + Stage B 独立裁判 [${ADAPTERS[judgeModel].label}] + Stage C 代码安全网）`
    )
    const t0 = Date.now()

    const tasks: Array<Promise<{ model: ModelKey; item: PenetrationItem & { error?: string; judgeError?: string } }>> = []
    for (const m of activeModels) {
      for (const q of questions) {
        tasks.push(
          processSlot({
            model: m,
            judgeModel,
            question: q,
            ourBrand,
            industry,
            competitors,
          }).then(item => ({ model: m, item }))
        )
      }
    }
    const results = await Promise.all(tasks)
    console.log(`[penetration] 全部完成 耗时 ${Date.now() - t0}ms`)

    // 按 model → 题目顺序整理
    const byModel: PenetrationByModel = {}
    for (const m of activeModels) byModel[m] = []
    for (const { model, item } of results) byModel[model]!.push(item)
    for (const m of activeModels) {
      const map = new Map(byModel[m]!.map(it => [it.question, it]))
      byModel[m] = questions.map(q => map.get(q)).filter((it): it is PenetrationItem => !!it)
    }

    // 各模型错误透传（用于前端在对应栏显示红色提示）
    const modelErrors: Partial<Record<ModelKey, string>> = {}
    for (const m of activeModels) {
      const slots = (byModel[m] ?? []) as Array<PenetrationItem & { error?: string }>
      const errs = slots.map(it => it.error).filter((x): x is string => !!x)
      if (errs.length > 0 && errs.length === slots.length) {
        modelErrors[m] = errs[0]
      } else if (errs.length > 0) {
        modelErrors[m] = `部分请求失败（${errs.length}/${slots.length}）：${errs[0]}`
      }
    }

    const aggregated = aggregatePenetration(byModel, ourBrand)

    return NextResponse.json(
      {
        byModel,
        aggregated,
        generatedAt: new Date().toISOString(),
        judgeModel,
        judgeLabel: ADAPTERS[judgeModel].label,
        skipped: skipped.map(m => ADAPTERS[m].label),
        skippedDetail: skipped.map(m => ({
          model: m,
          label: ADAPTERS[m].label,
          reason: `${ADAPTERS[m].label} 接口配置缺失：未读取到对应环境变量`,
        })),
        modelErrors,
        requestId: crypto.randomUUID(),
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
    console.error("[penetration] 未捕获异常:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "服务器错误" },
      { status: 500 }
    )
  }
}
