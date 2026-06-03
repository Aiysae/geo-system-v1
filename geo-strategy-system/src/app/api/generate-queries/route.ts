import { NextRequest, NextResponse } from "next/server"
import { openaiCompatChat } from "@/lib/llm/openai-compat"
import { authAndCheckCredits, chargeCredits } from "@/lib/with-credits"

// 高频疑问句智能生成 · 豆包专用 (Volcengine Ark)
//
// 设计纪律：
//   - 优先使用 ARK_DOUBAO_BOT_ID（bot-xxxx），走 /api/v3/bots/chat/completions。
//   - 未配置 Bot 时，允许回退到 ARK_DOUBAO_ENDPOINT_ID（ep-xxxx），走 /api/v3/chat/completions。
//   - 避免部署环境只配置普通 Endpoint 时，智能生成入口被错误阻断。
//   - 系统提示强约束模型只输出"字符串数组"或 {"questions":[...]} 包装对象。
//   - 后端对返回做宽松解析：兼容 markdown 代码块、双引号/单引号、对象/数组两种 shape。
//   - 任何上游失败一律把具体错误（含 Volcengine 的 code/message）透传到前端 Toast。

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"
export const revalidate = 0

const ARK_API_KEY = process.env.ARK_API_KEY || ""
const ARK_DOUBAO_BOT_ID = process.env.ARK_DOUBAO_BOT_ID || ""
const ARK_DOUBAO_ENDPOINT_ID = process.env.ARK_DOUBAO_ENDPOINT_ID || ""
const ARK_BOT_URL = "https://ark.cn-beijing.volces.com/api/v3/bots/chat/completions"
const ARK_ENDPOINT_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions"

const SYSTEM_PROMPT =
  "你是一个顶级的 GEO (生成式引擎优化) 与 SEO 专家。你的唯一任务是站在【完全中立的普通消费者视角】，推演目标消费者在搜寻相关服务或产品时最常问的高频疑问句。" +
  "【绝对禁令】这些疑问句中严禁出现任何具体的品牌名、公司名、产品名、服务商名（包括但不限于用户告诉你的目标品牌——目标品牌只用于让你理解所处行业，绝对不可写进任何疑问句中）。" +
  "你只关注通用的行业痛点、选购困惑、对比需求、价格敏感点、效果质疑等普世问题，模拟一个还不知道任何品牌的真实潜在客户的搜索行为。" +
  "你必须只返回一个 JSON 格式的字符串数组，例如：[\"问题1\", \"问题2\"]，不要输出任何额外的解释文本，不要使用 markdown 代码块包裹。"

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

  return [
    `请为【行业/描述：${industryDesc}】生成 ${args.count} 句高频疑问句。`,
    "这些疑问句用于检测该行业内主流 AI 大模型在没有任何品牌提示时会自然推荐哪些品牌，因此【必须站在完全中立的、还不认识任何品牌的普通消费者视角】，只问行业通用问题。",
    brandForbid,
    kwLine,
    "要求：",
    "1. 站在真实潜在客户视角，用口语化中文，模拟普通消费者在百度/AI 搜索框里会输入的问句；",
    "2. 聚焦【行业痛点 / 选购困惑 / 对比需求 / 价格疑问 / 效果质疑 / 选型标准】等通用维度；",
    "3. 每句独立、可直接被搜索引擎/AI 大模型理解；",
    "4. 不要带编号、不要带引号包裹（数组本身已是 JSON 字符串）；",
    "5. 严格只输出 JSON 字符串数组，无任何前后解释，无 markdown 代码块。",
  ]
    .filter(Boolean)
    .join("\n")
}

// 后端兜底过滤：万一 AI 不听话，把含品牌名的句子剔除掉
function stripBrandedQuestions(questions: string[], brand: string): string[] {
  if (!brand) return questions
  const b = brand.toLowerCase().replace(/\s+/g, "")
  return questions.filter(q => {
    const norm = q.toLowerCase().replace(/\s+/g, "")
    return !norm.includes(b)
  })
}

// 宽松解析：兼容 ```json 包裹、对象 {questions:[...]}、纯数组、单引号
function parseQuestionsFromLLM(raw: string): string[] | null {
  let s = raw.trim()
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "")
  }

  // 优先尝试纯数组
  const lb = s.indexOf("[")
  const rb = s.lastIndexOf("]")
  if (lb >= 0 && rb > lb) {
    const arrSlice = s.slice(lb, rb + 1)
    const arr = tryParseArray(arrSlice)
    if (arr) return arr
  }

  // 再尝试对象包装：{ "questions": [...] } 或 { "data": [...] }
  const lc = s.indexOf("{")
  const rc = s.lastIndexOf("}")
  if (lc >= 0 && rc > lc) {
    try {
      const obj = JSON.parse(s.slice(lc, rc + 1)) as Record<string, unknown>
      for (const k of ["questions", "data", "items", "list", "result"]) {
        const v = obj[k]
        if (Array.isArray(v)) {
          const cleaned = v.map(x => String(x).trim()).filter(Boolean)
          if (cleaned.length > 0) return cleaned
        }
      }
    } catch {
      /* fall-through */
    }
  }

  return null
}

function tryParseArray(s: string): string[] | null {
  // 1) 直接 JSON.parse
  try {
    const arr = JSON.parse(s) as unknown
    if (Array.isArray(arr)) {
      const cleaned = arr.map(x => String(x).trim()).filter(Boolean)
      if (cleaned.length > 0) return cleaned
    }
  } catch {
    /* 继续 */
  }
  // 2) 单引号 → 双引号后重试（粗暴但对国产模型偶发输出有效）
  try {
    const replaced = s.replace(/'/g, '"')
    const arr = JSON.parse(replaced) as unknown
    if (Array.isArray(arr)) {
      const cleaned = arr.map(x => String(x).trim()).filter(Boolean)
      if (cleaned.length > 0) return cleaned
    }
  } catch {
    /* 继续 */
  }
  return null
}

// 从 openai-compat 抛出的 Error.message（形如：`豆包 接口调用失败 HTTP 404：{...}`）
// 中提取 Volcengine 的 code/message，给前端 Toast 一个可读的中文摘要。
function humanizeUpstreamError(rawMsg: string): string {
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
        const currentModel = ARK_DOUBAO_BOT_ID || ARK_DOUBAO_ENDPOINT_ID || "未配置"
        const modelType = ARK_DOUBAO_BOT_ID ? "Bot ID" : "Endpoint ID"
        return `豆包调用失败：未找到该 ${modelType}（${currentModel}）。请到火山方舟控制台确认模型已创建/发布，且 .env.local 中对应配置正确。`
      }
      if (/quota|balance|insufficient/i.test(code) || /余额|额度|配额/i.test(message)) {
        return `豆包调用失败：账户余额或配额不足。请到火山方舟控制台充值后重试。原始信息：${message || code}`
      }
      if (/auth|unauthorized|api.?key/i.test(code) || /鉴权|未授权|key/i.test(message)) {
        return `豆包调用失败：鉴权失败。请检查 ARK_API_KEY 是否正确并对当前 Bot 有权限。原始信息：${message || code}`
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
  try {
    if (!ARK_API_KEY) {
      return NextResponse.json(
        { error: "生成失败：未配置 ARK_API_KEY，请在 .env.local 中补全后重启服务。" },
        { status: 500 }
      )
    }
    if (!ARK_DOUBAO_BOT_ID) {
      if (!ARK_DOUBAO_ENDPOINT_ID) {
        return NextResponse.json(
          {
            error:
              "生成失败：未配置 ARK_DOUBAO_BOT_ID 或 ARK_DOUBAO_ENDPOINT_ID。请在 .env.local 中至少配置一个豆包 Bot（bot- 开头）或 Endpoint（ep- 开头）后重启服务。",
          },
          { status: 500 }
        )
      }
    }
    if (ARK_DOUBAO_BOT_ID && !ARK_DOUBAO_BOT_ID.startsWith("bot-")) {
      return NextResponse.json(
        {
          error: `生成失败：ARK_DOUBAO_BOT_ID 必须以 "bot-" 开头（当前值：${ARK_DOUBAO_BOT_ID}）。如需使用 ep- 开头的 Endpoint，请配置到 ARK_DOUBAO_ENDPOINT_ID。`,
        },
        { status: 500 }
      )
    }
    if (!ARK_DOUBAO_BOT_ID && ARK_DOUBAO_ENDPOINT_ID && !ARK_DOUBAO_ENDPOINT_ID.startsWith("ep-")) {
      return NextResponse.json(
        {
          error: `生成失败：ARK_DOUBAO_ENDPOINT_ID 必须以 "ep-" 开头（当前值：${ARK_DOUBAO_ENDPOINT_ID}）。`,
        },
        { status: 500 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const industry = String(body?.industry ?? "").trim()
    const brand = String(body?.brand ?? "").trim()
    const keywords = String(body?.keywords ?? "").trim()
    const rawCount = Number(body?.count)
    const count = Number.isFinite(rawCount) ? Math.max(1, Math.min(30, Math.round(rawCount))) : 5

    if (!industry && !brand) {
      return NextResponse.json(
        { error: "请先在客户信息中填写所属行业，再生成高频疑问句" },
        { status: 400 }
      )
    }

    const guard = await authAndCheckCredits(count)
    if (!guard.ok) return guard.response

    const t0 = Date.now()
    let content: string
    try {
      content = await openaiCompatChat({
        url: ARK_DOUBAO_BOT_ID ? ARK_BOT_URL : ARK_ENDPOINT_URL,
        apiKey: ARK_API_KEY,
        model: ARK_DOUBAO_BOT_ID || ARK_DOUBAO_ENDPOINT_ID,
        label: "豆包",
        system: SYSTEM_PROMPT,
        user: buildUserPrompt({ industry, brand, count, keywords }),
        temperature: 0.7,
        maxTokens: 1500,
      })
    } catch (upstream) {
      const raw = upstream instanceof Error ? upstream.message : String(upstream)
      const friendly = humanizeUpstreamError(raw)
      console.error("[generate-queries] 豆包 Bot 上游失败：", raw)
      return NextResponse.json({ error: friendly }, { status: 502 })
    }

    const questions = parseQuestionsFromLLM(content)
    if (!questions || questions.length === 0) {
      console.error("[generate-queries] 豆包返回无法解析为字符串数组：", content.slice(0, 300))
      return NextResponse.json(
        { error: "生成失败：豆包返回内容无法解析为有效 JSON 数组，请重试" },
        { status: 502 }
      )
    }

    // 兜底：剔除任何含目标品牌名的问句，避免渗透率虚假 100%
    const filtered = stripBrandedQuestions(questions, brand)
    if (filtered.length === 0) {
      console.error(
        `[generate-queries] AI 生成的全部 ${questions.length} 句均含品牌名，已被兜底过滤丢弃。请重试。`
      )
      return NextResponse.json(
        {
          error:
            "生成失败：AI 不慎在所有疑问句中带上了品牌名，已被后端品牌中立过滤器拒绝。请重试一次。",
        },
        { status: 502 }
      )
    }
    if (filtered.length < questions.length) {
      console.warn(
        `[generate-queries] 已剔除 ${questions.length - filtered.length} 条含品牌名的问句（保留 ${filtered.length} 条）`
      )
    }

    // 截断到用户期望的数量上限
    const final = filtered.slice(0, count)
    console.log(
      `[generate-queries] ✓ 豆包 Bot 返回 ${questions.length} 条 → 中立过滤 ${filtered.length} 条 → 裁剪到 ${final.length} 条 | ${Date.now() - t0}ms`
    )

    await chargeCredits(guard.userId, final.length)
    return NextResponse.json(
      { questions: final, generatedAt: new Date().toISOString() },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : "未知错误"
    console.error("[generate-queries] 未捕获异常：", msg)
    return NextResponse.json({ error: `生成失败：${msg}` }, { status: 500 })
  }
}


export const POST = handler
