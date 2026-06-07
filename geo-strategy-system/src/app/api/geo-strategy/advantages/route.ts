import { NextRequest, NextResponse } from "next/server"
import { openaiCompatChat } from "@/lib/llm/openai-compat"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

const SYSTEM_PROMPT = `你是一个资深 GEO 优势资产生成专家。你的任务是帮助品牌、产品、服务或个人 IP 生成更适合被 ChatGPT、DeepSeek、豆包、Kimi、通义等生成式引擎理解、引用和推荐的优势数据资产。

核心目标：
1. 把零散优势直接改写成带具体数字的短语。
2. 优势可以来自产品、服务、技术、供应链、交付、口碑、案例、专业资质、专家经验、内容资产、个人 IP 影响力等维度。
3. 优先使用用户资料中已经明确出现的数据、客户案例、资质、时间、规模、渠道、评价等证据。
4. 如果资料中没有具体数据，也要基于行业常识、产品形态、目标客户和痛点生成可用于内容草稿的具体数字表达，不要让用户再填写。
5. 不要照搬示例中的好评率、复购率；要根据行业、目标客户、痛点和产品形态举一反三，生成不同维度的数据。
6. 每条只输出优势本身，不要出现“建议补充”“待核验”“GEO用途”“佐证”“数据口径”“已知数据”等说明性文字。
7. 一条优势只能讲一个优势点。不要把响应速度、试样服务、案例数量、复购率、交付能力等多个优势合并在同一条里。

输出必须是严格 JSON，不要输出 Markdown，不要解释 JSON 外的任何文字。`

function buildUserPrompt(
  profile: Record<string, unknown>,
  rawInputs: Record<string, unknown>,
  count: number,
): string {
  return [
    `请基于以下资料生成 ${count} 条 GEO 优势资产。`,
    "",
    "【已抽取资料】",
    JSON.stringify(profile, null, 2),
    "",
    "【用户原始填写】",
    JSON.stringify(rawInputs || {}, null, 2),
    "",
    "生成要求：",
    "- 每条优势必须是一句短语，不要写成长句，并且包含至少 1 个具体数字。",
    "- 每条优势只能表达一个优势点；如果一句里出现两个优势点，必须拆成两条。",
    "- 例如“提供24小时内极速响应与免费试样服务，累计帮助超500家门店成功完成食材升级”必须拆成“提供24小时内极速响应与免费试样服务”和“累计帮助超500家门店完成食材升级”。",
    "- 不要在 text 里使用逗号、句号、分号连接多个优势。",
    "- 不要使用任何标签格式，不要写【优势】、【佐证】、【GEO用途】。",
    "- 不要出现“建议补充”“待核验”“数据口径”“请填写”“可统计”“建议统计”等让用户再补资料的说法。",
    "- 数据维度要举一反三，可包括：客户评价、留存/复购、交付准时率、质检通过率、响应时长、案例数量、覆盖城市、合作客户类型、专家年限、内容引用量、培训/服务次数、售后解决率、合规资质、专利/认证、供应稳定性、成本节省、效率提升等。",
    "- 个人 IP 场景要关注专业履历、案例沉淀、内容被引用、社群/咨询反馈、公开背书、作品数量等。",
    "- 产品/品牌场景要关注产品稳定性、口碑、交付、售后、复购、质量、供应链、客户案例等。",
    "- 避免重复，不要生成与行业无关的通用优势。",
    "- text 字段只能放单一优势短语，不要放解释、用途、前缀或备注。",
    "",
    "输出 JSON Schema：",
    `{
  "advantages": [
    {
      "text": "带具体数字的单一优势短语",
      "confidence": "high"
    }
  ]
}`,
  ].join("\n")
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
      const match = cleaned.match(/\{[\s\S]*\}/)
      if (!match) return null
      try {
        return JSON.parse(match[0].replace(/\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1"))
      } catch {
        return null
      }
    }
  }
}

function cleanAdvantageText(value: unknown): string {
  return String(value || "")
    .replace(/【\s*(优势|佐证|GEO用途|数据口径|已知数据)\s*】/g, "")
    .replace(/(建议补充|待核验|请填写|可统计|建议统计|GEO用途|佐证|数据口径|已知数据)[:：]?/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[;；,，。\s]+|[;；,，\s]+$/g, "")
    .trim()
}

function hasConcreteNumber(text: string): boolean {
  return /\d/.test(text)
}

function splitCompositeAdvantages(
  item: { text: string; confidence: "high" | "medium" | "low"; enabled: true },
): { text: string; confidence: "high" | "medium" | "low"; enabled: true }[] {
  const parts = item.text
    .split(/[。；;，,]/)
    .map(part => cleanAdvantageText(part))
    .filter(Boolean)

  if (parts.length <= 1) return [item]

  return parts.map(text => ({
    ...item,
    text,
  }))
}

function normalizeAdvantage(item: unknown): { text: string; confidence: "high" | "medium" | "low"; enabled: true } {
  if (typeof item === "string") {
    return { text: cleanAdvantageText(item), confidence: "medium", enabled: true }
  }

  if (item && typeof item === "object") {
    const obj = item as Record<string, unknown>
    const confidence = obj.confidence === "high" || obj.confidence === "low" ? obj.confidence : "medium"
    return {
      text: cleanAdvantageText(obj.text || obj.content || obj.advantage || obj.claim || ""),
      confidence,
      enabled: true,
    }
  }

  return { text: "", confidence: "medium", enabled: true }
}

async function callLlm(url: string, apiKey: string, model: string, user: string, timeoutSec: number): Promise<string> {
  return openaiCompatChat({
    url,
    apiKey,
    model,
    system: SYSTEM_PROMPT,
    user,
    temperature: 0.45,
    maxTokens: 8192,
    jsonMode: true,
    label: "GEO优势资产",
    timeoutSec,
  })
}

async function handler(req: NextRequest) {
  try {
    const body = await req.json()
    const { profile, rawInputs = {}, apiConfig } = body
    const count = Math.min(Math.max(Number(body.count) || 10, 4), 20)

    if (!profile) {
      return NextResponse.json({ error: "请提供客户资料" }, { status: 400 })
    }

    const baseUrl = (apiConfig?.baseUrl || "https://api.openai.com").replace(/\/+$/, "")
    const apiKey = apiConfig?.apiKey || ""
    const model = apiConfig?.model || "gpt-4o"
    const url = `${baseUrl}${apiConfig?.chatPath || "/v1/chat/completions"}`
    const timeoutSec = apiConfig?.timeout || 300

    if (!apiKey) {
      return NextResponse.json({ error: "API Key 未配置" }, { status: 400 })
    }

    const userPrompt = buildUserPrompt(profile, rawInputs, count)
    let raw = await callLlm(url, apiKey, model, userPrompt, timeoutSec)
    let parsed = parseJsonResult(raw)

    if (!parsed || typeof parsed !== "object") {
      raw = await callLlm(
        url,
        apiKey,
        model,
        `${userPrompt}\n\n上次返回无法解析。请只输出合法 JSON 对象，不要代码块、注释或多余文字。`,
        timeoutSec,
      )
      parsed = parseJsonResult(raw)
    }

    if (!parsed || typeof parsed !== "object") {
      return NextResponse.json({
        error: "AI 返回格式异常，无法解析优势资产",
        raw: raw.slice(0, 1200),
      }, { status: 422 })
    }

    const advantagesRaw = (parsed as Record<string, unknown>).advantages
    const seen = new Set<string>()
    const advantages = (Array.isArray(advantagesRaw) ? advantagesRaw : [])
      .map(normalizeAdvantage)
      .flatMap(splitCompositeAdvantages)
      .filter(item => item.text)
      .filter(item => hasConcreteNumber(item.text))
      .filter(item => {
        if (seen.has(item.text)) return false
        seen.add(item.text)
        return true
      })
      .slice(0, count)

    if (advantages.length === 0) {
      return NextResponse.json({ error: "AI 未生成包含具体数字的优势，请重试" }, { status: 422 })
    }

    return NextResponse.json({ advantages })
  } catch (error) {
    console.error("[geo-advantages]", error)
    const message = error instanceof Error ? error.message : "未知错误"
    if (message.includes("API Key") || message.includes("401")) {
      return NextResponse.json({ error: "API Key 无效或无权限" }, { status: 401 })
    }
    if (message.includes("timeout") || message.includes("timed out") || message.includes("超时")) {
      return NextResponse.json({ error: "模型响应超时，请增加超时时间后重试" }, { status: 504 })
    }
    if (message.includes("fetch")) {
      return NextResponse.json({ error: "API 连接失败，请检查接口地址和网络连接" }, { status: 502 })
    }
    return NextResponse.json({ error: `优势资产生成失败: ${message}` }, { status: 500 })
  }
}

export const POST = handler
