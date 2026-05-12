import { NextRequest, NextResponse } from "next/server"
import type { ModelKey, PenetrationByModel, PenetrationItem } from "@/types"
import { ADAPTERS } from "@/lib/llm"
import { aggregatePenetration, parseJsonLoose } from "@/lib/score-utils"
import { isPlatformName } from "@/lib/platform-blacklist"

export const runtime = "nodejs"
export const maxDuration = 120
export const dynamic = "force-dynamic"
export const revalidate = 0

function buildSystemPrompt(ourBrand: string, industry: string): string {
  const year = new Date().getFullYear()
  return `你是一位中立、专业的国内行业资讯顾问，正在独立回复一个用户咨询。

【硬性规则】
1. 你必须模拟"实时联网检索"${year}年最新的国内行业公开资讯后再回答。即便信息可能过时也不要拒答，要给出当下公认的主流答案。
2. 回答必须保持客观，自然列出业内主流品牌/产品/服务商，**不要刻意推荐或回避任何特定品牌**。
3. 本次对话**没有任何上下文记忆**，请独立作答。
4. **mentionedBrands 仅填入"具体的公司名 / 产品名 / 服务商名"**，禁止填入以下任何"平台/媒体/渠道"类目（这些是发布渠道，不是品牌）：
   - 内容平台：小红书、抖音、快手、B站/哔哩哔哩、知乎、微博、微信、公众号、视频号、今日头条、百家号、CSDN、掘金、稀土掘金、简书、豆瓣、贴吧、虎扑
   - 电商平台：淘宝、天猫、京东、拼多多、唯品会、苏宁、当当
   - 搜索/通用：百度、谷歌、Google、Bing、必应、搜狗、360 搜索、夸克
   - 应用市场：App Store、华为应用市场、小米应用商店、应用宝
   - AI 工具/通用大模型本身：豆包、DeepSeek、通义千问、Kimi、ChatGPT、文心一言、Claude（除非用户问题正在问"AI 大模型品牌"）
5. 若 answer 中出现上述平台名，**不要**写入 mentionedBrands。

【输出格式 — 严格 JSON，禁止 markdown 包裹、禁止任何额外文字】
{
  "answer": "用 80-300 字直接、自然地回答用户问题",
  "mentionedBrands": ["你在 answer 中提到的所有具体品牌/产品/服务商名称（不含平台/渠道/媒体；去重；保持原文写法）"],
  "topRecommended": "你 answer 中事实上排第一/最推荐的那个品牌名（若并列或无明显倾向，填 \"\"）"
}

【上下文】
- 行业：${industry || "未指定"}${
    ourBrand
      ? `\n- 注意：用户咨询的是${industry || "该行业"}的客观情况，与品牌「${ourBrand}」可能相关也可能无关，请勿因此刻意提及或回避。`
      : ""
  }`
}

// 用问题哈希派生稳定 seed，让"同一问题 + 同一模型"在支持 seed 的供应商上尽可能复现
function deriveSeed(model: ModelKey, question: string): number {
  let h = 2166136261
  const s = `${model}::${question}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h | 0) % 2147483647
}

async function queryOne(
  model: ModelKey,
  question: string,
  ourBrand: string,
  industry: string
): Promise<PenetrationItem> {
  const adapter = ADAPTERS[model]
  const sys = buildSystemPrompt(ourBrand, industry)
  const seed = deriveSeed(model, question)
  const t0 = Date.now()

  async function attempt(): Promise<{
    raw: string
    parsed: { answer?: string; mentionedBrands?: unknown; topRecommended?: unknown } | null
  }> {
    // temperature=0 + seed + json mode → 同一输入应输出近似一致的结果
    const raw = await adapter.chat({
      system: sys,
      user: question,
      temperature: 0,
      seed,
      jsonMode: true,
    })
    const parsed = parseJsonLoose(raw) as
      | { answer?: string; mentionedBrands?: unknown; topRecommended?: unknown }
      | null
    return { raw, parsed }
  }

  try {
    let { raw, parsed } = await attempt()
    if (!parsed) {
      // 模型这次返回了非 JSON / markdown 包裹失败，重试一次（强提示）
      const retry = await adapter.chat({
        system: sys + "\n\n【再次强调】必须严格返回 JSON，不要任何前后缀。",
        user: question,
        temperature: 0,
        seed,
        jsonMode: true,
      })
      const retryParsed = parseJsonLoose(retry) as typeof parsed
      if (retryParsed) {
        raw = retry
        parsed = retryParsed
      }
    }
    console.log(
      `[penetration] ✓ ${adapter.label} | seed=${seed} | ${Date.now() - t0}ms | brands=${
        Array.isArray(parsed?.mentionedBrands) ? parsed!.mentionedBrands!.length : 0
      } | q="${question.slice(0, 30)}..."`
    )

    const rawBrands = Array.isArray(parsed?.mentionedBrands)
      ? (parsed!.mentionedBrands as unknown[])
          .map(x => String(x).trim())
          .filter(s => s.length > 0)
      : []
    const mentioned = rawBrands.filter(b => !isPlatformName(b))

    const topRaw =
      typeof parsed?.topRecommended === "string" && parsed.topRecommended.trim()
        ? parsed.topRecommended.trim()
        : null
    const top = topRaw && !isPlatformName(topRaw) ? topRaw : null

    return {
      question,
      answer: typeof parsed?.answer === "string" ? parsed.answer : raw.slice(0, 500),
      mentionedBrands: mentioned,
      topRecommended: top,
    }
  } catch (e) {
    return {
      question,
      answer: `[${adapter.label} 请求失败: ${e instanceof Error ? e.message : "未知"}]`,
      mentionedBrands: [],
      topRecommended: null,
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const ourBrand = String(body.ourBrand || "").trim()
    const industry = String(body.industry || "").trim()
    const questions: string[] = Array.isArray(body.questions)
      ? body.questions.map((q: unknown) => String(q).trim()).filter(Boolean)
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

    const activeModels = models.filter(m => ADAPTERS[m].configured())
    const skipped = models.filter(m => !ADAPTERS[m].configured())

    if (activeModels.length === 0) {
      return NextResponse.json(
        {
          error: `所选模型均未配置 API Key（缺失: ${skipped
            .map(m => ADAPTERS[m].label)
            .join("、")}）。请在 .env.local 配置后重试。`,
        },
        { status: 400 }
      )
    }

    console.log(
      `[penetration] 启动 ${activeModels.length} 模型 × ${questions.length} 问题 = ${
        activeModels.length * questions.length
      } 并行请求 (temperature=0, seed=hash, jsonMode=on)`
    )
    const t0 = Date.now()

    const tasks: Array<Promise<{ model: ModelKey; item: PenetrationItem }>> = []
    for (const m of activeModels) {
      for (const q of questions) {
        tasks.push(queryOne(m, q, ourBrand, industry).then(item => ({ model: m, item })))
      }
    }
    const results = await Promise.all(tasks)
    console.log(`[penetration] 全部完成 耗时 ${Date.now() - t0}ms`)

    const byModel: PenetrationByModel = {}
    for (const m of activeModels) byModel[m] = []
    for (const { model, item } of results) byModel[model]!.push(item)

    for (const m of activeModels) {
      const map = new Map(byModel[m]!.map(it => [it.question, it]))
      byModel[m] = questions
        .map(q => map.get(q))
        .filter((it): it is PenetrationItem => !!it)
    }

    const aggregated = aggregatePenetration(byModel, ourBrand)

    return NextResponse.json(
      {
        byModel,
        aggregated,
        generatedAt: new Date().toISOString(),
        skipped: skipped.map(m => ADAPTERS[m].label),
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
