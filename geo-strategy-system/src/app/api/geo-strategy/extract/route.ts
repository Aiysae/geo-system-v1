import { NextRequest, NextResponse } from "next/server"
import { buildAiChatUrl, getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { hasAiCredentialCandidate } from "@/lib/ai-credential-router"
import { runCredentialPoolChat } from "@/lib/ai-credential-chat"
import {
  authAndReserveCreditsForRequest,
  refundReservedCreditsQuietly,
  type CreditReservation,
} from "@/lib/with-credits"
import { estimateFeatureCredits, getFeaturePrice } from "@/lib/pricing"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

const FEATURE_KEY = "keywordExtract"
const CREDIT_COST = estimateFeatureCredits(FEATURE_KEY)

const EXTRACTION_SYSTEM = `你是一个专业的客户资料抽取助手。你需要从用户提供的资料（文本、PDF文档截图、图片等）中，抽取出结构化的客户信息。

严格遵守以下规则：
1. 仔细阅读所有提供的材料，包括图片和PDF中的文字内容。
2. 只抽取原文明确包含的信息，不要编造。
3. 优先抽取编号条目（如 "1. 品牌认知薄弱：……"）。
4. 过滤噪声：页眉页脚、文件名、评分表、纯数字行、数字密集行、表格行（维度/综合得分/产品品质等）、OCR错误词、空字段拼接的脏文本；如果使用资料填写模板，必须忽略“请填写”“请在此填写”“没有则留空”等未替换提示，只抽取用户实际补充的内容。
5. 分类规则：
   - pain_points: 包含"缺乏/无法/不足/选择困难/价格波动/损耗/缺货/不稳定/效率低/采购难/供应商不可靠"等语义
   - advantages: 包含"稳定/效率/品质/成本/供应链/服务/定制/专业/可批量/交付快"等语义
   - weaknesses: 包含"品牌认知弱/产品矩阵单一/供应链体量不足/内容资源匮乏/口碑生态空白/渠道弱/客户管理不足/产品迭代不足"等语义
   - scenes: 从痛点和目标客户中推导合理场景（供应商筛选/旺季备货/采购成本控制等）
6. 如果某个字段置信度低，不要硬塞长文本，用 "建议人工补充：……" 表示。
7. project_name 从文件名或内容中提取，如果找不到就用 "未命名项目"。
8. industry、audience、product_description、geo_goals 从原文提取，找不到就设为空字符串。
9. 当 subject_type 为 person 时，这是个人 IP 项目：competitors 只能抽取同职业、同专业方向或同服务场景中的具名同行人物；医院、律所、公司、学校、协会和平台必须保留在人物背景资料中，不能当作同行人物。
10. 个人 IP 模式必须避免同名串人，不得凭姓名编造职称、机构、资质、履历和案例。
11. 将资料中明确出现的主体身份、产品、服务、优势、资质证书、官方或第三方报告、真实案例、客户原话、价格、媒体报道、竞争主体和内容边界抽取到 knowledge_assets。每条资料独立保存，保留原文事实和公开来源网址，不合并不同主体的资料。
12. knowledge_assets.kind 只能是 identity/product/service/advantage/credential/report/case/quote/pricing/media/competitor/boundary/other；evidence_level 只能是 official/primary/verifiedThirdParty/ownedRecord/context。

输出必须是严格 JSON，格式：
{
  "project_name": "项目名称",
  "subject_type": "brand/person",
  "person_profile": {},
  "industry": "行业",
  "audience": "目标客户",
  "product_description": "产品/服务说明",
  "pain_points": [{"text": "...", "confidence": "high/medium/low"}],
  "advantages": [{"text": "...", "confidence": "high/medium/low"}],
  "weaknesses": [{"text": "...", "confidence": "high/medium/low"}],
  "competitors": [{"text": "...", "confidence": "high/medium/low"}],
  "scenes": [{"text": "...", "confidence": "high/medium/low"}],
  "knowledge_assets": [{"kind": "credential", "title": "资料标题", "content": "原文事实", "evidence_level": "official", "source_urls": ["https://..."], "tags": ["标签"], "occurred_at": "可选日期"}],
  "geo_goals": "GEO目标",
  "source_notes": "来源备注"
}

不要输出 JSON 外的任何文字。`

function buildExtractionUserPrompt(
  files: { name: string; content: string }[],
  projectInfo: Record<string, string | undefined>,
): string {
  const isPerson = projectInfo.subject_type === "person"
  let prompt = `以下是用户上传的资料和填写的项目信息，请抽取结构化${isPerson ? "个人 IP" : "客户"}资料。\n\n`

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

  if (isPerson) {
    prompt += "\n【个人 IP 特别规则】\n只把具名同行人物放入 competitors；人物所在机构只能写入 person_profile.organization 或 source_notes，不得与同行混排。\n"
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

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

const KNOWLEDGE_ASSET_KINDS = new Set([
  "identity", "product", "service", "advantage", "credential", "report", "case",
  "quote", "pricing", "media", "competitor", "boundary", "other",
])
const EVIDENCE_LEVELS = new Set([
  "official", "primary", "verifiedThirdParty", "ownedRecord", "context",
])

function normalizeKnowledgeAsset(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const title = String(input.title || "").trim().slice(0, 300)
  const content = String(input.content || input.text || "").trim().slice(0, 12_000)
  if (!title && !content) return null
  const kind = String(input.kind || "")
  const evidenceLevel = String(input.evidence_level || input.evidenceLevel || "")
  const sourceUrls = asArray(input.source_urls || input.sourceUrls)
    .map(item => String(item || "").trim().slice(0, 2_000))
    .filter(item => /^https?:\/\//i.test(item))
    .slice(0, 30)
  return {
    kind: KNOWLEDGE_ASSET_KINDS.has(kind) ? kind : "other",
    title: title || content.slice(0, 80),
    content,
    evidence_level: EVIDENCE_LEVELS.has(evidenceLevel)
      ? evidenceLevel
      : sourceUrls.length > 0
        ? "verifiedThirdParty"
        : "context",
    source_urls: sourceUrls,
    tags: asArray(input.tags).map(item => String(item || "").trim().slice(0, 120)).filter(Boolean).slice(0, 30),
    occurred_at: String(input.occurred_at || input.occurredAt || "").trim().slice(0, 80) || undefined,
  }
}

async function handler(req: NextRequest) {
  let reservation: CreditReservation | null = null
  try {
    const body = await req.json() as {
      files?: UploadedPayloadFile[]
      projectInfo?: ExtractProjectInfo
    }
    const files = Array.isArray(body.files) ? body.files : []
    const projectInfo = body.projectInfo || {}
    const aiConfig = await getAiProviderRuntimeSetting("keywordStrategy")
    const hasMediaInput = files.some(file =>
      file.fileType === "image"
      || file.fileType === "pdf"
      || file.content?.startsWith?.("data:image/")
      || file.content?.startsWith?.("data:application/pdf"))
    const hasPoolCredential = await hasAiCredentialCandidate({
      vendor: "qwen",
      module: "keywordStrategy",
      model: aiConfig.model,
      requiredCapabilities: hasMediaInput ? ["json", "vision"] : ["json"],
    })
    const url = buildAiChatUrl(aiConfig)

    if (!aiConfig.apiKey && !hasPoolCredential) {
      return NextResponse.json({ error: "后台未配置关键词策略模型 API Key，请联系管理员在后台管理页配置" }, { status: 400 })
    }

    const creditGuard = await authAndReserveCreditsForRequest(req, CREDIT_COST, {
      featureKey: FEATURE_KEY,
      source: "api:geo-strategy:extract",
      description: getFeaturePrice(FEATURE_KEY).label,
      metadata: { fileCount: files.length },
    })
    if (!creditGuard.ok) return creditGuard.response
    reservation = creditGuard.reservation

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
    const isTextOnly = textOnlyModels.some(p => aiConfig.model.toLowerCase().includes(p))

    let userPrompt = buildExtractionUserPrompt(textFiles, projectInfo || {})

    // If model is text-only but user uploaded images, skip sending images and note it in the prompt
    let imagesToSend: string[] | undefined
    if (isTextOnly && mediaFiles.length > 0) {
      const fileNames = mediaFiles.map(f => f.name).join("、")
      userPrompt += `\n\n（用户上传了以下图片/PDF文件，当前模型不支持视觉识别，已跳过：${fileNames}）`
      console.log(`[GEO提取] 模型 ${aiConfig.model} 不支持视觉，跳过 ${mediaFiles.length} 个图片/PDF`)
    } else if (mediaDataUrls.length > 0) {
      imagesToSend = mediaDataUrls
    }

    const timeoutSec = aiConfig.timeout || 300

    console.log(`[GEO提取] 请求: ${aiConfig.model} @ ${url} | 文本文件: ${textFiles.length} | 图片/PDF: ${mediaFiles.length} | 超时: ${timeoutSec}s`)

    const raw = await runCredentialPoolChat({
      vendor: "qwen",
      module: "keywordStrategy",
      model: aiConfig.model,
      legacy: {
        url,
        apiKey: aiConfig.apiKey,
        label: "GEO提取",
      },
      chat: {
        system: EXTRACTION_SYSTEM,
        user: userPrompt,
        temperature: 0.3,
        maxTokens: 8192,
        jsonMode: true,
        timeoutSec,
      },
      images: imagesToSend,
      requiredCapabilities: imagesToSend?.length ? ["json", "vision"] : ["json"],
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
        await refundReservedCreditsQuietly(reservation)
        reservation = null
        return NextResponse.json({
          error: "AI 返回格式异常，请重试",
        }, { status: 422 })
      }
    }

    const result = {
      project_name: extracted.project_name || projectInfo?.project_name || "未命名项目",
      subject_type: projectInfo?.subject_type === "person" ? "person" : "brand",
      person_profile: parsePersonProfile(projectInfo?.person_profile, extracted.person_profile),
      industry: extracted.industry || projectInfo?.industry || "",
      audience: extracted.audience || projectInfo?.audience || "",
      product_description: extracted.product_description || projectInfo?.product_description || "",
      pain_points: mergeItems(asArray(extracted.pain_points).map(normalizeItem), splitRawItems(projectInfo?.pain_points_raw)),
      advantages: mergeItems(asArray(extracted.advantages).map(normalizeItem), splitRawItems(projectInfo?.core_advantages)),
      weaknesses: asArray(extracted.weaknesses).map(normalizeItem),
      competitors: mergeItems(asArray(extracted.competitors).map(normalizeItem), splitRawItems(projectInfo?.competitors_raw)),
      scenes: asArray(extracted.scenes).map(normalizeItem),
      knowledge_assets: asArray(extracted.knowledge_assets)
        .map(normalizeKnowledgeAsset)
        .filter((item): item is Record<string, unknown> => Boolean(item)),
      geo_goals: extracted.geo_goals || projectInfo?.geo_goals || "",
      source_notes: extracted.source_notes || (files.length > 0
        ? `基于 ${files.map(f => f.name).join("、")} 抽取` + (mediaDataUrls.length > 0 ? `（含 ${mediaDataUrls.length} 个图片/PDF 视觉识别）` : "")
        : "仅基于用户填写信息生成"),
    }

    reservation = null
    return NextResponse.json(result)
  } catch (error) {
    await refundReservedCreditsQuietly(reservation)
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

function parsePersonProfile(serialized: unknown, extracted: unknown): Record<string, unknown> | undefined {
  if (extracted && typeof extracted === "object" && !Array.isArray(extracted)) {
    return extracted as Record<string, unknown>
  }
  if (typeof serialized !== "string" || !serialized.trim()) return undefined
  try {
    const parsed = JSON.parse(serialized)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}
