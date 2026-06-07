import { NextRequest, NextResponse } from "next/server"
import { openaiCompatChat } from "@/lib/llm/openai-compat"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

const EXTRACTION_SYSTEM = `你是一个专业的客户资料抽取助手。你需要从用户提供的资料（文本、PDF文档截图、图片等）中，抽取出结构化的客户信息。

严格遵守以下规则：
1. 仔细阅读所有提供的材料，包括图片和PDF中的文字内容。
2. 只抽取原文明确包含的信息，不要编造。
3. 优先抽取编号条目（如 "1. 品牌认知薄弱：……"）。
4. 过滤噪声：页眉页脚、文件名、评分表、纯数字行、数字密集行、表格行（维度/综合得分/产品品质等）、OCR错误词、空字段拼接的脏文本。
5. 分类规则：
   - pain_points: 包含"缺乏/无法/不足/选择困难/价格波动/损耗/缺货/不稳定/效率低/采购难/供应商不可靠"等语义
   - advantages: 包含"稳定/效率/品质/成本/供应链/服务/定制/专业/可批量/交付快"等语义
   - weaknesses: 包含"品牌认知弱/产品矩阵单一/供应链体量不足/内容资源匮乏/口碑生态空白/渠道弱/客户管理不足/产品迭代不足"等语义
   - scenes: 从痛点和目标客户中推导合理场景（供应商筛选/旺季备货/采购成本控制等）
6. 如果某个字段置信度低，不要硬塞长文本，用 "建议人工补充：……" 表示。
7. project_name 从文件名或内容中提取，如果找不到就用 "未命名项目"。
8. industry、audience、product_description、geo_goals 从原文提取，找不到就设为空字符串。

输出必须是严格 JSON，格式：
{
  "project_name": "项目名称",
  "industry": "行业",
  "audience": "目标客户",
  "product_description": "产品/服务说明",
  "pain_points": [{"text": "...", "confidence": "high/medium/low"}],
  "advantages": [{"text": "...", "confidence": "high/medium/low"}],
  "weaknesses": [{"text": "...", "confidence": "high/medium/low"}],
  "competitors": [{"text": "...", "confidence": "high/medium/low"}],
  "scenes": [{"text": "...", "confidence": "high/medium/low"}],
  "geo_goals": "GEO目标",
  "source_notes": "来源备注"
}

不要输出 JSON 外的任何文字。`

function buildExtractionUserPrompt(
  files: { name: string; content: string }[],
  projectInfo: Record<string, string | undefined>,
): string {
  let prompt = `以下是用户上传的资料和填写的项目信息，请抽取结构化客户资料。\n\n`

  if (Object.values(projectInfo).some(v => v)) {
    prompt += `【用户填写的项目信息】\n`
    for (const [key, value] of Object.entries(projectInfo)) {
      if (value) prompt += `${key}: ${value}\n`
    }
    prompt += `\n`
  }

  for (const file of files) {
    prompt += `【文件: ${file.name}】\n${file.content.slice(0, 15000)}\n\n`
  }

  prompt += `请严格按照上述 JSON 格式输出抽取结果。`
  return prompt
}

const CONFIDENCE_VALUES = ["high", "medium", "low"] as const

function normalizeItem(item: unknown): { text: string; confidence: "high" | "medium" | "low" } {
  if (typeof item === "string") return { text: item, confidence: "medium" }
  if (item && typeof item === "object") {
    const obj = item as Record<string, unknown>
    const c = String(obj.confidence ?? "")
    const confidence = CONFIDENCE_VALUES.includes(c as "high" | "medium" | "low") ? (c as "high" | "medium" | "low") : "medium"
    return {
      text: String(obj.text || obj.content || obj.name || ""),
      confidence,
    }
  }
  return { text: String(item || ""), confidence: "medium" as const }
}

function splitRawItems(value: unknown): { text: string; confidence: "high" | "medium" | "low" }[] {
  const raw = String(value || "").trim()
  if (!raw) return []
  return raw
    .split(/\n|；|;|、|，|,/)
    .map(text => text.trim())
    .filter(Boolean)
    .map(text => ({ text, confidence: "high" as const }))
}

function mergeItems(
  primary: { text: string; confidence: "high" | "medium" | "low" }[],
  extra: { text: string; confidence: "high" | "medium" | "low" }[],
): { text: string; confidence: "high" | "medium" | "low" }[] {
  const seen = new Set<string>()
  const merged: { text: string; confidence: "high" | "medium" | "low" }[] = []

  for (const item of [...primary, ...extra]) {
    const text = item.text.trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    merged.push({ ...item, text })
  }

  return merged
}

interface UploadedPayloadFile {
  name: string
  content: string
  fileType?: "pdf" | "image" | "text" | string
}

interface ExtractProjectInfo {
  project_name?: string
  industry?: string
  audience?: string
  product_description?: string
  pain_points_raw?: string
  core_advantages?: string
  competitors_raw?: string
  geo_goals?: string
  [key: string]: string | undefined
}

interface ApiConfigPayload {
  baseUrl?: string
  apiKey?: string
  model?: string
  chatPath?: string
  timeout?: number
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

async function handler(req: NextRequest) {
  try {
    const body = await req.json() as {
      files?: UploadedPayloadFile[]
      projectInfo?: ExtractProjectInfo
      apiConfig?: ApiConfigPayload
    }
    const files = Array.isArray(body.files) ? body.files : []
    const projectInfo = body.projectInfo || {}
    const apiConfig = body.apiConfig || {}

    const baseUrl = (apiConfig?.baseUrl || "https://api.openai.com").replace(/\/+$/, "")
    const apiKey = apiConfig?.apiKey || ""
    const model = apiConfig?.model || "gpt-4o"
    const chatPath = apiConfig?.chatPath || "/v1/chat/completions"
    const url = `${baseUrl}${chatPath}`

    if (!apiKey) {
      return NextResponse.json({ error: "API Key 未配置，请在页面中填写" }, { status: 400 })
    }

    // Separate text files from image/PDF files
    const textFiles = files.filter(f => {
      if (f.fileType === "image" || f.fileType === "pdf") return false
      if (f.content?.startsWith?.("data:image/") || f.content?.startsWith?.("data:application/pdf")) return false
      return true
    })
    const mediaFiles = files.filter(f => f.fileType === "image" || f.fileType === "pdf")
    const mediaDataUrls = mediaFiles.map(f => f.content).filter(Boolean) as string[]

    // Detect text-only models (don't send images to them)
    const textOnlyModels = ["deepseek", "moonshot", "gpt-3.5"]
    const isTextOnly = textOnlyModels.some(p => model.toLowerCase().includes(p))

    let userPrompt = buildExtractionUserPrompt(textFiles, projectInfo || {})

    // If model is text-only but user uploaded images, skip sending images and note it in the prompt
    let imagesToSend: string[] | undefined
    if (isTextOnly && mediaFiles.length > 0) {
      const fileNames = mediaFiles.map(f => f.name).join("、")
      userPrompt += `\n\n（用户上传了以下图片/PDF文件，当前模型不支持视觉识别，已跳过：${fileNames}）`
      console.log(`[GEO提取] 模型 ${model} 不支持视觉，跳过 ${mediaFiles.length} 个图片/PDF`)
    } else if (mediaDataUrls.length > 0) {
      imagesToSend = mediaDataUrls
    }

    const timeoutSec = apiConfig?.timeout || 300

    console.log(`[GEO提取] 请求: ${model} @ ${url} | 文本文件: ${textFiles.length} | 图片/PDF: ${mediaFiles.length} | 超时: ${timeoutSec}s`)

    const raw = await openaiCompatChat({
      url,
      apiKey,
      model,
      system: EXTRACTION_SYSTEM,
      user: userPrompt,
      temperature: 0.3,
      maxTokens: 8192,
      jsonMode: true,
      label: "GEO提取",
      images: imagesToSend,
      timeoutSec,
    })

    // Parse JSON from response
    let cleaned = raw.trim()
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (fenceMatch) cleaned = fenceMatch[1].trim()
    else if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim()

    let extracted: Record<string, unknown>
    try {
      extracted = JSON.parse(cleaned)
    } catch {
      try {
        extracted = JSON.parse(cleaned.replace(/,(\s*[}\]])/g, "$1"))
      } catch {
        return NextResponse.json({
          error: "AI 返回格式异常，请重试",
          raw: raw.slice(0, 1000),
        }, { status: 422 })
      }
    }

    const result = {
      project_name: extracted.project_name || projectInfo?.project_name || "未命名项目",
      industry: extracted.industry || projectInfo?.industry || "",
      audience: extracted.audience || projectInfo?.audience || "",
      product_description: extracted.product_description || projectInfo?.product_description || "",
      pain_points: mergeItems(asArray(extracted.pain_points).map(normalizeItem), splitRawItems(projectInfo?.pain_points_raw)),
      advantages: mergeItems(asArray(extracted.advantages).map(normalizeItem), splitRawItems(projectInfo?.core_advantages)),
      weaknesses: asArray(extracted.weaknesses).map(normalizeItem),
      competitors: mergeItems(asArray(extracted.competitors).map(normalizeItem), splitRawItems(projectInfo?.competitors_raw)),
      scenes: asArray(extracted.scenes).map(normalizeItem),
      geo_goals: extracted.geo_goals || projectInfo?.geo_goals || "",
      source_notes: extracted.source_notes || (files.length > 0
        ? `基于 ${files.map(f => f.name).join("、")} 抽取` + (mediaDataUrls.length > 0 ? `（含 ${mediaDataUrls.length} 个图片/PDF 视觉识别）` : "")
        : "仅基于用户填写信息生成"),
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error("[geo-extract]", error)
    const message = error instanceof Error ? error.message : "未知错误"
    if (message.includes("API Key")) return NextResponse.json({ error: message }, { status: 401 })
    if (message.includes("timeout") || message.includes("timed out") || message.includes("超时")) {
      return NextResponse.json({ error: "API 请求超时，请检查网络或增加超时时间" }, { status: 504 })
    }
    return NextResponse.json({ error: `提取失败: ${message}` }, { status: 500 })
  }
}

export const POST = handler
