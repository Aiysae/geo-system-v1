"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { DEFAULT_CATEGORY_CONFIG, type ExtractedProfile, type ExtractedItem, type GeoStrategyPlan, type ToolStep, type GenerationStatus, type UploadedFile, type QuestionItem, type ContentCalendarItem, type QuestionCategoryConfig, type ThirdPartySite } from "@/types/geo-strategy"
import type { Client } from "@/types"
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, CloudUpload, Copy, Download, FileText, Loader2, Plus, RefreshCw, Settings, Trash2, X, Sparkles, Search, Eye, EyeOff, ListOrdered, AlertCircle } from "lucide-react"
import type { AiProviderPublicSetting } from "@/types/ai-settings"
import { apiFetch, readApiJson } from "@/lib/api-fetch"

// ==================== Brand Data ====================

const QUESTION_GENERATION_LIMIT = 600
const QUESTION_SINGLE_REQUEST_LIMIT = 50
const QUESTION_MAX_BATCH_ATTEMPTS = 3

function clampQuestionCount(value: unknown, fallback = 40, allowCustomMarker = false): number {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  if (numeric === -1) return allowCustomMarker ? -1 : fallback
  return Math.min(QUESTION_GENERATION_LIMIT, Math.max(10, Math.round(numeric)))
}

function questionKey(question: string): string {
  return question.replace(/\s+/g, "").toLowerCase()
}

function buildLocalContentCalendar(
  questions: QuestionItem[],
  strategy: GeoStrategyPlan,
): ContentCalendarItem[] {
  const platforms = Array.from(new Set(
    (strategy.media_plan || [])
      .map(item => item.platform?.trim())
      .filter(Boolean)
  ))
  const fallbackPlatforms = ["知乎", "小红书", "公众号", "百家号", "头条号", "B站专栏"]
  const channelPool = platforms.length > 0 ? platforms : fallbackPlatforms
  const contentTypes = ["问答文章", "避坑清单", "对比测评", "案例解析", "FAQ短文", "视频脚本"]
  const goals = [
    "覆盖高频用户疑问，建立官网与第三方内容的事实一致性",
    "承接用户决策顾虑，提升生成式引擎可引用的信息密度",
    "围绕痛点和场景输出可验证内容，增强品牌被推荐概率",
    "补充对比、案例和避坑信息，强化第三方交叉验证",
  ]

  return questions.slice(0, Math.min(questions.length, 36)).map((question, index) => {
    const clean = question.question.replace(/[？?]\s*$/, "").trim()
    return {
      week: `第 ${Math.floor(index / 6) + 1} 周`,
      platform: question.suggested_channel || channelPool[index % channelPool.length],
      question: question.question,
      article_title: clean.length > 34 ? `${clean.slice(0, 34)}...怎么判断？` : `${clean || "围绕目标疑问句的内容选题"}？一篇讲清选择逻辑`,
      content_type: contentTypes[index % contentTypes.length],
      geo_goal: goals[index % goals.length],
    }
  })
}

interface BrandData {
  id: string
  name: string
  step: ToolStep
  completedSteps: ToolStep[]
  projectName: string
  industry: string
  audience: string
  locationTerms: string
  productDesc: string
  coreAdvantages: string
  painPointsRaw: string
  competitorsRaw: string
  geoGoals: string
  uploadedFiles: UploadedFile[]
  extracting: boolean
  extractionError: string
  extractedProfile: ExtractedProfile | null
  advantageStatus: GenerationStatus
  advantageError: string
  strategyStatus: GenerationStatus
  strategyError: string
  strategyPlan: GeoStrategyPlan | null
  questionStatus: GenerationStatus
  questionError: string
  questionCount: number
  customQuestionCount: number
  questionCustomKeywords: string
  layer2Ratio: number
  categoryConfig: QuestionCategoryConfig
  questions: QuestionItem[]
  contentCalendar: ContentCalendarItem[]
}

function createBrand(name: string, overrides: Partial<BrandData> = {}): BrandData {
  const base: BrandData = {
    id: genId(),
    name,
    step: "input",
    completedSteps: ["input"],
    projectName: "",
    industry: "",
    audience: "",
    locationTerms: "",
    productDesc: "",
    coreAdvantages: "",
    painPointsRaw: "",
    competitorsRaw: "",
    geoGoals: "",
    uploadedFiles: [],
    extracting: false,
    extractionError: "",
    extractedProfile: null,
    advantageStatus: "idle",
    advantageError: "",
    strategyStatus: "idle",
    strategyError: "",
    strategyPlan: null,
    questionStatus: "idle",
    questionError: "",
    questionCount: 40,
    customQuestionCount: 120,
    questionCustomKeywords: "",
    layer2Ratio: 0.35,
    categoryConfig: DEFAULT_CATEGORY_CONFIG,
    questions: [],
    contentCalendar: [],
  }

  return { ...base, ...overrides, name: overrides.name ?? name }
}

function createBrandFromClient(client: Client): BrandData {
  const fallback = createBrand(client.name, {
    id: client.id,
    projectName: client.ourBrand || client.name,
    industry: client.industry,
    competitorsRaw: client.competitors.join("\n"),
  })

  const saved = client.keywordStrategy
  if (!saved) return fallback

  return {
    ...fallback,
    ...saved,
    id: saved.id || client.id,
    name: client.name,
    projectName: saved.projectName || client.ourBrand || client.name,
    industry: saved.industry || client.industry,
    competitorsRaw: saved.competitorsRaw || client.competitors.join("\n"),
    questionCount: clampQuestionCount(saved.questionCount, fallback.questionCount, true),
    customQuestionCount: clampQuestionCount(saved.customQuestionCount, fallback.customQuestionCount),
    questionCustomKeywords: typeof saved.questionCustomKeywords === "string" ? saved.questionCustomKeywords : "",
    uploadedFiles: Array.isArray(saved.uploadedFiles) ? saved.uploadedFiles : [],
    categoryConfig: {
      ...DEFAULT_CATEGORY_CONFIG,
      ...(saved.categoryConfig || {}),
    },
    completedSteps: saved.completedSteps?.length ? saved.completedSteps : fallback.completedSteps,
    extracting: false,
  }
}

// ==================== Helpers ====================

function genId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function normalizeExtractedItem(item: unknown): ExtractedItem {
  if (typeof item === "string") {
    return { id: genId(), text: item, enabled: true, confidence: "medium" }
  }

  if (item && typeof item === "object") {
    const obj = item as Partial<ExtractedItem>
    const confidence = obj.confidence === "high" || obj.confidence === "low" ? obj.confidence : "medium"
    return {
      id: obj.id || genId(),
      text: String(obj.text || ""),
      enabled: obj.enabled !== false,
      confidence,
    }
  }

  return { id: genId(), text: String(item || ""), enabled: true, confidence: "medium" }
}

function normalizeExtractedProfile(profile: ExtractedProfile): ExtractedProfile {
  return {
    ...profile,
    pain_points: (profile.pain_points || []).map(normalizeExtractedItem),
    advantages: (profile.advantages || []).map(normalizeExtractedItem),
    weaknesses: (profile.weaknesses || []).map(normalizeExtractedItem),
    competitors: (profile.competitors || []).map(normalizeExtractedItem),
    scenes: (profile.scenes || []).map(normalizeExtractedItem),
  }
}

/** check if a model name suggests it's text-only (no vision support) */
function isTextOnlyModel(model: string): boolean {
  const m = model.toLowerCase()
  // known vision-capable patterns
  if (/\bvl\b/.test(m)) return false // qwen3-vl, qwen-vl, etc
  if (/\bvision\b/.test(m)) return false
  if (/gpt-4o/.test(m)) return false
  if (/gpt-4-turbo/.test(m)) return false
  if (/claude/.test(m)) return false
  if (/gemini/.test(m)) return false
  if (/glm-4v/.test(m)) return false
  if (/pixtral/.test(m)) return false
  if (/llava/.test(m)) return false
  if (/cogvlm/.test(m)) return false
  // known text-only patterns
  if (/^deepseek/.test(m)) return true
  if (/qwen\d*[.\d]*(plus|max|turbo)/.test(m) && !/vl/.test(m)) return true
  if (/moonshot/.test(m)) return true
  if (/glm-4-(?!v)/.test(m)) return true
  if (/gpt-3\.5/.test(m)) return true
  if (/qwen-plus/.test(m) || /qwen-max/.test(m) || /qwen-turbo/.test(m)) return true
  // if unknown, assume it might support vision (don't false-positive warn)
  return false
}

function deriveCoreKeywords(strategy: GeoStrategyPlan): string[] {
  const keywords = new Set<string>()
  for (const term of strategy.profile?.terms || []) {
    const t = term.trim()
    if (t) keywords.add(t)
  }
  const brand = strategy.profile?.brand_or_product?.trim()
  if (brand) keywords.add(brand)
  for (const adv of strategy.profile?.advantages || []) {
    const a = adv.trim()
    if (a) keywords.add(a)
  }
  for (const kw of strategy.keyword_strategy?.core_keywords || []) {
    const k = kw.keyword?.trim()
    if (k) keywords.add(k)
  }
  return Array.from(keywords)
}

function parseQuestionKeywords(input: string): string[] {
  const seen = new Set<string>()
  const keywords: string[] = []
  for (const raw of input.split(/[\n\r,，;；、]+/)) {
    const keyword = raw.trim()
    const key = keyword.replace(/\s+/g, "").toLowerCase()
    if (!keyword || seen.has(key)) continue
    seen.add(key)
    keywords.push(keyword)
  }
  return keywords
}

type QuestionCategoryKey = "weakness_spin" | "core_keywords" | "secondary_keywords" | "pain_scenario"

interface QuestionAllocationOverride {
  category: QuestionCategoryKey
  count: number
}

interface QuestionBatchPlan {
  totalCount: number
  allocationOverrides: QuestionAllocationOverride[]
}

function calculateQuestionAllocationCounts(
  strategy: GeoStrategyPlan,
  totalCount: number,
  cfg: QuestionCategoryConfig,
): Record<QuestionCategoryKey, number> {
  const weaknesses = strategy.profile?.weaknesses || []
  const rawWeaknessTotal = weaknesses.length * cfg.weaknessesPerWeakness
  let weaknessCount = Math.min(rawWeaknessTotal, totalCount)

  if (weaknesses.length > 0 && rawWeaknessTotal > totalCount) {
    weaknessCount = Math.max(1, Math.floor(totalCount / weaknesses.length)) * weaknesses.length
  }

  const remaining = Math.max(0, totalCount - weaknessCount)
  const coreMinTotal = Math.ceil(totalCount * 0.30)
  let core = 0
  let secondary = 0
  let painScenario = 0

  if (cfg.allocationMode === "custom") {
    core = Math.min(Math.max(cfg.coreCount ?? 0, 0), remaining)
    secondary = Math.min(Math.max(cfg.secondaryCount ?? 0, 0), remaining)
    painScenario = Math.min(Math.max(cfg.painScenarioCount ?? 0, 0), remaining)
    const customTotal = core + secondary + painScenario
    if (customTotal > remaining && customTotal > 0) {
      const ratio = remaining / customTotal
      core = Math.floor(core * ratio)
      secondary = Math.floor(secondary * ratio)
      painScenario = remaining - core - secondary
    }
  } else {
    core = Math.max(Math.floor(remaining * cfg.coreRatio), Math.min(coreMinTotal, remaining))
    secondary = Math.floor(remaining * cfg.secondaryRatio)
    painScenario = remaining - core - secondary
    if (painScenario < 0) {
      secondary = Math.max(0, remaining - core)
      painScenario = Math.max(0, remaining - core - secondary)
    }
  }

  return {
    weakness_spin: Math.max(0, weaknessCount),
    core_keywords: Math.max(0, core),
    secondary_keywords: Math.max(0, secondary),
    pain_scenario: Math.max(0, painScenario),
  }
}

function buildQuestionBatchPlans(
  counts: Record<QuestionCategoryKey, number>,
): QuestionBatchPlan[] {
  const plans: QuestionBatchPlan[] = []
  const remaining = { ...counts }
  const order: QuestionCategoryKey[] = [
    "weakness_spin",
    "core_keywords",
    "secondary_keywords",
    "pain_scenario",
  ]

  let current: QuestionAllocationOverride[] = []
  let currentTotal = 0

  function flush() {
    if (currentTotal <= 0) return
    plans.push({ totalCount: currentTotal, allocationOverrides: current })
    current = []
    currentTotal = 0
  }

  for (const category of order) {
    while (remaining[category] > 0) {
      const capacity = QUESTION_SINGLE_REQUEST_LIMIT - currentTotal
      if (capacity <= 0) {
        flush()
        continue
      }
      const take = Math.min(capacity, remaining[category])
      current.push({ category, count: take })
      currentTotal += take
      remaining[category] -= take
      if (currentTotal >= QUESTION_SINGLE_REQUEST_LIMIT) flush()
    }
  }
  flush()

  return plans
}

function buildQuestionTextSeed(keyword: string, index: number): string {
  const scenarios = [
    "初次了解时",
    "准备采购前",
    "预算有限时",
    "团队规模较小时",
    "业务增长较快时",
    "替换旧方案时",
    "对比多个方案时",
    "需要长期使用时",
    "担心踩坑时",
    "老板要求评估时",
    "跨部门协同时",
    "本地服务落地时",
    "需要快速见效时",
    "重视售后服务时",
    "关注数据安全时",
  ]
  const dimensions = [
    "成本",
    "效果",
    "稳定性",
    "服务能力",
    "交付周期",
    "案例真实性",
    "使用门槛",
    "长期价值",
    "扩展能力",
    "风险点",
  ]
  const scenario = scenarios[Math.floor(index / 8) % scenarios.length]
  const dimension = dimensions[Math.floor(index / (8 * scenarios.length)) % dimensions.length]
  const templates = [
    `${scenario}，${keyword}适合哪些使用场景？`,
    `${scenario}，${keyword}怎么判断是否值得选择？`,
    `${scenario}，选择${keyword}前要重点看哪些${dimension}指标？`,
    `${scenario}，${keyword}和其他方案相比主要差别是什么？`,
    `${scenario}，${keyword}常见${dimension}避坑点有哪些？`,
    `${scenario}，${keyword}适合什么类型的团队或人群？`,
    `${scenario}，${keyword}落地时最容易遇到哪些${dimension}问题？`,
    `${scenario}，如何评估${keyword}的长期${dimension}价值？`,
  ]
  return templates[index % templates.length]
}

function buildFallbackQuestions(
  count: number,
  startId: number,
  keywords: string[],
  strategy: GeoStrategyPlan,
  usedKeys: Set<string>,
): QuestionItem[] {
  const keywordPool = keywords.length > 0
    ? keywords
    : [
        ...(strategy.profile?.terms || []),
        ...(strategy.keyword_strategy?.core_keywords || []).map(item => item.keyword),
        strategy.profile?.industry || "",
      ].map(item => item.trim()).filter(Boolean)
  const pool = keywordPool.length > 0 ? keywordPool : ["行业解决方案"]
  const questions: QuestionItem[] = []
  const localSeen = new Set(usedKeys)
  let cursor = 0

  while (questions.length < count && cursor < count * Math.max(12, pool.length * 3)) {
    const keyword = pool[cursor % pool.length]
    const question = buildQuestionTextSeed(keyword, cursor)
    const key = questionKey(question)
    cursor++
    if (!key || localSeen.has(key)) continue
    localSeen.add(key)
    questions.push({
      id: String(startId + questions.length),
      layer: cursor % 3 === 0 ? "第二层" : "第一层",
      category: "本地补齐问题",
      difficulty: "中",
      keyword,
      question,
      intent: "补充覆盖目标关键词下的用户真实决策问题",
      content_angle: "围绕用户选择标准、场景适配和避坑判断提供事实型内容",
      suggested_channel: "知乎",
    })
  }

  return questions
}

function readFileContent(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.type === "text/plain" || file.name.endsWith(".txt") || file.name.endsWith(".md") || file.name.endsWith(".csv")) {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsText(file)
    } else if (file.type.startsWith("image/") || file.type === "application/pdf" || file.name.endsWith(".pdf")) {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsDataURL(file)
    } else {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsText(file)
    }
  })
}

async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

const MAX_OFFICE_TEXT_LENGTH = 60_000
const ZIP_SIGNATURE = [0x50, 0x4b]
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

function limitOfficeText(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= MAX_OFFICE_TEXT_LENGTH) return trimmed
  return `${trimmed.slice(0, MAX_OFFICE_TEXT_LENGTH)}\n\n[内容较长，已截取前 ${MAX_OFFICE_TEXT_LENGTH} 个字符用于策略抽取]`
}

function hasFileSignature(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

async function extractWordOnServer(file: File): Promise<string> {
  const formData = new FormData()
  formData.append("file", file)

  const res = await apiFetch("/api/geo-strategy/parse-word", {
    method: "POST",
    body: formData,
  })
  const data = await readApiJson<{ content?: string; format?: "doc" | "docx"; error?: string }>(
    res,
    "Word 文档解析"
  )

  if (!res.ok || !data.content) {
    throw new Error(data.error || "Word 文档解析失败，请另存为新的 .docx 文件后重试")
  }
  return data.content
}

async function readWordDocument(file: File): Promise<string> {
  const buffer = await readFileAsArrayBuffer(file)
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 8))
  let rawContent: string

  if (hasFileSignature(bytes, OLE_SIGNATURE)) {
    rawContent = await extractWordOnServer(file)
  } else if (hasFileSignature(bytes, ZIP_SIGNATURE)) {
    try {
      const mammoth = await import("mammoth")
      const result = await mammoth.extractRawText({ arrayBuffer: buffer })
      rawContent = result.value
    } catch (error) {
      console.warn("[keyword-strategy] DOCX browser parse failed, retrying on server:", error)
      rawContent = await extractWordOnServer(file)
    }
  } else {
    throw new Error("文件后缀虽然是 Word，但实际内容不是有效的 .doc 或 .docx 文档")
  }

  const content = limitOfficeText(rawContent)
  if (!content) throw new Error("Word 文档没有可提取的文字")
  return `【Word 文档：${file.name}】\n${content}`
}

async function readExcelWorkbook(file: File): Promise<string> {
  const { default: readXlsxFile } = await import("read-excel-file/browser")

  const formatCell = (value: unknown): string => {
    if (value == null) return ""
    if (value instanceof Date) return value.toISOString()
    return String(value)
  }

  const escapeCsv = (value: string): string =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

  const workbookSheets = await readXlsxFile(file)
  const sheets: string[] = []
  for (const sheet of workbookSheets) {
    const csvRows = sheet.data
      .slice(0, 2000)
      .map(row => row.map(value => escapeCsv(formatCell(value))).join(","))
      .filter(row => row.replace(/,/g, "").trim())
    if (csvRows.length > 0) sheets.push(`【工作表：${sheet.sheet}】\n${csvRows.join("\n")}`)
  }

  if (sheets.length === 0) throw new Error("Excel 表格没有可提取的数据")
  return limitOfficeText(`【Excel 文件：${file.name}】\n${sheets.join("\n\n")}`)
}

async function renderPdfToImages(file: File): Promise<UploadedFile[]> {
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs")
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()

  const buffer = await readFileAsArrayBuffer(file)
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise
  const maxPages = Math.min(pdf.numPages, 12)
  const pages: UploadedFile[] = []

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = Math.min(2, Math.max(1.2, 1600 / Math.max(baseViewport.width, baseViewport.height)))
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement("canvas")
    const context = canvas.getContext("2d")
    if (!context) continue

    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvasContext: context, viewport }).promise

    const content = canvas.toDataURL("image/jpeg", 0.86)
    pages.push({
      id: genId(),
      name: pdf.numPages > 1 ? `${file.name} - 第${pageNum}页.jpg` : `${file.name}.jpg`,
      type: "image",
      content,
      size: Math.round(content.length * 0.75),
    })
  }

  if (pdf.numPages > maxPages) {
    pages.push({
      id: genId(),
      name: `${file.name} - 仅转换前${maxPages}页说明.txt`,
      type: "text",
      content: `PDF 共 ${pdf.numPages} 页，为控制识别请求大小，本次已转换前 ${maxPages} 页为图片。`,
      size: 80,
    })
  }

  return pages
}

// ==================== Main Module ====================

interface Props {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
}

export default function KeywordStrategyModule({ client, onChangeClient }: Props) {
  const [activeBrand, setActiveBrand] = useState<BrandData>(() => createBrandFromClient(client))
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Generic brand updater – merges a partial update into the active client's keyword state.
  const updateBrand = useCallback((patch: Partial<BrandData>) => {
    setActiveBrand(prev => {
      const next = { ...prev, ...patch }
      onChangeClient({ keywordStrategy: next })
      return next
    })
  }, [onChangeClient])

  function setBrandField<K extends keyof BrandData>(field: K, value: BrandData[K]) {
    updateBrand({ [field]: value })
  }

  const [keywordModelSetting, setKeywordModelSetting] = useState<AiProviderPublicSetting | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/geo-strategy/settings", { cache: "no-store" })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled) return
        const setting = data?.keywordStrategy
        if (setting) setKeywordModelSetting(setting as AiProviderPublicSetting)
      })
      .catch(() => {
        if (!cancelled) setKeywordModelSetting(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // File handlers
  const handleFilesSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const processed: UploadedFile[] = []
    const uploadErrors: string[] = []

    for (const file of files) {
      const lowerName = file.name.toLowerCase()
      try {
        if (lowerName.endsWith(".xls")) {
          throw new Error("暂不支持旧版 .xls，请在 Excel 中另存为 .xlsx 或 .csv 后上传")
        }
        if (lowerName.endsWith(".docx") || lowerName.endsWith(".doc")) {
          const content = await readWordDocument(file)
          processed.push({ id: genId(), name: file.name, type: "word", content, size: file.size })
        } else if (lowerName.endsWith(".xlsx")) {
          const content = await readExcelWorkbook(file)
          processed.push({ id: genId(), name: file.name, type: "excel", content, size: file.size })
        } else if (file.type === "application/pdf" || lowerName.endsWith(".pdf")) {
          const pages = await renderPdfToImages(file)
          processed.push(...pages)
        } else {
          const content = await readFileContent(file)
          const type = file.type.startsWith("image/") ? "image" as const : "text" as const
          processed.push({ id: genId(), name: file.name, type, content, size: file.size })
        }
      } catch (error) {
        if (file.type === "application/pdf" || lowerName.endsWith(".pdf")) {
          processed.push({
            id: genId(),
            name: `${file.name} - PDF转换失败说明.txt`,
            type: "text",
            content: "该 PDF 未能在浏览器中转换为图片，请将 PDF 页面另存为 JPG/PNG 后重新上传。",
            size: 50,
          })
        } else if (!lowerName.endsWith(".docx") && !lowerName.endsWith(".doc") && !lowerName.endsWith(".xlsx") && !lowerName.endsWith(".xls")) {
          try {
            const content = await readFileContent(file)
            processed.push({ id: genId(), name: file.name, type: "text", content, size: file.size })
          } catch {
            uploadErrors.push(`${file.name}：文件读取失败`)
          }
        } else {
          uploadErrors.push(`${file.name}：${error instanceof Error ? error.message : "文件解析失败"}`)
        }
      }
    }

    updateBrand({
      uploadedFiles: [...activeBrand.uploadedFiles, ...processed],
      extractionError: uploadErrors.join("；"),
    })
    if (e.target) e.target.value = ""
  }, [activeBrand.uploadedFiles, updateBrand])

  const removeFile = useCallback((id: string) => {
    updateBrand({ uploadedFiles: activeBrand.uploadedFiles.filter(f => f.id !== id) })
  }, [activeBrand.uploadedFiles, updateBrand])

  // Extraction
  const handleExtract = useCallback(async () => {
    if (keywordModelSetting && !keywordModelSetting.hasApiKey) {
      updateBrand({ extractionError: "后台未配置关键词策略模型 API Key，请联系管理员在后台管理页配置。" })
      return
    }

    updateBrand({ extracting: true, extractionError: "" })

    try {
      const res = await fetch("/api/geo-strategy/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: activeBrand.uploadedFiles.map(f => ({
            name: f.name,
            content: f.content,
            fileType: f.type,
          })),
          projectInfo: {
            project_name: activeBrand.projectName,
            industry: activeBrand.industry,
            audience: activeBrand.audience,
            location_terms: activeBrand.locationTerms,
            product_description: activeBrand.productDesc,
            core_advantages: activeBrand.coreAdvantages,
            pain_points_raw: activeBrand.painPointsRaw,
            competitors_raw: activeBrand.competitorsRaw,
            geo_goals: activeBrand.geoGoals,
          },
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || `请求失败 (${res.status})`)
      }

      updateBrand({
        extractedProfile: normalizeExtractedProfile(data as ExtractedProfile),
        step: "extraction",
        completedSteps: [...new Set([...activeBrand.completedSteps, "extraction" as ToolStep])],
      })
    } catch (err) {
      updateBrand({ extractionError: err instanceof Error ? err.message : "提取失败" })
    } finally {
      updateBrand({ extracting: false })
    }
  }, [activeBrand.uploadedFiles, activeBrand.projectName, activeBrand.industry, activeBrand.audience, activeBrand.locationTerms, activeBrand.productDesc, activeBrand.coreAdvantages, activeBrand.painPointsRaw, activeBrand.competitorsRaw, activeBrand.geoGoals, activeBrand.completedSteps, keywordModelSetting, updateBrand])

  const handleGenerateAdvantages = useCallback(async () => {
    if (!activeBrand.extractedProfile) return
    if (keywordModelSetting && !keywordModelSetting.hasApiKey) {
      updateBrand({ advantageError: "后台未配置关键词策略模型 API Key，请联系管理员在后台管理页配置。" })
      return
    }

    updateBrand({ advantageStatus: "generating", advantageError: "" })

    try {
      const res = await fetch("/api/geo-strategy/advantages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: activeBrand.extractedProfile,
          rawInputs: {
            project_name: activeBrand.projectName,
            industry: activeBrand.industry,
            audience: activeBrand.audience,
            location_terms: activeBrand.locationTerms,
            product_description: activeBrand.productDesc,
            core_advantages: activeBrand.coreAdvantages,
            pain_points_raw: activeBrand.painPointsRaw,
            competitors_raw: activeBrand.competitorsRaw,
            geo_goals: activeBrand.geoGoals,
          },
          count: 10,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || `请求失败 (${res.status})`)
      }

      const generated = ((data.advantages || []) as Array<Partial<ExtractedItem>>)
        .map(item => ({
          id: genId(),
          text: String(item.text || "").trim(),
          enabled: item.enabled !== false,
          confidence: item.confidence === "high" || item.confidence === "low" ? item.confidence : "medium" as const,
        }))
        .filter(item => item.text)

      const existing = activeBrand.extractedProfile.advantages || []
      const seen = new Set(existing.map(item => item.text.trim()))
      const merged = [
        ...existing,
        ...generated.filter(item => {
          if (seen.has(item.text)) return false
          seen.add(item.text)
          return true
        }),
      ]

      updateBrand({
        extractedProfile: {
          ...activeBrand.extractedProfile,
          advantages: merged,
        },
        advantageStatus: "done",
      })
    } catch (err) {
      updateBrand({
        advantageError: err instanceof Error ? err.message : "优势生成失败",
        advantageStatus: "error",
      })
    }
  }, [activeBrand.extractedProfile, activeBrand.projectName, activeBrand.industry, activeBrand.audience, activeBrand.locationTerms, activeBrand.productDesc, activeBrand.coreAdvantages, activeBrand.painPointsRaw, activeBrand.competitorsRaw, activeBrand.geoGoals, keywordModelSetting, updateBrand])

  // Strategy generation
  const handleGenerateStrategy = useCallback(async () => {
    if (!activeBrand.extractedProfile) return

    updateBrand({ strategyStatus: "generating", strategyError: "" })

    try {
      const res = await apiFetch("/api/geo-strategy/generate", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: activeBrand.extractedProfile,
        }),
      })

      const data = await readApiJson<GeoStrategyPlan & { error?: string }>(res, "策略生成")

      if (!res.ok) {
        throw new Error(data.error || `请求失败 (${res.status})`)
      }
      if (!data.project_name || !data.profile || !data.keyword_strategy) {
        throw new Error("策略生成返回数据不完整，请重新生成。")
      }

      updateBrand({
        strategyPlan: data as GeoStrategyPlan,
        strategyStatus: "done",
        step: "strategy",
        completedSteps: [...new Set([...activeBrand.completedSteps, "strategy" as ToolStep])],
      })
    } catch (err) {
      updateBrand({
        strategyError: err instanceof Error ? err.message : "生成失败",
        strategyStatus: "error",
      })
    }
  }, [activeBrand.extractedProfile, activeBrand.completedSteps, updateBrand])

  // Question generation
  const handleGenerateQuestions = useCallback(async () => {
    const strategyPlan = activeBrand.strategyPlan
    if (!strategyPlan) return
    const generationPlan = strategyPlan
    if (keywordModelSetting && !keywordModelSetting.hasApiKey) {
      updateBrand({ questionError: "后台未配置关键词策略模型 API Key，请联系管理员在后台管理页配置。", questionStatus: "error" })
      return
    }

    updateBrand({ questionStatus: "generating", questionError: "" })

    const requestedCount = activeBrand.questionCount === -1 ? activeBrand.customQuestionCount : activeBrand.questionCount
    const effectiveCount = Math.min(QUESTION_GENERATION_LIMIT, Math.max(10, Math.round(requestedCount)))
    const weaknessCount = (generationPlan.profile?.weaknesses?.length || 0) * activeBrand.categoryConfig.weaknessesPerWeakness

    if (weaknessCount > effectiveCount) {
      updateBrand({
        questionError: `劣势转化问题 (${weaknessCount}条) 超过总问题数 (${effectiveCount}条)，请减少每个劣势的问题数或增加总数`,
        questionStatus: "error",
      })
      return
    }

    const customQuestionKeywords = parseQuestionKeywords(activeBrand.questionCustomKeywords)
    const coreKeywords = customQuestionKeywords.length > 0
      ? customQuestionKeywords
      : deriveCoreKeywords(generationPlan)

    try {
      type QuestionsResponse = {
        question_strategy?: QuestionItem[]
        content_calendar?: ContentCalendarItem[]
        warnings?: string[]
        error?: string
      }

      function isPermanentQuestionError(error: unknown): boolean {
        const message = error instanceof Error ? error.message : String(error)
        return /API Key|HTTP 401|unauthorized|无权限|未配置|权限/i.test(message)
      }

      async function requestQuestionBatch(
        plan: QuestionBatchPlan,
        avoidQuestions: string[]
      ): Promise<QuestionsResponse> {
        let lastError: unknown
        for (let attempt = 0; attempt < QUESTION_MAX_BATCH_ATTEMPTS; attempt++) {
          try {
            const res = await apiFetch("/api/geo-strategy/questions", {
              method: "POST",
              cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                strategy: generationPlan,
                totalCount: plan.totalCount,
                layer2Ratio: activeBrand.layer2Ratio,
                categoryConfig: activeBrand.categoryConfig,
                coreKeywords,
                customKeywords: customQuestionKeywords,
                allocationOverrides: plan.allocationOverrides,
                avoidQuestions,
              }),
            })

            const data = await readApiJson<QuestionsResponse>(res, "疑问句生成")

            if (!res.ok) {
              throw new Error(data.error || `请求失败 (${res.status})`)
            }
            if (!Array.isArray(data.question_strategy) || data.question_strategy.length === 0) {
              throw new Error("疑问句生成没有返回有效问题。")
            }

            return data
          } catch (error) {
            lastError = error
            if (isPermanentQuestionError(error) || attempt === QUESTION_MAX_BATCH_ATTEMPTS - 1) {
              break
            }
            await new Promise(resolve => window.setTimeout(resolve, 1200 * (attempt + 1)))
          }
        }

        throw lastError instanceof Error ? lastError : new Error("疑问句生成失败")
      }

      const allocationCounts = calculateQuestionAllocationCounts(
        generationPlan,
        effectiveCount,
        activeBrand.categoryConfig,
      )
      const batchPlans = buildQuestionBatchPlans(allocationCounts)

      const mergedQuestions: QuestionItem[] = []
      const seen = new Set<string>()
      const warnings: string[] = batchPlans.length > 1
        ? [`已自动拆分为 ${batchPlans.length} 批生成，避免服务网关中断。`]
        : []

      function appendQuestionItems(items: QuestionItem[]) {
        for (const question of items) {
          const key = questionKey(question.question)
          if (!key || seen.has(key)) continue
          seen.add(key)
          mergedQuestions.push(question)
          if (mergedQuestions.length >= effectiveCount) break
        }
      }

      function reindexQuestions(): QuestionItem[] {
        return mergedQuestions.slice(0, effectiveCount).map((question, index) => ({
          ...question,
          id: String(index + 1),
        }))
      }

      function savePartialQuestions() {
        const partial = reindexQuestions()
        if (partial.length === 0) return
        updateBrand({
          questions: partial,
          contentCalendar: buildLocalContentCalendar(partial, generationPlan),
          questionStatus: "generating",
        })
      }

      for (let index = 0; index < batchPlans.length && mergedQuestions.length < effectiveCount; index++) {
        const plan = batchPlans[index]
        try {
          const data = await requestQuestionBatch(
            plan,
            mergedQuestions.map(item => item.question)
          )
          appendQuestionItems((data.question_strategy || []).map((question, i) => ({
            ...question,
            id: String(mergedQuestions.length + i + 1),
          })))
          if (Array.isArray(data.warnings)) warnings.push(...data.warnings)
        } catch (error) {
          if (isPermanentQuestionError(error)) throw error
          warnings.push(`第 ${index + 1} 批模型生成失败，已用本地模板补齐该批次。`)
          appendQuestionItems(buildFallbackQuestions(
            plan.totalCount,
            mergedQuestions.length + 1,
            coreKeywords,
            generationPlan,
            seen,
          ))
        }
        savePartialQuestions()
      }

      for (let topUp = 0; topUp < 3 && mergedQuestions.length < effectiveCount; topUp++) {
        const need = Math.min(QUESTION_SINGLE_REQUEST_LIMIT, effectiveCount - mergedQuestions.length)
        const plan: QuestionBatchPlan = {
          totalCount: need,
          allocationOverrides: [{ category: "core_keywords", count: need }],
        }
        const before = mergedQuestions.length
        try {
          const data = await requestQuestionBatch(
            plan,
            mergedQuestions.map(item => item.question)
          )
          appendQuestionItems((data.question_strategy || []).map((question, i) => ({
            ...question,
            id: String(mergedQuestions.length + i + 1),
          })))
          if (Array.isArray(data.warnings)) warnings.push(...data.warnings)
        } catch (error) {
          if (isPermanentQuestionError(error)) throw error
          warnings.push(`补齐批次 ${topUp + 1} 模型生成失败，已继续尝试本地补齐。`)
          break
        }
        if (mergedQuestions.length <= before) break
        savePartialQuestions()
      }

      if (mergedQuestions.length < effectiveCount) {
        const missing = effectiveCount - mergedQuestions.length
        appendQuestionItems(buildFallbackQuestions(
          missing,
          mergedQuestions.length + 1,
          coreKeywords,
          generationPlan,
          seen,
        ))
        warnings.push(`模型去重后不足 ${effectiveCount} 条，已用本地模板补齐 ${missing} 条。`)
      }

      const reindexed = reindexQuestions()

      if (reindexed.length === 0) {
        throw new Error("疑问句生成没有返回有效问题，系统未保存空结果，请重新生成。")
      }

      updateBrand({
        questions: reindexed,
        contentCalendar: buildLocalContentCalendar(reindexed, generationPlan),
        questionError: warnings.length > 0 ? Array.from(new Set(warnings)).join("；") : "",
        questionStatus: "done",
        completedSteps: [...new Set([...activeBrand.completedSteps, "questions" as ToolStep])],
      })
    } catch (err) {
      updateBrand({
        questionError: err instanceof Error ? err.message : "生成失败",
        questionStatus: "error",
      })
    }
  }, [activeBrand.strategyPlan, activeBrand.completedSteps, activeBrand.questionCount, activeBrand.customQuestionCount, activeBrand.questionCustomKeywords, activeBrand.layer2Ratio, activeBrand.categoryConfig, keywordModelSetting, updateBrand])

  // Export
  const handleExportJson = useCallback(() => {
    if (!activeBrand.strategyPlan) return
    const full = { ...activeBrand.strategyPlan }
    if (activeBrand.questions.length) full.question_strategy = activeBrand.questions
    if (activeBrand.contentCalendar.length) full.content_calendar = activeBrand.contentCalendar
    const blob = new Blob([JSON.stringify(full, null, 2)], { type: "application/json" })
    downloadBlob(blob, `${activeBrand.strategyPlan.project_name || "GEO策略"}_完整方案.json`)
  }, [activeBrand.strategyPlan, activeBrand.questions, activeBrand.contentCalendar])

  const handleExportMarkdown = useCallback(() => {
    if (!activeBrand.strategyPlan) return
    const md = generateMarkdown(activeBrand.strategyPlan, activeBrand.questions, activeBrand.contentCalendar)
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" })
    downloadBlob(blob, `${activeBrand.strategyPlan.project_name || "GEO策略"}_方案报告.md`)
  }, [activeBrand.strategyPlan, activeBrand.questions, activeBrand.contentCalendar])

  const handleExportWord = useCallback(() => {
    if (!activeBrand.strategyPlan) return
    const html = generateWordHtml(activeBrand.strategyPlan, activeBrand.questions, activeBrand.contentCalendar)
    const blob = new Blob([html], { type: "application/msword;charset=utf-8" })
    downloadBlob(blob, `${activeBrand.strategyPlan.project_name || "GEO策略"}_方案报告.doc`)
  }, [activeBrand.strategyPlan, activeBrand.questions, activeBrand.contentCalendar])

  const handleReExtract = useCallback(async () => {
    await handleExtract()
  }, [handleExtract])

  // ==================== Render ====================

  const ab = activeBrand
  const keywordModelName = keywordModelSetting?.model || "后台托管模型"
  const keywordModelConfigured = keywordModelSetting?.hasApiKey ?? true

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-br from-white via-blue-50/30 to-cyan-50/20 shadow-sm">
      <div className="border-b border-slate-200/70 bg-white/85 backdrop-blur">
        <div className="px-3 sm:px-5 lg:px-6 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#004B73] to-[#00B4D8] flex items-center justify-center shrink-0 shadow-md shadow-cyan-200/50">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-sm sm:text-base font-semibold tracking-tight bg-gradient-to-r from-[#004B73] to-[#0077B6] bg-clip-text text-transparent">
                关键词策略 · GEO 策略生成工具
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                当前客户：{client.name}
              </div>
            </div>
          </div>
          <div className="w-full sm:w-auto inline-flex flex-wrap items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-xs text-slate-600">
            <span className={`h-2 w-2 rounded-full ${keywordModelConfigured ? "bg-emerald-500" : "bg-amber-500"}`} />
            <span className="font-medium text-slate-700">{keywordModelName}</span>
            <span className="text-slate-400">后台托管</span>
          </div>
        </div>
      </div>

        <div className="px-3 sm:px-5 lg:px-6 pt-4 overflow-x-auto">
          <StepProgress current={ab.step} />
        </div>

        <main className="px-3 sm:px-5 lg:px-6 py-5 md:py-6">
          {/* Step 1: Input */}
          {(ab.step === "input") && (
            <InputStep
              projectName={ab.projectName}
              onProjectNameChange={v => setBrandField("projectName", v)}
              industry={ab.industry}
              onIndustryChange={v => setBrandField("industry", v)}
              audience={ab.audience}
              onAudienceChange={v => setBrandField("audience", v)}
              locationTerms={ab.locationTerms}
              onLocationTermsChange={v => setBrandField("locationTerms", v)}
              productDesc={ab.productDesc}
              onProductDescChange={v => setBrandField("productDesc", v)}
              coreAdvantages={ab.coreAdvantages}
              onCoreAdvantagesChange={v => setBrandField("coreAdvantages", v)}
              painPointsRaw={ab.painPointsRaw}
              onPainPointsRawChange={v => setBrandField("painPointsRaw", v)}
              competitorsRaw={ab.competitorsRaw}
              onCompetitorsRawChange={v => setBrandField("competitorsRaw", v)}
              geoGoals={ab.geoGoals}
              onGeoGoalsChange={v => setBrandField("geoGoals", v)}
              uploadedFiles={ab.uploadedFiles}
              onRemoveFile={removeFile}
              fileInputRef={fileInputRef}
              onFilesSelected={handleFilesSelected}
              extracting={ab.extracting}
              extractionError={ab.extractionError}
              onExtract={handleExtract}
              modelConfigured={keywordModelConfigured}
              modelName={keywordModelName}
            />
          )}

          {/* Step 2: Extraction Review */}
          {(ab.step === "extraction") && ab.extractedProfile && (
            <ExtractionStep
              profile={ab.extractedProfile}
              onProfileChange={p => setBrandField("extractedProfile", p)}
              onBack={() => updateBrand({ step: "input" })}
              onGenerate={handleGenerateStrategy}
              generating={ab.strategyStatus === "generating"}
              strategyError={ab.strategyError}
              advantageStatus={ab.advantageStatus}
              advantageError={ab.advantageError}
              onGenerateAdvantages={handleGenerateAdvantages}
              reExtracting={ab.extracting}
              onReExtract={handleReExtract}
            />
          )}

          {/* Step 3: Strategy Result */}
          {(ab.step === "strategy") && ab.strategyPlan && (
            <StrategyStep
              plan={ab.strategyPlan}
              questions={ab.questions}
              contentCalendar={ab.contentCalendar}
              questionStatus={ab.questionStatus}
              questionError={ab.questionError}
              questionCount={ab.questionCount}
              customQuestionCount={ab.customQuestionCount}
              questionCustomKeywords={ab.questionCustomKeywords}
              layer2Ratio={ab.layer2Ratio}
              onQuestionCountChange={v => setBrandField("questionCount", v)}
              onCustomQuestionCountChange={v => setBrandField("customQuestionCount", v)}
              onQuestionCustomKeywordsChange={v => setBrandField("questionCustomKeywords", v)}
              onLayer2RatioChange={v => setBrandField("layer2Ratio", v)}
              categoryConfig={ab.categoryConfig}
              onCategoryConfigChange={v => setBrandField("categoryConfig", v)}
              onGenerateQuestions={handleGenerateQuestions}
              onExportJson={handleExportJson}
              onExportMarkdown={handleExportMarkdown}
              onExportWord={handleExportWord}
              onBack={() => updateBrand({ step: "extraction" })}
              hasQuestions={ab.questions.length > 0}
            />
          )}
        </main>
    </div>
  )
}

// ==================== Step Progress ====================

function StepProgress({ current }: { current: ToolStep }) {
  const steps: { key: ToolStep; label: string }[] = [
    { key: "input", label: "上传资料" },
    { key: "extraction", label: "确认资料" },
    { key: "strategy", label: "策略方案" },
    { key: "questions", label: "疑问句池" },
  ]

  const idx = steps.findIndex(s => s.key === current)

  return (
    <div className="flex min-w-[560px] items-center gap-1 mb-2 sm:min-w-0">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1 flex-1">
          <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full transition-all
            ${i < idx ? "bg-emerald-100 text-emerald-700" : i === idx ? "bg-[#004B73] text-white shadow-md" : "bg-slate-100 text-slate-400"}`}>
            {i < idx ? <Check className="h-3 w-3" /> : <span className="w-3 h-3 rounded-full bg-current flex items-center justify-center text-[8px] font-bold">{i + 1}</span>}
            {s.label}
          </div>
          {i < steps.length - 1 && <div className={`flex-1 h-px ${i < idx ? "bg-emerald-300" : "bg-slate-200"}`} />}
        </div>
      ))}
    </div>
  )
}

// ==================== Step 1: Input ====================

function InputStep({
  projectName, onProjectNameChange,
  industry, onIndustryChange,
  audience, onAudienceChange,
  locationTerms, onLocationTermsChange,
  productDesc, onProductDescChange,
  coreAdvantages, onCoreAdvantagesChange,
  painPointsRaw, onPainPointsRawChange,
  competitorsRaw, onCompetitorsRawChange,
  geoGoals, onGeoGoalsChange,
  uploadedFiles, onRemoveFile,
  fileInputRef, onFilesSelected,
  extracting, extractionError, onExtract,
  modelConfigured, modelName,
}: {
  projectName: string; onProjectNameChange: (v: string) => void
  industry: string; onIndustryChange: (v: string) => void
  audience: string; onAudienceChange: (v: string) => void
  locationTerms: string; onLocationTermsChange: (v: string) => void
  productDesc: string; onProductDescChange: (v: string) => void
  coreAdvantages: string; onCoreAdvantagesChange: (v: string) => void
  painPointsRaw: string; onPainPointsRawChange: (v: string) => void
  competitorsRaw: string; onCompetitorsRawChange: (v: string) => void
  geoGoals: string; onGeoGoalsChange: (v: string) => void
  uploadedFiles: UploadedFile[]; onRemoveFile: (id: string) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onFilesSelected: (e: React.ChangeEvent<HTMLInputElement>) => void
  extracting: boolean; extractionError: string; onExtract: () => void
  modelConfigured: boolean
  modelName: string
}) {
  return (
    <div className="space-y-6 animate-fade-in-up">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-800">GEO 策略方案生成</h1>
        <p className="text-sm text-slate-500 mt-1">上传客户资料，填写基础信息，系统将自动抽取结构化数据并生成优化策略</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Upload Area */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white/70 backdrop-blur rounded-2xl border border-slate-200/60 p-4 shadow-sm sm:p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <CloudUpload className="h-4 w-4 text-blue-500" />
              上传资料
            </h2>
            <div
              className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileText className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-xs text-slate-500">点击上传 PDF / Word / Excel / 图片 / 文本</p>
              <p className="text-[10px] text-slate-400 mt-1">支持 .doc、.docx、.xlsx、调研报告、截图和笔记</p>
              <p className="text-[10px] text-amber-500 mt-1">图片/PDF 需视觉模型；Word/Excel 会自动提取文字和表格</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xlsx,.jpg,.jpeg,.png,.txt,.md,.csv"
                className="hidden"
                onChange={onFilesSelected}
              />
            </div>

            {uploadedFiles.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {uploadedFiles.map(f => (
                  <div key={f.id} className="flex items-center gap-2 text-xs bg-slate-50 rounded-lg px-3 py-2">
                    <FileText className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="truncate flex-1 text-slate-600">{f.name}</span>
                    <span className="text-[10px] text-slate-400">
                      {f.type === "image"
                        ? "图片"
                        : f.type === "pdf"
                          ? "PDF"
                          : f.type === "word"
                            ? "Word"
                            : f.type === "excel"
                              ? "Excel"
                              : "文本"}
                    </span>
                    <button onClick={() => onRemoveFile(f.id)} className="text-slate-300 hover:text-red-400 transition">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white/70 backdrop-blur rounded-2xl border border-slate-200/60 p-4 shadow-sm sm:p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <Search className="h-4 w-4 text-purple-500" />
              竞争与目标
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-slate-500">竞品/替代方案</label>
                <textarea
                  value={competitorsRaw}
                  onChange={e => onCompetitorsRawChange(e.target.value)}
                  placeholder="竞品名称，每行一个"
                  className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white/60 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200/40 transition resize-none"
                  rows={3}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-500">GEO 目标</label>
                <textarea
                  value={geoGoals}
                  onChange={e => onGeoGoalsChange(e.target.value)}
                  placeholder="例如：提高在豆包/DeepSeek中的品牌提及率、覆盖用户疑问句等"
                  className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white/60 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200/40 transition resize-none"
                  rows={2}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right: Form */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white/70 backdrop-blur rounded-2xl border border-slate-200/60 p-4 shadow-sm sm:p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <ListOrdered className="h-4 w-4 text-emerald-500" />
              基础信息
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-[11px] font-medium text-slate-500">客户/项目名称</label>
                <input
                  value={projectName}
                  onChange={e => onProjectNameChange(e.target.value)}
                  placeholder="例：贵竹风 GEO 优化"
                  className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white/60 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200/40 transition"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-500">行业/品类</label>
                <input
                  value={industry}
                  onChange={e => onIndustryChange(e.target.value)}
                  placeholder="例：食品加工 / 竹笋干"
                  className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white/60 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200/40 transition"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-500">目标客户</label>
                <input
                  value={audience}
                  onChange={e => onAudienceChange(e.target.value)}
                  placeholder="例：火锅店老板、采购经理"
                  className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white/60 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200/40 transition"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-500">地域词</label>
                <input
                  value={locationTerms}
                  onChange={e => onLocationTermsChange(e.target.value)}
                  placeholder="例：四川、重庆"
                  className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white/60 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200/40 transition"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-500">产品/服务说明</label>
                <input
                  value={productDesc}
                  onChange={e => onProductDescChange(e.target.value)}
                  placeholder="主要产品或服务"
                  className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white/60 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200/40 transition"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-500">核心优势</label>
                <input
                  value={coreAdvantages}
                  onChange={e => onCoreAdvantagesChange(e.target.value)}
                  placeholder="例：口感稳定、供应链稳定"
                  className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white/60 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200/40 transition"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[11px] font-medium text-slate-500">目标客户痛点</label>
                <textarea
                  value={painPointsRaw}
                  onChange={e => onPainPointsRawChange(e.target.value)}
                  placeholder="客户关注的痛点问题"
                  className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white/60 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200/40 transition resize-none"
                  rows={2}
                />
              </div>
            </div>
          </div>

          {extractionError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {extractionError}
            </div>
          )}

          {!modelConfigured && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              关键词策略模型暂未在后台配置，配置完成后即可抽取资料。
            </div>
          )}

          {uploadedFiles.some(f => f.type === "image" || f.type === "pdf") && isTextOnlyModel(modelName) && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-xs text-amber-800 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold mb-1">当前模型不支持图片/PDF</div>
                <div><code className="bg-amber-100 px-1 rounded">{modelName}</code> 是纯文本模型，无法识别图片和 PDF 中的内容。请将模型名改为：<code className="bg-green-100 px-1 rounded text-green-800">qwen3-vl-plus</code></div>
              </div>
            </div>
          )}

          <button
            onClick={onExtract}
            disabled={extracting || !modelConfigured}
            className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold rounded-xl bg-gradient-to-r from-[#004B73] to-[#0077B6] text-white hover:shadow-lg hover:shadow-blue-300/30 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:hover:translate-y-0 transition-all"
          >
            {extracting ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> AI 正在抽取资料...</>
            ) : (
              <><Sparkles className="h-4 w-4" /> 提交并抽取资料</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ==================== Step 2: Extraction Review ====================

function ExtractionStep({
  profile, onProfileChange, onBack, onGenerate, generating, strategyError,
  advantageStatus, advantageError, onGenerateAdvantages,
  reExtracting, onReExtract,
}: {
  profile: ExtractedProfile
  onProfileChange: (p: ExtractedProfile) => void
  onBack: () => void
  onGenerate: () => void
  generating: boolean
  strategyError: string
  advantageStatus: GenerationStatus
  advantageError: string
  onGenerateAdvantages: () => void
  reExtracting: boolean
  onReExtract: () => void
}) {
  const updateItem = useCallback((field: keyof ExtractedProfile, index: number, patch: Partial<ExtractedItem>) => {
    onProfileChange({
      ...profile,
      [field]: (profile[field] as ExtractedItem[]).map((item, i) =>
        i === index ? { ...item, ...patch } : item
      ),
    })
  }, [profile, onProfileChange])

  const addItem = useCallback((field: keyof ExtractedProfile) => {
    onProfileChange({
      ...profile,
      [field]: [...(profile[field] as ExtractedItem[]), { id: genId(), text: "", enabled: true, confidence: "medium" as const }],
    })
  }, [profile, onProfileChange])

  const removeItem = useCallback((field: keyof ExtractedProfile, index: number) => {
    onProfileChange({
      ...profile,
      [field]: (profile[field] as ExtractedItem[]).filter((_, i) => i !== index),
    })
  }, [profile, onProfileChange])

  const updateField = useCallback((field: keyof ExtractedProfile, value: string) => {
    onProfileChange({ ...profile, [field]: value })
  }, [profile, onProfileChange])

  const sections: { key: keyof ExtractedProfile; label: string; color: string }[] = [
    { key: "pain_points", label: "痛点", color: "rose" },
    { key: "advantages", label: "优势", color: "emerald" },
    { key: "weaknesses", label: "劣势", color: "amber" },
    { key: "competitors", label: "竞品", color: "violet" },
    { key: "scenes", label: "场景", color: "cyan" },
  ]

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">确认资料抽取结果</h1>
          <p className="text-xs text-slate-500 mt-1">编辑、删除或新增条目后，点击「确认并生成策略」</p>
        </div>
        <div className="flex items-center gap-2">
          {profile.source_notes && (
            <span className="text-[10px] text-slate-400">{profile.source_notes}</span>
          )}
        </div>
      </div>

      {/* Basic fields */}
      <div className="bg-white/70 backdrop-blur rounded-2xl border border-slate-200/60 p-4 shadow-sm grid grid-cols-1 sm:grid-cols-2 gap-3 sm:p-5">
        <div>
          <label className="text-[11px] font-medium text-slate-500">项目名称</label>
          <input value={profile.project_name} onChange={e => updateField("project_name", e.target.value)}
            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white/60 outline-none focus:border-blue-400 transition" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-slate-500">行业</label>
          <input value={profile.industry} onChange={e => updateField("industry", e.target.value)}
            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white/60 outline-none focus:border-blue-400 transition" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-slate-500">目标客户</label>
          <input value={profile.audience} onChange={e => updateField("audience", e.target.value)}
            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white/60 outline-none focus:border-blue-400 transition" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-slate-500">GEO 目标</label>
          <input value={profile.geo_goals} onChange={e => updateField("geo_goals", e.target.value)}
            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white/60 outline-none focus:border-blue-400 transition" />
        </div>
        <div className="sm:col-span-2">
          <label className="text-[11px] font-medium text-slate-500">产品说明</label>
          <textarea value={profile.product_description} onChange={e => updateField("product_description", e.target.value)}
            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white/60 outline-none focus:border-blue-400 transition resize-none" rows={2} />
        </div>
      </div>

      {/* Array fields */}
      {sections.map(section => (
        <div key={section.key} className="bg-white/70 backdrop-blur rounded-2xl border border-slate-200/60 p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold text-slate-700">{section.label}</h2>
            <div className="flex items-center gap-2">
              {section.key === "advantages" && (
                <button
                  onClick={onGenerateAdvantages}
                  disabled={advantageStatus === "generating"}
                  className="text-xs inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {advantageStatus === "generating" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  生成优势
                </button>
              )}
              <button onClick={() => addItem(section.key)}
                className="text-xs inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition">
                <Plus className="h-3 w-3" /> 新增
              </button>
            </div>
          </div>
          {section.key === "advantages" && advantageError && (
            <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-600 flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {advantageError}
            </div>
          )}
          <div className="space-y-2">
            {(profile[section.key] as ExtractedItem[]).length === 0 && (
              <p className="text-xs text-slate-400 py-2">暂无条目</p>
            )}
            {(profile[section.key] as ExtractedItem[]).map((item, i) => (
              <div key={item.id || `${String(section.key)}-${i}`} className={`flex items-start gap-2 p-3 rounded-xl border transition ${
                item.enabled ? "bg-white border-slate-200" : "bg-slate-50 border-slate-100 opacity-60"
              }`}>
                <div className="flex items-center gap-1.5 pt-1">
                  <button onClick={() => updateItem(section.key, i, { enabled: !item.enabled })}
                    className={`p-1 rounded-md transition ${item.enabled ? "text-emerald-500 hover:text-emerald-600" : "text-slate-300 hover:text-slate-400"}`}>
                    {item.enabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <input
                  value={item.text}
                  onChange={e => updateItem(section.key, i, { text: e.target.value })}
                  className="flex-1 text-sm bg-transparent outline-none text-slate-700 placeholder-slate-300"
                  placeholder="编辑内容..."
                />
                {item.confidence === "low" && (
                  <span className="text-[10px] text-amber-500 whitespace-nowrap bg-amber-50 px-1.5 py-0.5 rounded">置信度低</span>
                )}
                <button onClick={() => removeItem(section.key, i)}
                  className="p-1 text-slate-300 hover:text-red-400 transition shrink-0">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {strategyError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600">{strategyError}</div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button onClick={onBack} className="text-sm inline-flex w-full items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition sm:w-auto">
          <ArrowLeft className="h-4 w-4" /> 返回修改资料
        </button>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button onClick={onReExtract} disabled={reExtracting}
            className="text-sm inline-flex w-full items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 disabled:opacity-50 transition sm:w-auto">
            {reExtracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            重新抽取
          </button>
          <button onClick={onGenerate} disabled={generating}
            className="text-sm inline-flex w-full items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#004B73] to-[#0077B6] text-white font-semibold hover:shadow-lg hover:shadow-blue-300/30 disabled:opacity-50 transition-all sm:w-auto">
            {generating ? <><Loader2 className="h-4 w-4 animate-spin" /> 生成中...</> : <><Sparkles className="h-4 w-4" /> 确认并生成策略</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ==================== Step 3: Strategy ====================

function StrategyStep({
  plan, questions, contentCalendar, questionStatus, questionError,
  questionCount, customQuestionCount, questionCustomKeywords, layer2Ratio,
  categoryConfig, onCategoryConfigChange,
  onQuestionCountChange, onCustomQuestionCountChange, onQuestionCustomKeywordsChange, onLayer2RatioChange, onGenerateQuestions,
  onExportJson, onExportMarkdown, onExportWord, onBack,
  hasQuestions,
}: {
  plan: GeoStrategyPlan
  questions: QuestionItem[]
  contentCalendar: ContentCalendarItem[]
  questionStatus: GenerationStatus
  questionError: string
  questionCount: number
  customQuestionCount: number
  questionCustomKeywords: string
  layer2Ratio: number
  categoryConfig: QuestionCategoryConfig
  onCategoryConfigChange: (cfg: QuestionCategoryConfig) => void
  onQuestionCountChange: (v: number) => void
  onCustomQuestionCountChange: (v: number) => void
  onQuestionCustomKeywordsChange: (v: string) => void
  onLayer2RatioChange: (v: number) => void
  onGenerateQuestions: () => void
  onExportJson: () => void
  onExportMarkdown: () => void
  onExportWord: () => void
  onBack: () => void
  hasQuestions: boolean
}) {
  const [showJson, setShowJson] = useState(false)
  const [showCalendar, setShowCalendar] = useState(false)
  const [showQuestionSettings, setShowQuestionSettings] = useState(false)
  const [activePromptKey, setActivePromptKey] = useState<string | null>(null)
  const [copiedPromptKey, setCopiedPromptKey] = useState<string | null>(null)
  const [officialPrompt, setOfficialPrompt] = useState("")
  const [officialPromptLoading, setOfficialPromptLoading] = useState(false)
  const [officialPromptError, setOfficialPromptError] = useState("")

  const handleCopyPrompt = useCallback(async (key: string, prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopiedPromptKey(key)
      window.setTimeout(() => setCopiedPromptKey(current => current === key ? null : current), 1600)
    } catch {
      setCopiedPromptKey(null)
    }
  }, [])

  const handleGenerateOfficialPrompt = useCallback(async () => {
    setOfficialPromptLoading(true)
    setOfficialPromptError("")

    try {
      const res = await apiFetch("/api/geo-strategy/website-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      })
      const data = await readApiJson<{ prompt?: string; model?: string; error?: string }>(
        res,
        "官网 Prompt 生成"
      )

      if (!res.ok || !data.prompt) {
        throw new Error(data.error || "官网 Prompt 生成失败，请稍后重试")
      }

      setOfficialPrompt(data.prompt)
    } catch (error) {
      setOfficialPromptError(error instanceof Error ? error.message : "官网 Prompt 生成失败")
    } finally {
      setOfficialPromptLoading(false)
    }
  }, [plan])

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{plan.project_name || "GEO 优化策略方案"}</h1>
          <p className="text-xs text-slate-500 mt-1">{plan.profile?.industry} · {plan.profile?.audience}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={onBack} className="text-xs inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition">
            <ArrowLeft className="h-3.5 w-3.5" /> 返回
          </button>
          <div className="h-5 w-px bg-slate-200" />
          <button onClick={onExportJson} className="text-xs inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition">
            <Download className="h-3.5 w-3.5" /> JSON
          </button>
          <button onClick={onExportMarkdown} className="text-xs inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition">
            <Download className="h-3.5 w-3.5" /> Markdown
          </button>
          <button onClick={onExportWord} className="text-xs inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition">
            <Download className="h-3.5 w-3.5" /> Word
          </button>
        </div>
      </div>

      {/* Strategy summary */}
      <Card title="策略总览" icon={<Sparkles className="h-4 w-4 text-blue-500" />}>
        <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{plan.summary || "（待生成）"}</p>
      </Card>

      {/* Profile */}
      {plan.profile && (
        <Card title="客户画像" icon={<Search className="h-4 w-4 text-purple-500" />}>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <ProfileField label="品牌/产品" value={plan.profile.brand_or_product} />
            <ProfileField label="行业" value={plan.profile.industry} />
            <ProfileField label="目标受众" value={plan.profile.audience} />
            <ProfileField label="产品说明" value={plan.profile.product_description} className="sm:col-span-2 md:col-span-3" />
            <ProfileField label="商业目标" value={plan.profile.business_goals} className="sm:col-span-2 md:col-span-3" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <TagList title="痛点" items={plan.profile.pain_points} color="rose" />
            <TagList title="优势" items={plan.profile.advantages} color="emerald" />
            <TagList title="劣势" items={plan.profile.weaknesses} color="amber" />
            <TagList title="场景" items={plan.profile.scenes} color="cyan" />
          </div>
        </Card>
      )}

      {/* Keyword Strategy */}
      {plan.keyword_strategy && (
        <Card title="关键词策略" icon={<ListOrdered className="h-4 w-4 text-emerald-500" />}>
          <KeywordTable title="核心关键词" keywords={plan.keyword_strategy.core_keywords} />
          <KeywordTable title="痛点/优势关键词" keywords={plan.keyword_strategy.pain_advantage_keywords} />
          <KeywordTable title="劣势转化关键词" keywords={plan.keyword_strategy.weakness_conversion_keywords} />
          <KeywordTable title="场景需求关键词" keywords={plan.keyword_strategy.scenario_keywords} />
        </Card>
      )}

      {/* Official Site Strategy */}
      {plan.official_site_strategy && plan.official_site_strategy.length > 0 && (
        <Card title="官网建设策略" icon={<Settings className="h-4 w-4 text-indigo-500" />}>
          <div className="mb-4 flex flex-col gap-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-700">完整官网建设 Prompt</div>
              <div className="mt-1 text-xs leading-relaxed text-slate-500">
                通义千问会把下方全部建议合并为一个可直接建站的完整 Prompt，品牌资料由你另外提供。
              </div>
            </div>
            <button
              onClick={handleGenerateOfficialPrompt}
              disabled={officialPromptLoading}
              className="inline-flex w-full shrink-0 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {officialPromptLoading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Sparkles className="h-3.5 w-3.5" />}
              {officialPromptLoading ? "通义千问生成中..." : officialPrompt ? "重新生成完整 Prompt" : "生成完整官网 Prompt"}
            </button>
          </div>

          {officialPromptError && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-600">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{officialPromptError}</span>
            </div>
          )}

          {officialPrompt && (
            <div className="mb-4">
              <WebsitePromptPanel
                promptKey="official-complete"
                prompt={officialPrompt}
                copied={copiedPromptKey === "official-complete"}
                onCopy={handleCopyPrompt}
                title="完整官网建设 Prompt"
              />
            </div>
          )}

          <div className="space-y-3">
            {plan.official_site_strategy.map((item, i) => (
              <div key={i} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <span className="text-[10px] font-bold text-slate-400 w-5 mt-0.5">#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-700">{item.module}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{item.action}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{item.goal}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Third Party Sites */}
      {plan.third_party_site_strategy && plan.third_party_site_strategy.length > 0 && (
        <Card title="第三方网站策略" icon={<GlobeIcon className="h-4 w-4 text-cyan-500" />}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {plan.third_party_site_strategy.map((site, i) => (
              <div key={i} className="border border-slate-200 rounded-xl p-4 bg-white/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-700">
                    {site.site_type}
                  </span>
                  <span className="text-[10px] text-slate-400">P{site.priority}</span>
                </div>
                <div className="text-sm font-semibold text-slate-700 mb-1">{site.suggested_name}</div>
                <div className="text-xs text-slate-500 mb-2">{site.positioning}</div>
                <div className="text-[11px] text-slate-400 mb-1"><span className="font-medium text-slate-500">内容栏目：</span>{site.content_pillars}</div>
                {site.weakness_conversion && (
                  <div className="text-[11px] text-amber-600 mb-1"><span className="font-medium text-amber-700">劣势转优势：</span>{site.weakness_conversion}</div>
                )}
                <div className="text-[11px] text-slate-400"><span className="font-medium text-slate-500">交叉验证：</span>{site.cross_validation_role}</div>
                <button
                  onClick={() => setActivePromptKey(activePromptKey === `third-${i}` ? null : `third-${i}`)}
                  className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50/70 px-3 py-2 text-xs font-medium text-cyan-700 transition hover:bg-cyan-100"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  生成 Prompt
                </button>
                {activePromptKey === `third-${i}` && (
                  <WebsitePromptPanel
                    promptKey={`third-${i}`}
                    prompt={buildThirdPartySitePrompt(plan, site, i)}
                    copied={copiedPromptKey === `third-${i}`}
                    onCopy={handleCopyPrompt}
                  />
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Media Plan */}
      {plan.media_plan && plan.media_plan.length > 0 && (
        <Card title="自媒体发文策略" icon={<FileText className="h-4 w-4 text-orange-500" />}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">平台</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">角色</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">关键词</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">标题示例</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">节奏</th>
                </tr>
              </thead>
              <tbody>
                {plan.media_plan.map((item, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2 px-2 font-medium text-slate-700">{item.platform}</td>
                    <td className="py-2 px-2 text-slate-500">{item.role}</td>
                    <td className="py-2 px-2 text-slate-500 max-w-[200px] truncate">{item.keyword_focus}</td>
                    <td className="py-2 px-2 text-slate-500 max-w-[200px] truncate">{item.sample_title}</td>
                    <td className="py-2 px-2 text-slate-500 whitespace-nowrap">{item.cadence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Monitoring & Roadmap */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {plan.geo_monitoring_plan && plan.geo_monitoring_plan.length > 0 && (
          <Card title="GEO 复盘指标" icon={<RefreshCw className="h-4 w-4 text-rose-500" />}>
            <div className="space-y-2">
              {plan.geo_monitoring_plan.map((item, i) => (
                <div key={i} className="flex flex-col gap-1 text-xs p-2 rounded-lg bg-slate-50 sm:flex-row sm:items-start sm:gap-2">
                  <span className="font-medium text-slate-700 sm:w-24 sm:shrink-0">{item.metric}</span>
                  <span className="text-slate-500 flex-1">{item.method}</span>
                  <span className="text-slate-400 sm:w-16 sm:text-right">{item.target}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {plan.execution_roadmap && plan.execution_roadmap.length > 0 && (
          <Card title="执行排期" icon={<ArrowRight className="h-4 w-4 text-blue-500" />}>
            <div className="space-y-2">
              {plan.execution_roadmap.map((item, i) => (
                <div key={i} className="flex flex-col gap-1 text-xs p-2 rounded-lg bg-slate-50 sm:flex-row sm:items-start sm:gap-2">
                  <span className="font-medium text-slate-700 sm:w-20 sm:shrink-0">{item.phase}</span>
                  <span className="text-slate-500 flex-1">{item.focus}</span>
                  <span className="text-slate-400 sm:max-w-[120px] sm:text-right">{item.deliverable}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Question Module */}
      <Card title="疑问句池" icon={<Search className="h-4 w-4 text-violet-500" />}
        extra={
          hasQuestions ? (
            <button onClick={() => setShowJson(v => !v)} className="text-[10px] text-slate-400 hover:text-slate-600 transition">
              {showJson ? "收起" : "显示全部"} {questions.length} 条
            </button>
          ) : undefined
        }
      >
        {hasQuestions && questionError && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{questionError}</span>
          </div>
        )}
        {!hasQuestions ? (
          <QuestionSettingsPanel
            plan={plan}
            questionCount={questionCount}
            customQuestionCount={customQuestionCount}
            questionCustomKeywords={questionCustomKeywords}
            layer2Ratio={layer2Ratio}
            categoryConfig={categoryConfig}
            questionStatus={questionStatus}
            questionError={questionError}
            onQuestionCountChange={onQuestionCountChange}
            onCustomQuestionCountChange={onCustomQuestionCountChange}
            onQuestionCustomKeywordsChange={onQuestionCustomKeywordsChange}
            onLayer2RatioChange={onLayer2RatioChange}
            onCategoryConfigChange={onCategoryConfigChange}
            onGenerateQuestions={onGenerateQuestions}
          />
        ) : (
          <>
            {/* Show question summary */}
            <div className="text-xs text-slate-500 mb-4">
              共 {questions.length} 条疑问句（第一层: {questions.filter(q => q.layer === "第一层").length} 条, 第二层: {questions.filter(q => q.layer === "第二层").length} 条）
            </div>
            <button
              onClick={() => setShowQuestionSettings(v => !v)}
              className="mb-4 inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50/70 px-3 py-2 text-xs font-medium text-violet-700 transition hover:bg-violet-100"
            >
              <Settings className="h-3.5 w-3.5" />
              {showQuestionSettings ? "收起生成设置" : "调整数量/关键词并重新生成"}
            </button>

            {showQuestionSettings && (
              <div className="mb-4">
                <QuestionSettingsPanel
                  plan={plan}
                  questionCount={questionCount}
                  customQuestionCount={customQuestionCount}
                  questionCustomKeywords={questionCustomKeywords}
                  layer2Ratio={layer2Ratio}
                  categoryConfig={categoryConfig}
                  questionStatus={questionStatus}
                  questionError={questionError}
                  onQuestionCountChange={onQuestionCountChange}
                  onCustomQuestionCountChange={onCustomQuestionCountChange}
                  onQuestionCustomKeywordsChange={onQuestionCustomKeywordsChange}
                  onLayer2RatioChange={onLayer2RatioChange}
                  onCategoryConfigChange={onCategoryConfigChange}
                  onGenerateQuestions={onGenerateQuestions}
                />
              </div>
            )}

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {questions.slice(0, showJson ? questions.length : 10).map(q => (
                <div key={q.id} className="flex items-start gap-2 text-xs p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-[10px] font-mono text-slate-400 w-6 shrink-0 pt-0.5">#{q.id}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-700">{q.question}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${q.layer === "第一层" ? "bg-blue-100 text-blue-600" : "bg-purple-100 text-purple-600"}`}>
                        {q.layer}
                      </span>
                      <span className="text-slate-400">{q.category}</span>
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-400">{q.keyword}</span>
                      <span className="text-slate-300">·</span>
                      <span className="text-slate-400">{q.suggested_channel}</span>
                    </div>
                  </div>
                </div>
              ))}
              {!showJson && questions.length > 10 && (
                <button onClick={() => setShowJson(true)} className="text-xs text-blue-500 hover:text-blue-600">
                  显示全部 {questions.length} 条...
                </button>
              )}
            </div>

            {/* Content Calendar */}
            {contentCalendar.length > 0 && (
              <div className="mt-4">
                <button onClick={() => setShowCalendar(v => !v)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-800 transition">
                  {showCalendar ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  内容日历 ({contentCalendar.length} 项)
                </button>
                {showCalendar && (
                  <div className="mt-3 space-y-2">
                    {contentCalendar.map((item, i) => (
                      <div key={i} className="text-xs p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                        <div className="flex items-center gap-2 text-slate-400 mb-1">
                          <span className="font-medium text-slate-600">{item.week}</span>
                          <span>·</span>
                          <span>{item.platform}</span>
                        </div>
                        <div className="text-slate-700 font-medium">{item.article_title}</div>
                        <div className="text-slate-500 mt-0.5">{item.question}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Card>

      {/* JSON Preview */}
      <details className="bg-white/50 backdrop-blur rounded-2xl border border-slate-200/60 shadow-sm">
        <summary className="px-5 py-3 text-sm font-medium text-slate-500 cursor-pointer hover:text-slate-700 transition select-none">
          JSON 原文预览
        </summary>
        <div className="px-5 pb-4">
          <pre className="text-[11px] leading-relaxed text-slate-600 bg-slate-50 rounded-xl p-4 overflow-x-auto max-h-96 overflow-y-auto">
            {JSON.stringify(plan, null, 2)}
          </pre>
        </div>
      </details>
    </div>
  )
}

// ==================== Question Settings Panel ====================

function QuestionSettingsPanel({
  plan, questionCount, customQuestionCount, questionCustomKeywords, layer2Ratio, categoryConfig,
  questionStatus, questionError,
  onQuestionCountChange, onCustomQuestionCountChange, onQuestionCustomKeywordsChange, onLayer2RatioChange,
  onCategoryConfigChange, onGenerateQuestions,
}: {
  plan: GeoStrategyPlan
  questionCount: number
  customQuestionCount: number
  questionCustomKeywords: string
  layer2Ratio: number
  categoryConfig: QuestionCategoryConfig
  questionStatus: GenerationStatus
  questionError: string
  onQuestionCountChange: (v: number) => void
  onCustomQuestionCountChange: (v: number) => void
  onQuestionCustomKeywordsChange: (v: string) => void
  onLayer2RatioChange: (v: number) => void
  onCategoryConfigChange: (cfg: QuestionCategoryConfig) => void
  onGenerateQuestions: () => void
}) {
  const rawEffectiveCount = questionCount === -1 ? customQuestionCount : questionCount
  const effectiveCount = Math.min(QUESTION_GENERATION_LIMIT, Math.max(10, Math.round(rawEffectiveCount)))
  const weaknesses = plan.profile?.weaknesses || []
  const weaknessTotal = weaknesses.length * categoryConfig.weaknessesPerWeakness
  const remainingForKeywords = Math.max(0, effectiveCount - weaknessTotal)
  const coreMin = Math.ceil(effectiveCount * 0.30)
  const allocationMode = categoryConfig.allocationMode || "ratio"

  // Apply ratios to remaining (keywords portion)
  const ratioCoreAlloc = Math.floor(remainingForKeywords * categoryConfig.coreRatio)
  const ratioSecondaryAlloc = Math.floor(remainingForKeywords * categoryConfig.secondaryRatio)
  const ratioPainScenarioAlloc = remainingForKeywords - ratioCoreAlloc - ratioSecondaryAlloc
  const customCoreAlloc = Math.min(QUESTION_GENERATION_LIMIT, Math.max(0, categoryConfig.coreCount ?? ratioCoreAlloc))
  const customSecondaryAlloc = Math.min(QUESTION_GENERATION_LIMIT, Math.max(0, categoryConfig.secondaryCount ?? ratioSecondaryAlloc))
  const customPainScenarioAlloc = Math.min(QUESTION_GENERATION_LIMIT, Math.max(0, categoryConfig.painScenarioCount ?? ratioPainScenarioAlloc))
  const coreAlloc = allocationMode === "custom" ? customCoreAlloc : ratioCoreAlloc
  const secondaryAlloc = allocationMode === "custom" ? customSecondaryAlloc : ratioSecondaryAlloc
  const painScenarioAlloc = allocationMode === "custom" ? customPainScenarioAlloc : ratioPainScenarioAlloc
  const keywordCustomTotal = customCoreAlloc + customSecondaryAlloc + customPainScenarioAlloc
  const keywordCustomMismatch = allocationMode === "custom" && keywordCustomTotal !== remainingForKeywords

  // Validation
  const weaknessOverflow = weaknessTotal > effectiveCount
  const coreBelowMin = allocationMode !== "custom" && remainingForKeywords > 0 && coreAlloc < coreMin
  const weaknessTooHeavy = weaknessTotal > effectiveCount * 0.5

  const coreKeywords = deriveCoreKeywords(plan)
  const customKeywords = parseQuestionKeywords(questionCustomKeywords)
  const previewKeywords = customKeywords.length > 0 ? customKeywords : coreKeywords
  const usingCustomKeywords = customKeywords.length > 0

  const updateConfig = (patch: Partial<QuestionCategoryConfig>) => {
    const next = { ...categoryConfig, ...patch }
    // Clamp: core 30%-70%, secondary 5%-min(50%, 100%-core-5%)
    next.coreRatio = Math.min(0.70, Math.max(0.30, next.coreRatio))
    const maxSecondary = Math.min(0.50, 1.0 - next.coreRatio - 0.05)
    next.secondaryRatio = Math.min(maxSecondary, Math.max(0.05, next.secondaryRatio))
    next.coreCount = Math.min(QUESTION_GENERATION_LIMIT, Math.max(0, Number(next.coreCount ?? 0) || 0))
    next.secondaryCount = Math.min(QUESTION_GENERATION_LIMIT, Math.max(0, Number(next.secondaryCount ?? 0) || 0))
    next.painScenarioCount = Math.min(QUESTION_GENERATION_LIMIT, Math.max(0, Number(next.painScenarioCount ?? 0) || 0))
    onCategoryConfigChange(next)
  }

  const switchAllocationMode = (mode: "ratio" | "custom") => {
    if (mode === "custom") {
      updateConfig({
        allocationMode: "custom",
        coreCount: ratioCoreAlloc,
        secondaryCount: ratioSecondaryAlloc,
        painScenarioCount: ratioPainScenarioAlloc,
      })
    } else {
      updateConfig({ allocationMode: "ratio" })
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-slate-500">策略已生成，疑问句池可按需生成。</div>

      {/* Basic Settings */}
      <div className="bg-slate-50/80 rounded-xl border border-slate-100 p-4 space-y-3">
        <h3 className="text-xs font-semibold text-slate-600">基本设置</h3>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-[11px] font-medium text-slate-500">疑问句总数</label>
            <select value={questionCount} onChange={e => onQuestionCountChange(Number(e.target.value))}
              className="mt-1 block text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white outline-none">
              <option value={20}>20 条</option>
              <option value={40}>40 条</option>
              <option value={80}>80 条</option>
              <option value={120}>120 条</option>
              <option value={160}>160 条</option>
              <option value={200}>200 条</option>
              <option value={300}>300 条</option>
              <option value={500}>500 条</option>
              <option value={600}>600 条</option>
              <option value={-1}>自定义</option>
            </select>
          </div>
          {questionCount === -1 && (
            <div>
              <label className="text-[11px] font-medium text-slate-500">自定义数量 (最多{QUESTION_GENERATION_LIMIT})</label>
              <input type="number" min={10} max={QUESTION_GENERATION_LIMIT} value={customQuestionCount}
                onChange={e => onCustomQuestionCountChange(Math.min(QUESTION_GENERATION_LIMIT, Math.max(10, Number(e.target.value) || 10)))}
                className="mt-1 block w-24 text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white outline-none" />
            </div>
          )}
          <div>
            <label className="text-[11px] font-medium text-slate-500">第二层比例: {Math.round(layer2Ratio * 100)}%</label>
            <input type="range" min={0.15} max={0.45} step={0.05} value={layer2Ratio}
              onChange={e => onLayer2RatioChange(Number(e.target.value))}
              className="block mt-1 w-28 accent-[#0077B6]" />
            <div className="text-[10px] text-slate-400 mt-0.5">
              第一层 {Math.round(effectiveCount * (1 - layer2Ratio))} 条 · 第二层 {Math.round(effectiveCount * layer2Ratio)} 条
            </div>
          </div>
        </div>
        <div className="text-[10px] text-slate-400">
          超过 {QUESTION_SINGLE_REQUEST_LIMIT} 条会自动拆分为多批短请求生成，避免线上网关中断。
        </div>
      </div>

      <div className="bg-slate-50/80 rounded-xl border border-slate-100 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold text-slate-600">自定义关键词</h3>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
            usingCustomKeywords ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-500"
          }`}>
            {usingCustomKeywords ? `已启用 ${customKeywords.length} 个` : "使用系统推荐"}
          </span>
        </div>
        <textarea
          value={questionCustomKeywords}
          onChange={e => onQuestionCustomKeywordsChange(e.target.value)}
          rows={4}
          placeholder={"每行一个关键词，也可用逗号/顿号分隔\n例如：AI Agent 工具\n企业级智能体\nGEO 优化平台"}
          className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
        <div className="text-[10px] leading-relaxed text-slate-400">
          填写后会优先围绕这些关键词生成疑问句；留空则使用策略中自动提取的关键词。
        </div>
        {previewKeywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {previewKeywords.slice(0, 12).map((kw, i) => (
              <span
                key={`${kw}-${i}`}
                className={`text-[10px] px-2 py-1 rounded-full border ${
                  usingCustomKeywords
                    ? "bg-blue-50 text-blue-600 border-blue-100"
                    : "bg-slate-100 text-slate-500 border-slate-200"
                }`}
              >
                {kw}
              </span>
            ))}
            {previewKeywords.length > 12 && (
              <span className="text-[10px] text-slate-400">+{previewKeywords.length - 12} 更多</span>
            )}
          </div>
        )}
      </div>

      {/* Weakness Spin */}
      {weaknesses.length > 0 && (
        <div className="bg-slate-50/80 rounded-xl border border-slate-100 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-600">劣势积极转化</h3>
            <span className="text-[11px] font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
              小计: {weaknessTotal} 条
            </span>
          </div>
          <p className="text-[10px] text-slate-400">
            每个劣势生成指定数量的问题，从积极角度（数据积累、客户案例、服务经验）构建认知优势。
            硬事实类劣势（如成立时间）无法改变但可重构叙事。
          </p>
          <div>
            <label className="text-[11px] font-medium text-slate-500">每个劣势生成</label>
            <select value={categoryConfig.weaknessesPerWeakness}
              onChange={e => updateConfig({ weaknessesPerWeakness: Number(e.target.value) })}
              className="ml-2 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white outline-none">
              {[5, 8, 10, 12, 15, 20, 25, 30].map(n => (
                <option key={n} value={n}>{n} 个问题</option>
              ))}
            </select>
            <span className="ml-2 text-[11px] text-slate-400">
              × {weaknesses.length} 个劣势
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {weaknesses.map((w, i) => (
              <span key={i} className="text-[10px] px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                {w}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Keyword Category Ratios */}
      <div className="bg-slate-50/80 rounded-xl border border-slate-100 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-xs font-semibold text-slate-600">关键词分类（剩余 {remainingForKeywords} 条）</h3>
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              onClick={() => switchAllocationMode("ratio")}
              className={`text-[11px] px-2.5 py-1 rounded-md transition ${allocationMode === "ratio" ? "bg-[#004B73] text-white" : "text-slate-500 hover:bg-slate-50"}`}
            >
              按比例
            </button>
            <button
              onClick={() => switchAllocationMode("custom")}
              className={`text-[11px] px-2.5 py-1 rounded-md transition ${allocationMode === "custom" ? "bg-[#004B73] text-white" : "text-slate-500 hover:bg-slate-50"}`}
            >
              自定义数量
            </button>
          </div>
        </div>

        {/* Core keywords */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-medium text-slate-500">
              核心关键词（品牌+地域+核心优势，≥30%总量）
            </label>
            <span className="text-[11px] font-semibold text-blue-600">
              {allocationMode === "ratio" ? `${Math.round(categoryConfig.coreRatio * 100)}% → ` : ""}{coreAlloc} 条
            </span>
          </div>
          {allocationMode === "ratio" ? (
            <input type="range" min={0.30} max={0.70} step={0.05} value={categoryConfig.coreRatio}
              onChange={e => updateConfig({ coreRatio: Number(e.target.value) })}
              className="w-full accent-[#0077B6]" />
          ) : (
            <input type="number" min={0} max={QUESTION_GENERATION_LIMIT} value={customCoreAlloc}
              onChange={e => updateConfig({ coreCount: Number(e.target.value) })}
              className="w-28 text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white outline-none focus:border-blue-400 transition" />
          )}
          {previewKeywords.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {previewKeywords.slice(0, 6).map((kw, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">{kw}</span>
              ))}
              {previewKeywords.length > 6 && <span className="text-[10px] text-slate-400">+{previewKeywords.length - 6} 更多</span>}
            </div>
          )}
        </div>

        {/* Secondary keywords */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-medium text-slate-500">次关键词</label>
            <span className="text-[11px] font-semibold text-purple-600">
              {allocationMode === "ratio" ? `${Math.round(categoryConfig.secondaryRatio * 100)}% → ` : ""}{secondaryAlloc} 条
            </span>
          </div>
          {allocationMode === "ratio" ? (
            <input type="range" min={0.05} max={Math.min(0.50, 1.0 - categoryConfig.coreRatio - 0.05)} step={0.05}
              value={categoryConfig.secondaryRatio}
              onChange={e => updateConfig({ secondaryRatio: Number(e.target.value) })}
              className="w-full accent-[#7c3aed]" />
          ) : (
            <input type="number" min={0} max={QUESTION_GENERATION_LIMIT} value={customSecondaryAlloc}
              onChange={e => updateConfig({ secondaryCount: Number(e.target.value) })}
              className="w-28 text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white outline-none focus:border-purple-400 transition" />
          )}
        </div>

        {/* Pain/Scenario */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-medium text-slate-400">
              痛点/场景关键词{allocationMode === "ratio" ? "（自动计算）" : ""}
            </label>
            <span className="text-[11px] text-slate-400">
              {allocationMode === "ratio" ? `${Math.round((1.0 - categoryConfig.coreRatio - categoryConfig.secondaryRatio) * 100)}% → ` : ""}{painScenarioAlloc} 条
            </span>
          </div>
          {allocationMode === "ratio" ? (
            <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-emerald-500 rounded-full"
                style={{ width: "100%" }} />
            </div>
          ) : (
            <input type="number" min={0} max={QUESTION_GENERATION_LIMIT} value={customPainScenarioAlloc}
              onChange={e => updateConfig({ painScenarioCount: Number(e.target.value) })}
              className="w-28 text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white outline-none focus:border-emerald-400 transition" />
          )}
        </div>

        {keywordCustomMismatch && (
          <div className="flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-700">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            自定义关键词数量合计 {keywordCustomTotal} 条，需要等于剩余关键词数量 {remainingForKeywords} 条。
          </div>
        )}
      </div>

      {/* Preview */}
      <div className="bg-slate-50/80 rounded-xl border border-slate-100 p-4 space-y-2">
        <h3 className="text-xs font-semibold text-slate-600">分配预览</h3>
        <div className="space-y-1 text-[11px]">
          {weaknesses.length > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-500">劣势转化</span>
              <span className="font-medium text-slate-700">{weaknessTotal} 条 ({weaknessTotal > 0 ? Math.round(weaknessTotal / effectiveCount * 100) : 0}%)</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-slate-500">核心关键词</span>
            <span className="font-medium text-slate-700">{coreAlloc} 条 ({remainingForKeywords > 0 ? Math.round(coreAlloc / effectiveCount * 100) : 0}%)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">次关键词</span>
            <span className="font-medium text-slate-700">{secondaryAlloc} 条 ({remainingForKeywords > 0 ? Math.round(secondaryAlloc / effectiveCount * 100) : 0}%)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">痛点/场景</span>
            <span className="font-medium text-slate-700">{painScenarioAlloc} 条 ({remainingForKeywords > 0 ? Math.round(painScenarioAlloc / effectiveCount * 100) : 0}%)</span>
          </div>
          <div className="border-t border-slate-200 pt-1.5 flex justify-between">
            <span className="font-medium text-slate-600">总计</span>
            <span className={`font-bold ${weaknessTotal + coreAlloc + secondaryAlloc + painScenarioAlloc !== effectiveCount ? "text-red-600" : "text-slate-800"}`}>
              {weaknessTotal + coreAlloc + secondaryAlloc + painScenarioAlloc} 条
            </span>
          </div>
        </div>

        {/* Warnings */}
        {weaknessOverflow && (
          <div className="flex items-start gap-1.5 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[11px] text-red-600">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            劣势转化问题 ({weaknessTotal}条) 超过总问题数 ({effectiveCount}条)，请减少每个劣势的问题数或增加总数。
          </div>
        )}
        {!weaknessOverflow && coreBelowMin && (
          <div className="flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-700">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            核心关键词 ({coreAlloc}条) 低于总量的30% ({coreMin}条)，请调整比例或减少劣势问题数。
          </div>
        )}
        {!weaknessOverflow && weaknessTooHeavy && (
          <div className="flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-600">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            劣势转化问题超过总数的一半，其他类别空间有限。
          </div>
        )}
      </div>

      {questionError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          {questionError}
        </div>
      )}

      <button onClick={onGenerateQuestions}
        disabled={questionStatus === "generating" || weaknessOverflow || keywordCustomMismatch}
        className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white hover:shadow-lg hover:shadow-violet-300/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
        {questionStatus === "generating" ? <><Loader2 className="h-4 w-4 animate-spin" /> 生成中...</> : <><Sparkles className="h-4 w-4" /> 生成疑问句池</>}
      </button>
    </div>
  )
}

function WebsitePromptPanel({
  promptKey,
  prompt,
  copied,
  onCopy,
  title = "可复制建站 Prompt",
}: {
  promptKey: string
  prompt: string
  copied: boolean
  onCopy: (key: string, prompt: string) => void
  title?: string
}) {
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs font-medium text-slate-700">{title}</div>
        <button
          onClick={() => onCopy(promptKey, prompt)}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100 sm:w-auto"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "已复制" : "复制 Prompt"}
        </button>
      </div>
      <textarea
        readOnly
        value={prompt}
        className="h-72 w-full resize-y rounded-lg border border-slate-200 bg-slate-50/70 p-3 font-mono text-[11px] leading-relaxed text-slate-700 outline-none focus:border-blue-300"
      />
    </div>
  )
}

function buildThirdPartySitePrompt(plan: GeoStrategyPlan, site: ThirdPartySite, index: number): string {
  const profile = plan.profile
  const brand = profile?.brand_or_product || plan.project_name || "目标品牌"
  return [
    `你是一位资深全栈工程师、UI 设计师和中国国内 GEO 生成式引擎优化专家。请根据下面资料包，分批帮我搭建一个可直接上线的第三方验证网站。`,
    ``,
    `【任务 1：建站】`,
    `帮我做一个 ${site.site_type || "第三方验证"} 样式的网站，网站名称为「${site.suggested_name || `${brand}第三方验证站`}」。`,
    `网站定位：${site.positioning || "对目标品牌的优势信息、行业排名、口碑案例、竞品对比做交叉信息验证"}`,
    `这个第三方网站不是普通自媒体页面，它的核心用途是对目标品牌「${brand}」的优势信息、排名信息、案例信息、用户口碑和竞品对比结论做交叉信息验证，让 AI 在抓取多个来源时能形成一致事实。`,
    ``,
    `【任务 2：GEO 方法论实现】`,
    `根据我给你的资料包，整个网站代码要用 GEO 生成式引擎优化的方法论，包括但不限于 schema 结构、内容上用 EEAT 框架和倒金字塔结构，H1/H2 标题的设计、Q&A 的设计。`,
    `请重点设计第三方视角的证据链：评测标准、对比榜单、优势验证、案例摘录、FAQ、数据来源说明、免责声明、About 页面。`,
    ``,
    `【任务 3：自查与抓取文件】`,
    `根据对中国国内 GEO 生成式引擎优化的方法论的极致运用，自查一下网站代码和内容排版上有没有不够好的地方，如果有的话请修改，没有的话就说没有。`,
    `同时给我一份用来提高网站被 AI 抓取效率的 llms.txt 和 robots.txt，并说明它们应该放在哪个路径。`,
    ``,
    `【第三方网站策略】`,
    `站点类型：${site.site_type || "第三方验证站"}`,
    `建议名称：${site.suggested_name || ""}`,
    `内容栏目：${site.content_pillars || ""}`,
    site.weakness_conversion ? `劣势转优势：${site.weakness_conversion}` : `劣势转优势：请基于资料包自行识别可被转化的劣势并设计证据链。`,
    `交叉验证角色：${site.cross_validation_role || "验证目标品牌优势、排名和可信证据"}`,
    ``,
    `【资料包】`,
    buildProfilePack(plan, index + 1),
    ``,
    `【输出要求】`,
    `1. 先给完整网站代码和文件结构。`,
    `2. 再给 GEO 自查结论和已修改点。`,
    `3. 最后单独输出 llms.txt 和 robots.txt 的完整内容。`,
  ].join("\n")
}

function buildProfilePack(plan: GeoStrategyPlan, siteIndex: number): string {
  const p = plan.profile
  const keywords = [
    ...(plan.keyword_strategy?.core_keywords || []),
    ...(plan.keyword_strategy?.pain_advantage_keywords || []),
    ...(plan.keyword_strategy?.weakness_conversion_keywords || []),
    ...(plan.keyword_strategy?.scenario_keywords || []),
  ].slice(0, 24)

  return [
    `项目名称：${plan.project_name || ""}`,
    `品牌/产品：${p?.brand_or_product || ""}`,
    `行业：${p?.industry || ""}`,
    `目标受众：${p?.audience || ""}`,
    `产品说明：${p?.product_description || ""}`,
    `商业目标：${p?.business_goals || ""}`,
    `竞品：${formatList(p?.competitors)}`,
    `核心术语：${formatList(p?.terms)}`,
    `痛点：${formatList(p?.pain_points)}`,
    `优势：${formatList(p?.advantages)}`,
    `劣势：${formatList(p?.weaknesses)}`,
    `场景：${formatList(p?.scenes)}`,
    `关键词：${keywords.map(kw => `${kw.keyword}(${kw.logic})`).join("；")}`,
    `策略摘要：${plan.summary || ""}`,
    `当前建站建议序号：${siteIndex}`,
  ].join("\n")
}

function formatList(items?: string[]): string {
  return items?.filter(Boolean).join("、") || ""
}

// ==================== Utility Components ====================

function Card({ title, icon, children, extra }: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  extra?: React.ReactNode
}) {
  return (
    <div className="bg-white/70 backdrop-blur rounded-2xl border border-slate-200/60 p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">{icon}{title}</h2>
        {extra}
      </div>
      {children}
    </div>
  )
}

function ProfileField({ label, value, className }: { label: string; value?: string; className?: string }) {
  if (!value) return null
  return (
    <div className={className}>
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="text-sm text-slate-700 mt-0.5">{value}</div>
    </div>
  )
}

function TagList({ title, items, color }: { title: string; items: string[]; color: string }) {
  const colors: Record<string, string> = {
    rose: "bg-rose-50 text-rose-600 border-rose-200",
    emerald: "bg-emerald-50 text-emerald-600 border-emerald-200",
    amber: "bg-amber-50 text-amber-600 border-amber-200",
    cyan: "bg-cyan-50 text-cyan-600 border-cyan-200",
  }
  if (!items || items.length === 0) return null
  return (
    <div>
      <div className="text-[11px] text-slate-400 mb-1.5">{title}</div>
      <div className="flex flex-wrap gap-1">
        {items.map((item, i) => (
          <span key={i} className={`text-[11px] px-2 py-0.5 rounded-full border ${colors[color] || colors.emerald}`}>
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

function KeywordTable({ title, keywords }: { title: string; keywords: { priority: string; keyword: string; logic: string }[] }) {
  if (!keywords || keywords.length === 0) return null
  return (
    <div className="mb-4 last:mb-0">
      <h3 className="text-xs font-medium text-slate-600 mb-2">{title}</h3>
      <div className="space-y-1.5">
        {keywords.map((kw, i) => (
          <div key={i} className="flex flex-col gap-1.5 text-xs p-2 rounded-lg bg-slate-50 sm:flex-row sm:items-start sm:gap-2">
            <span className="text-[10px] font-mono text-slate-400 w-4 shrink-0">P{kw.priority}</span>
            <span className="font-medium text-slate-700 sm:w-48 sm:shrink-0">{kw.keyword}</span>
            <span className="text-slate-500">{kw.logic}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ==================== Export: Markdown ====================

function generateMarkdown(
  plan: GeoStrategyPlan,
  questions: QuestionItem[],
  calendar: ContentCalendarItem[]
): string {
  const lines: string[] = []
  lines.push(`# ${plan.project_name || "GEO 优化策略方案"}`)
  lines.push(``)
  if (plan.summary) lines.push(...buildSection("策略总览", plan.summary))
  if (plan.profile) {
    lines.push(`## 客户画像`)
    lines.push(``)
    const p = plan.profile
    if (p.brand_or_product) lines.push(`- **品牌/产品**：${p.brand_or_product}`)
    if (p.industry) lines.push(`- **行业**：${p.industry}`)
    if (p.audience) lines.push(`- **目标受众**：${p.audience}`)
    if (p.product_description) lines.push(`- **产品说明**：${p.product_description}`)
    if (p.business_goals) lines.push(`- **商业目标**：${p.business_goals}`)
    lines.push(``)
    for (const [label, items] of [["痛点", p.pain_points], ["优势", p.advantages], ["劣势", p.weaknesses], ["场景", p.scenes]] as const) {
      if (items.length) lines.push(`- **${label}**：${items.join("、")}`)
    }
    lines.push(``)
  }
  if (plan.keyword_strategy) {
    lines.push(`## 关键词策略`)
    lines.push(``)
    for (const [label, kws] of [["核心关键词", plan.keyword_strategy.core_keywords], ["痛点/优势关键词", plan.keyword_strategy.pain_advantage_keywords], ["劣势转化关键词", plan.keyword_strategy.weakness_conversion_keywords], ["场景需求关键词", plan.keyword_strategy.scenario_keywords]] as const) {
      if (kws.length) {
        lines.push(`### ${label}`)
        kws.forEach(kw => lines.push(`- P${kw.priority} **${kw.keyword}**：${kw.logic}`))
        lines.push(``)
      }
    }
  }
  if (plan.official_site_strategy?.length) {
    lines.push(`## 官网建设策略`)
    lines.push(``)
    plan.official_site_strategy.forEach((s, i) => {
      lines.push(`### ${i + 1}. ${s.module}`)
      lines.push(`- **建设动作**：${s.action}`)
      lines.push(`- **目标**：${s.goal}`)
      lines.push(``)
    })
  }
  if (plan.third_party_site_strategy?.length) {
    lines.push(`## 第三方网站策略`)
    lines.push(``)
    plan.third_party_site_strategy.forEach(s => {
      lines.push(`### ${s.suggested_name}`)
      lines.push(`- **类型**：${s.site_type}`)
      lines.push(`- **定位**：${s.positioning}`)
      lines.push(`- **内容栏目**：${s.content_pillars}`)
      if (s.weakness_conversion) lines.push(`- **劣势转优势**：${s.weakness_conversion}`)
      lines.push(`- **交叉验证**：${s.cross_validation_role}`)
      lines.push(``)
    })
  }
  if (plan.media_plan?.length) {
    lines.push(`## 自媒体发文策略`)
    lines.push(``)
    lines.push(`| 平台 | 角色 | 关键词 | 标题示例 | 节奏 |`)
    lines.push(`|------|------|--------|----------|------|`)
    plan.media_plan.forEach(m => lines.push(`| ${m.platform} | ${m.role} | ${m.keyword_focus} | ${m.sample_title} | ${m.cadence} |`))
    lines.push(``)
  }
  if (questions.length) {
    lines.push(`## 疑问句池`)
    lines.push(``)
    questions.forEach(q => lines.push(`- [#${q.id}] [${q.layer}] ${q.question}（${q.category} · ${q.keyword}）`))
    lines.push(``)
  }
  if (calendar.length) {
    lines.push(`## 内容日历`)
    lines.push(``)
    lines.push(`| 周次 | 平台 | 标题 | 类型 |`)
    lines.push(`|------|------|------|------|`)
    calendar.forEach(c => lines.push(`| ${c.week} | ${c.platform} | ${c.article_title} | ${c.content_type} |`))
    lines.push(``)
  }
  return lines.join("\n")
}

function buildSection(title: string, content: string): string[] {
  return [`## ${title}`, ``, content, ``]
}

// ==================== Export: Word HTML ====================

function generateWordHtml(
  plan: GeoStrategyPlan,
  questions: QuestionItem[],
  calendar: ContentCalendarItem[]
): string {
  const h = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const parts: string[] = [
    `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>`,
    `<head><meta charset="utf-8"><title>${h(plan.project_name)}</title>`,
    `<style>body{font-family:'微软雅黑',sans-serif;font-size:12pt;color:#1e293b;line-height:1.6;margin:2cm}h1{font-size:22pt;color:#004B73;border-bottom:2px solid #004B73;padding-bottom:8px}h2{font-size:16pt;color:#004B73;margin-top:24px}h3{font-size:13pt;color:#475569;margin-top:16px}table{border-collapse:collapse;width:100%;margin:12px 0;font-size:10pt}td,th{border:1px solid #cbd5e1;padding:6px 10px;text-align:left}th{background:#f1f5f9;color:#475569;font-weight:600}tr:nth-child(even){background:#f8fafc}.tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:9pt;margin:2px}ul{list-style:none;padding:0}li{padding:4px 0}</style></head><body>`,
    `<h1>${h(plan.project_name || "GEO 优化策略方案")}</h1>`,
  ]

  if (plan.summary) {
    parts.push(`<h2>策略总览</h2><p>${h(plan.summary)}</p>`)
  }

  if (plan.profile) {
    const p = plan.profile
    parts.push(`<h2>客户画像</h2><table>`)
    if (p.brand_or_product) parts.push(`<tr><td width="120"><b>品牌/产品</b></td><td>${h(p.brand_or_product)}</td></tr>`)
    if (p.industry) parts.push(`<tr><td><b>行业</b></td><td>${h(p.industry)}</td></tr>`)
    if (p.audience) parts.push(`<tr><td><b>目标受众</b></td><td>${h(p.audience)}</td></tr>`)
    if (p.product_description) parts.push(`<tr><td><b>产品说明</b></td><td>${h(p.product_description)}</td></tr>`)
    if (p.business_goals) parts.push(`<tr><td><b>商业目标</b></td><td>${h(p.business_goals)}</td></tr>`)
    if (p.competitors?.length) parts.push(`<tr><td><b>竞品</b></td><td>${h(p.competitors.join("、"))}</td></tr>`)
    for (const [label, items] of [["痛点", p.pain_points], ["优势", p.advantages], ["劣势", p.weaknesses], ["场景", p.scenes]] as const) {
      if (items.length) parts.push(`<tr><td><b>${label}</b></td><td>${items.map(i => `<span class="tag" style="background:#f1f5f9;border:1px solid #e2e8f0;padding:2px 6px;margin:2px;border-radius:4px">${h(i)}</span>`).join(" ")}</td></tr>`)
    }
    parts.push(`</table>`)
  }

  // Keyword strategy
  if (plan.keyword_strategy) {
    parts.push(`<h2>关键词策略</h2>`)
    for (const [title, kws] of [["核心关键词", plan.keyword_strategy.core_keywords], ["痛点/优势关键词", plan.keyword_strategy.pain_advantage_keywords], ["劣势转化关键词", plan.keyword_strategy.weakness_conversion_keywords], ["场景需求关键词", plan.keyword_strategy.scenario_keywords]] as const) {
      if (kws.length) {
        parts.push(`<h3>${title}</h3><table><tr><th>优先级</th><th>关键词</th><th>逻辑</th></tr>`)
        kws.forEach(kw => parts.push(`<tr><td>P${h(kw.priority)}</td><td>${h(kw.keyword)}</td><td>${h(kw.logic)}</td></tr>`))
        parts.push(`</table>`)
      }
    }
  }

  // Official site
  if (plan.official_site_strategy?.length) {
    parts.push(`<h2>官网建设策略</h2><table><tr><th>模块</th><th>建设动作</th><th>目标</th></tr>`)
    plan.official_site_strategy.forEach(s => {
      parts.push(`<tr><td>${h(s.module)}</td><td>${h(s.action)}</td><td>${h(s.goal)}</td></tr>`)
    })
    parts.push(`</table>`)
  }

  // Third party sites
  if (plan.third_party_site_strategy?.length) {
    parts.push(`<h2>第三方网站策略</h2>`)
    plan.third_party_site_strategy.forEach(s => {
      parts.push(`<h3>${h(s.suggested_name)}</h3><table><tr><td width="100"><b>类型</b></td><td>${h(s.site_type)}</td></tr><tr><td><b>定位</b></td><td>${h(s.positioning)}</td></tr><tr><td><b>内容栏目</b></td><td>${h(s.content_pillars)}</td></tr>${s.weakness_conversion ? `<tr><td><b>劣势转优势</b></td><td>${h(s.weakness_conversion)}</td></tr>` : ""}<tr><td><b>交叉验证</b></td><td>${h(s.cross_validation_role)}</td></tr></table>`)
    })
  }

  // Media plan
  if (plan.media_plan?.length) {
    parts.push(`<h2>自媒体发文策略</h2><table><tr><th>平台</th><th>角色</th><th>关键词</th><th>标题示例</th><th>节奏</th></tr>`)
    plan.media_plan.forEach(m => parts.push(`<tr><td>${h(m.platform)}</td><td>${h(m.role)}</td><td>${h(m.keyword_focus)}</td><td>${h(m.sample_title)}</td><td>${h(m.cadence)}</td></tr>`))
    parts.push(`</table>`)
  }

  // Questions
  if (questions.length) {
    parts.push(`<h2>疑问句池</h2><table><tr><th>#</th><th>层级</th><th>问题</th><th>分类</th><th>关键词</th><th>推荐渠道</th></tr>`)
    questions.forEach(q => parts.push(`<tr><td>${h(q.id)}</td><td>${q.layer === "第一层" ? "第一层" : "第二层"}</td><td>${h(q.question)}</td><td>${h(q.category)}</td><td>${h(q.keyword)}</td><td>${h(q.suggested_channel)}</td></tr>`))
    parts.push(`</table>`)
  }

  // Calendar
  if (calendar.length) {
    parts.push(`<h2>内容日历</h2><table><tr><th>周次</th><th>平台</th><th>标题</th><th>类型</th></tr>`)
    calendar.forEach(c => parts.push(`<tr><td>${h(c.week)}</td><td>${h(c.platform)}</td><td>${h(c.article_title)}</td><td>${h(c.content_type)}</td></tr>`))
    parts.push(`</table>`)
  }

  // Execution roadmap
  if (plan.execution_roadmap?.length) {
    parts.push(`<h2>执行排期</h2><table><tr><th>阶段</th><th>重点</th><th>交付物</th></tr>`)
    plan.execution_roadmap.forEach(e => parts.push(`<tr><td>${h(e.phase)}</td><td>${h(e.focus)}</td><td>${h(e.deliverable)}</td></tr>`))
    parts.push(`</table>`)
  }

  // Geo monitoring
  if (plan.geo_monitoring_plan?.length) {
    parts.push(`<h2>GEO 复盘指标</h2><table><tr><th>指标</th><th>方法</th><th>目标</th></tr>`)
    plan.geo_monitoring_plan.forEach(g => parts.push(`<tr><td>${h(g.metric)}</td><td>${h(g.method)}</td><td>${h(g.target)}</td></tr>`))
    parts.push(`</table>`)
  }

  parts.push(`<p style="color:#94a3b8;font-size:9pt;margin-top:40px">Generated by 势途 GEO · ${new Date().toLocaleDateString("zh-CN")}</p>`)
  parts.push(`</body></html>`)
  return parts.join("\n")
}
