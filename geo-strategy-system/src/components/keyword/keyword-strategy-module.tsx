"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import {
  DEFAULT_CATEGORY_CONFIG,
  DEFAULT_QUESTION_MODEL_PROVIDER,
  QUESTION_MODEL_OPTIONS,
  QUESTION_MODEL_OPTIONS_LAST_VERIFIED,
  QUESTION_MODEL_PROVIDER_LABELS,
  getDefaultQuestionModel,
  normalizeQuestionModel,
  normalizeQuestionModelProvider,
  type ExtractedProfile,
  type ExtractedItem,
  type GeoStrategyPlan,
  type ToolStep,
  type GenerationStatus,
  type UploadedFile,
  type QuestionItem,
  type QuestionCategoryConfig,
  type ThirdPartySite,
  type QuestionJobProgress,
  type QuestionJobRecord,
  type QuestionModelProvider,
} from "@/types/geo-strategy"
import type { Client } from "@/types"
import { ArrowLeft, ArrowRight, Check, CloudUpload, Copy, Download, FileText, Loader2, Plus, RefreshCw, Settings, Trash2, X, Sparkles, Search, Eye, EyeOff, ListOrdered, AlertCircle } from "lucide-react"
import type { AiProviderPublicSetting } from "@/types/ai-settings"
import { apiFetch, readApiJson } from "@/lib/api-fetch"

// ==================== Brand Data ====================

const QUESTION_GENERATION_LIMIT = 600

function clampQuestionCount(value: unknown, fallback = 40, allowCustomMarker = false): number {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  if (numeric === -1) return allowCustomMarker ? -1 : fallback
  return Math.min(QUESTION_GENERATION_LIMIT, Math.max(10, Math.round(numeric)))
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
  questionJobId?: string
  questionJobProgress?: QuestionJobProgress
  questionCount: number
  customQuestionCount: number
  questionModelProvider: QuestionModelProvider
  questionModel: string
  questionCustomKeywords: string
  questionCustomPainScenarios: string
  layer2Ratio: number
  categoryConfig: QuestionCategoryConfig
  questions: QuestionItem[]
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
    questionJobId: undefined,
    questionJobProgress: undefined,
    questionCount: 40,
    customQuestionCount: 120,
    questionModelProvider: DEFAULT_QUESTION_MODEL_PROVIDER,
    questionModel: getDefaultQuestionModel(DEFAULT_QUESTION_MODEL_PROVIDER),
    questionCustomKeywords: "",
    questionCustomPainScenarios: "",
    layer2Ratio: 0.35,
    categoryConfig: DEFAULT_CATEGORY_CONFIG,
    questions: [],
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

  const questionModelProvider = normalizeQuestionModelProvider(saved.questionModelProvider)

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
    questionModelProvider,
    questionModel: normalizeQuestionModel(questionModelProvider, saved.questionModel),
    questionCustomKeywords: typeof saved.questionCustomKeywords === "string" ? saved.questionCustomKeywords : "",
    questionCustomPainScenarios: typeof saved.questionCustomPainScenarios === "string" ? saved.questionCustomPainScenarios : "",
    questionJobId: typeof saved.questionJobId === "string" ? saved.questionJobId : undefined,
    questionJobProgress: saved.questionJobProgress,
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

type QuestionSectionKey = "keyword" | "weakness" | "painScenario"

interface QuestionSectionPlan {
  counts: Record<QuestionSectionKey, number>
  totalCount: number
}

const SECTION_WEIGHTS: Record<QuestionSectionKey, number> = {
  keyword: 0.45,
  weakness: 0.30,
  painScenario: 0.25,
}

function clampQuestionSectionCount(value: unknown, fallback = 0): number {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(QUESTION_GENERATION_LIMIT, Math.max(0, Math.round(numeric)))
}

function effectiveQuestionBaseCount(questionCount: number, customQuestionCount: number): number {
  const requestedCount = questionCount === -1 ? customQuestionCount : questionCount
  return Math.min(QUESTION_GENERATION_LIMIT, Math.max(10, Math.round(requestedCount)))
}

function derivePainScenarioTerms(plan: GeoStrategyPlan): string[] {
  const terms = new Set<string>()
  for (const item of [
    ...(plan.profile?.pain_points || []),
    ...(plan.profile?.scenes || []),
    ...(plan.keyword_strategy?.pain_advantage_keywords || []).map(keyword => keyword.keyword),
    ...(plan.keyword_strategy?.scenario_keywords || []).map(keyword => keyword.keyword),
  ]) {
    const term = item?.trim()
    if (term) terms.add(term)
  }
  return Array.from(terms)
}

function calculateQuestionSectionPlan(
  plan: GeoStrategyPlan,
  categoryConfig: QuestionCategoryConfig,
  baseCount: number,
): QuestionSectionPlan {
  const weaknesses = plan.profile?.weaknesses || []
  const enabled: Record<QuestionSectionKey, boolean> = {
    keyword: categoryConfig.keywordEnabled !== false,
    weakness: categoryConfig.weaknessEnabled !== false && weaknesses.length > 0,
    painScenario: categoryConfig.painScenarioEnabled !== false,
  }
  const countModes: Record<QuestionSectionKey, "system" | "custom"> = {
    keyword: categoryConfig.keywordCountMode || "system",
    weakness: categoryConfig.weaknessCountMode || "system",
    painScenario: categoryConfig.painScenarioCountMode || "system",
  }
  const customCounts: Record<QuestionSectionKey, number> = {
    keyword: clampQuestionSectionCount(categoryConfig.keywordCount, 20),
    weakness: clampQuestionSectionCount(categoryConfig.weaknessCount, Math.max(10, weaknesses.length * categoryConfig.weaknessesPerWeakness)),
    painScenario: clampQuestionSectionCount(categoryConfig.painScenarioCount, 10),
  }
  const counts: Record<QuestionSectionKey, number> = {
    keyword: 0,
    weakness: 0,
    painScenario: 0,
  }

  const systemSections: QuestionSectionKey[] = []
  for (const section of Object.keys(enabled) as QuestionSectionKey[]) {
    if (!enabled[section]) continue
    if (countModes[section] === "custom") {
      counts[section] = customCounts[section]
    } else {
      systemSections.push(section)
    }
  }

  const remaining = Math.max(0, baseCount - Object.values(counts).reduce((sum, count) => sum + count, 0))
  const caps: Partial<Record<QuestionSectionKey, number>> = {
    weakness: weaknesses.length * categoryConfig.weaknessesPerWeakness,
  }
  const weightTotal = systemSections.reduce((sum, section) => sum + SECTION_WEIGHTS[section], 0)
  let assigned = 0

  systemSections.forEach((section, index) => {
    const isLast = index === systemSections.length - 1
    const raw = isLast
      ? remaining - assigned
      : Math.floor(remaining * (SECTION_WEIGHTS[section] / Math.max(0.01, weightTotal)))
    const cap = caps[section]
    const nextCount = typeof cap === "number" ? Math.min(raw, cap) : raw
    counts[section] = Math.max(0, nextCount)
    assigned += counts[section]
  })

  let leftover = Math.max(0, remaining - assigned)
  while (leftover > 0) {
    const target = systemSections.find(section => {
      const cap = caps[section]
      return typeof cap !== "number" || counts[section] < cap
    })
    if (!target) break
    counts[target] += 1
    leftover -= 1
  }

  return {
    counts,
    totalCount: counts.keyword + counts.weakness + counts.painScenario,
  }
}

function questionJobProgressFromRecord(job: QuestionJobRecord): QuestionJobProgress {
  return {
    completedCount: job.completedCount,
    totalCount: job.totalCount,
    currentBatch: job.currentBatch,
    totalBatches: job.totalBatches,
  }
}

function isStoppedQuestionMessage(message: string): boolean {
  return message.startsWith("已停止生成")
}

function isNonBlockingQuestionMessage(message: string): boolean {
  return isStoppedQuestionMessage(message) || message.startsWith("后台任务仍在生成")
}

function isFatalQuestionPollError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /不存在|已过期|Unauthorized|HTTP 401|HTTP 403|无权限/i.test(message)
}

function isRecoverableQuestionPollError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /等待时间过长|处理时间过长|网关|超时|timeout|timed out|网络请求未完成|服务响应超时|fetch|network/i.test(message)
}

function waitForQuestionPoll(signal: AbortSignal, delayMs = 2000): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve()
      return
    }

    const timeout = window.setTimeout(resolve, delayMs)
    signal.addEventListener("abort", () => {
      window.clearTimeout(timeout)
      resolve()
    }, { once: true })
  })
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
  const [questionPollRetryKey, setQuestionPollRetryKey] = useState(0)
  const mountedRef = useRef(true)
  const questionRunIdRef = useRef(0)
  const questionAbortRef = useRef<AbortController | null>(null)
  const questionJobCreatingRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      questionRunIdRef.current += 1
      questionAbortRef.current?.abort()
      questionAbortRef.current = null
      questionJobCreatingRef.current = false
    }
  }, [])

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
  const [questionProviderSettings, setQuestionProviderSettings] = useState<Partial<Record<QuestionModelProvider, AiProviderPublicSetting>>>({})

  useEffect(() => {
    let cancelled = false
    fetch("/api/geo-strategy/settings", { cache: "no-store" })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled) return
        const setting = data?.keywordStrategy
        if (setting) setKeywordModelSetting(setting as AiProviderPublicSetting)
        const providers = data?.questionProviders || {}
        setQuestionProviderSettings({
          qwen: providers.qwen as AiProviderPublicSetting | undefined,
          doubao: providers.doubao as AiProviderPublicSetting | undefined,
        })
      })
      .catch(() => {
        if (!cancelled) {
          setKeywordModelSetting(null)
          setQuestionProviderSettings({})
        }
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
    const selectedQuestionSetting = questionProviderSettings[activeBrand.questionModelProvider]
    if (selectedQuestionSetting && !selectedQuestionSetting.hasApiKey) {
      updateBrand({
        questionError: `后台未配置${QUESTION_MODEL_PROVIDER_LABELS[activeBrand.questionModelProvider]} API Key，请联系管理员在后台管理页配置。`,
        questionStatus: "error",
      })
      return
    }

    const baseCount = effectiveQuestionBaseCount(activeBrand.questionCount, activeBrand.customQuestionCount)
    const sectionPlan = calculateQuestionSectionPlan(strategyPlan, activeBrand.categoryConfig, baseCount)
    const effectiveCount = sectionPlan.totalCount

    if (effectiveCount <= 0) {
      updateBrand({
        questionError: "请至少选择一个生成部分，并设置大于 0 的生成数量。",
        questionStatus: "error",
      })
      return
    }

    if (effectiveCount > QUESTION_GENERATION_LIMIT) {
      updateBrand({
        questionError: `本次合计 ${effectiveCount} 条，超过单次上限 ${QUESTION_GENERATION_LIMIT} 条，请减少某个部分的数量。`,
        questionStatus: "error",
      })
      return
    }

    const customQuestionKeywords = parseQuestionKeywords(activeBrand.questionCustomKeywords)
    const keywordSource = activeBrand.categoryConfig.keywordSource || "system"
    const coreKeywords = keywordSource === "custom"
      ? customQuestionKeywords
      : deriveCoreKeywords(strategyPlan)
    const customPainScenarios = parseQuestionKeywords(activeBrand.questionCustomPainScenarios)
    const painScenarioSource = activeBrand.categoryConfig.painScenarioSource || "system"
    const painScenarioKeywords = painScenarioSource === "custom"
      ? customPainScenarios
      : derivePainScenarioTerms(strategyPlan)
    const allocationOverrides = [
      { category: "core_keywords" as const, count: sectionPlan.counts.keyword },
      { category: "weakness_spin" as const, count: sectionPlan.counts.weakness },
      { category: "pain_scenario" as const, count: sectionPlan.counts.painScenario },
    ].filter(item => item.count > 0)

    if (sectionPlan.counts.keyword > 0 && keywordSource === "custom" && customQuestionKeywords.length === 0) {
      updateBrand({
        questionError: "关键词部分选择了自定义来源，请先填写至少 1 个关键词。",
        questionStatus: "error",
      })
      return
    }

    if (sectionPlan.counts.painScenario > 0 && painScenarioSource === "custom" && customPainScenarios.length === 0) {
      updateBrand({
        questionError: "痛点场景部分选择了自定义来源，请先填写至少 1 个痛点或场景。",
        questionStatus: "error",
      })
      return
    }

    const initialProgress: QuestionJobProgress = {
      completedCount: 0,
      totalCount: effectiveCount,
      currentBatch: 0,
      totalBatches: 0,
    }

    updateBrand({
      questionStatus: "generating",
      questionError: "",
      questionJobId: undefined,
      questionJobProgress: initialProgress,
      questions: [],
    })

    questionRunIdRef.current += 1
    const runId = questionRunIdRef.current
    questionAbortRef.current?.abort()
    const controller = new AbortController()
    questionAbortRef.current = controller
    questionJobCreatingRef.current = true
    const isCurrentRun = () => (
      mountedRef.current
      && questionRunIdRef.current === runId
      && !controller.signal.aborted
    )

    try {
      const createRes = await apiFetch("/api/geo-strategy/question-jobs", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          strategy: strategyPlan,
          totalCount: effectiveCount,
          layer2Ratio: activeBrand.layer2Ratio,
          categoryConfig: activeBrand.categoryConfig,
          questionModelProvider: activeBrand.questionModelProvider,
          questionModel: activeBrand.questionModel,
          coreKeywords,
          customKeywords: customQuestionKeywords,
          painScenarioKeywords,
          customPainScenarios,
          allocationOverrides,
        }),
      })
      const job = await readApiJson<QuestionJobRecord & { error?: string }>(createRes, "疑问句任务创建")

      if (!createRes.ok) {
        throw new Error(job.error || `任务创建失败 (${createRes.status})`)
      }
      if (!job.id) {
        throw new Error("疑问句任务创建失败：未返回任务 ID")
      }

      if (!isCurrentRun()) return
      questionJobCreatingRef.current = false
      if (questionAbortRef.current === controller) questionAbortRef.current = null

      updateBrand({
        questionJobId: job.id,
        questionJobProgress: questionJobProgressFromRecord(job),
        questions: job.questions,
        questionStatus: "generating",
      })
    } catch (err) {
      questionJobCreatingRef.current = false
      if (!isCurrentRun()) return
      if (questionAbortRef.current === controller) questionAbortRef.current = null

      updateBrand({
        questionError: err instanceof Error ? err.message : "生成失败",
        questionStatus: "error",
        questionJobId: undefined,
        questionJobProgress: undefined,
      })
    }
  }, [activeBrand.strategyPlan, activeBrand.questionCount, activeBrand.customQuestionCount, activeBrand.questionModelProvider, activeBrand.questionModel, activeBrand.questionCustomKeywords, activeBrand.questionCustomPainScenarios, activeBrand.layer2Ratio, activeBrand.categoryConfig, questionProviderSettings, updateBrand])

  const handleStopGenerateQuestions = useCallback(async () => {
    const jobId = activeBrand.questionJobId
    const retainedCount = activeBrand.questions.length

    questionRunIdRef.current += 1
    questionAbortRef.current?.abort()
    questionAbortRef.current = null
    questionJobCreatingRef.current = false

    updateBrand({
      questionStatus: "idle",
      questionError: retainedCount > 0
        ? `已停止生成，已保留当前 ${retainedCount} 条疑问句。`
        : "已停止生成。",
      questionJobId: undefined,
      questionJobProgress: undefined,
    })

    if (!jobId) return

    try {
      await apiFetch(`/api/geo-strategy/question-jobs/${jobId}`, {
        method: "PATCH",
        cache: "no-store",
      })
    } catch (error) {
      console.warn("[keyword-strategy] stop question job failed:", error)
    }
  }, [activeBrand.questionJobId, activeBrand.questions.length, updateBrand])

  useEffect(() => {
    if (
      activeBrand.questionStatus !== "generating"
      || activeBrand.questionJobId
      || questionJobCreatingRef.current
    ) {
      return
    }

    updateBrand({
      questionStatus: "idle",
      questionError: "上一次疑问句任务未完成创建，已停止等待。",
      questionJobProgress: undefined,
    })
  }, [activeBrand.questionJobId, activeBrand.questionStatus, updateBrand])

  useEffect(() => {
    const jobId = activeBrand.questionJobId
    if (activeBrand.questionStatus !== "generating" || !jobId) return

    const controller = new AbortController()
    questionRunIdRef.current += 1
    const runId = questionRunIdRef.current
    questionAbortRef.current?.abort()
    questionAbortRef.current = controller
    let failedPolls = 0
    let slowNoticeShown = false
    const pollStartedAt = Date.now()

    const isCurrentRun = () => (
      mountedRef.current
      && questionRunIdRef.current === runId
      && !controller.signal.aborted
    )

    ;(async () => {
      try {
        for (;;) {
          let job: QuestionJobRecord & { error?: string }

          try {
            const pollRes = await apiFetch(`/api/geo-strategy/question-jobs/${jobId}`, {
              cache: "no-store",
              signal: controller.signal,
            })
            job = await readApiJson<QuestionJobRecord & { error?: string }>(pollRes, "疑问句任务查询")
            if (!pollRes.ok) {
              throw new Error(job.error || `任务查询失败 (${pollRes.status})`)
            }
            failedPolls = 0
          } catch (error) {
            if (!isCurrentRun()) return
            if (isFatalQuestionPollError(error)) throw error
            failedPolls += 1
            if (failedPolls >= 5) {
              updateBrand({
                questionError: "后台任务仍在生成，暂时无法刷新进度；系统会继续自动重试，请不要重新发起同一个任务。",
                questionStatus: "generating",
                questionJobId: jobId,
              })
              await waitForQuestionPoll(controller.signal, 10000)
            } else {
              await waitForQuestionPoll(controller.signal)
            }
            if (!isCurrentRun()) return
            continue
          }

          if (!isCurrentRun()) return

          const progress = questionJobProgressFromRecord(job)

          if (job.status === "succeeded") {
            updateBrand({
              questions: job.questions,
              questionError: job.warnings.length > 0 ? job.warnings.join("；") : "",
              questionStatus: "done",
              questionJobId: undefined,
              questionJobProgress: progress,
              completedSteps: [...new Set([...activeBrand.completedSteps, "questions" as ToolStep])],
            })
            return
          }

          if (job.status === "failed") {
            throw new Error(job.error || "疑问句后台任务失败")
          }

          if (job.status === "cancelled") {
            updateBrand({
              questions: job.questions,
              questionError: job.questions.length > 0
                ? `已停止生成，已保留当前 ${job.questions.length} 条疑问句。`
                : "已停止生成。",
              questionStatus: "idle",
              questionJobId: undefined,
              questionJobProgress: undefined,
            })
            return
          }

          updateBrand({
            questions: job.questions,
            questionJobProgress: progress,
            questionStatus: "generating",
            questionError: slowNoticeShown
              ? "后台任务仍在生成，大批量豆包任务可能耗时较久；系统会持续等待并自动写入结果。"
              : "",
          })

          if (!slowNoticeShown && Date.now() - pollStartedAt > 30 * 60 * 1000) {
            slowNoticeShown = true
            updateBrand({
              questionError: "后台任务仍在生成，大批量豆包任务可能耗时较久；系统会持续等待并自动写入结果。",
              questionStatus: "generating",
              questionJobId: jobId,
            })
          }

          await waitForQuestionPoll(controller.signal, slowNoticeShown ? 5000 : 2000)
          if (!isCurrentRun()) return
        }
      } catch (err) {
        if (!isCurrentRun()) return

        if (isRecoverableQuestionPollError(err)) {
          updateBrand({
            questionError: "后台任务仍在生成，刚才进度刷新超时；系统会继续自动重试并保留已生成结果。",
            questionStatus: "generating",
            questionJobId: jobId,
          })
          window.setTimeout(() => {
            if (mountedRef.current) setQuestionPollRetryKey(key => key + 1)
          }, 8000)
          return
        }

        updateBrand({
          questionError: err instanceof Error ? err.message : "生成失败",
          questionStatus: "error",
          questionJobId: undefined,
          questionJobProgress: undefined,
        })
      } finally {
        if (questionAbortRef.current === controller) {
          questionAbortRef.current = null
        }
      }
    })()

    return () => {
      if (questionRunIdRef.current === runId) {
        questionRunIdRef.current += 1
      }
      controller.abort()
      if (questionAbortRef.current === controller) {
        questionAbortRef.current = null
      }
    }
  }, [activeBrand.completedSteps, activeBrand.questionJobId, activeBrand.questionStatus, questionPollRetryKey, updateBrand])

  // Export
  const handleExportJson = useCallback(() => {
    if (!activeBrand.strategyPlan) return
    const full = { ...activeBrand.strategyPlan }
    if (activeBrand.questions.length) full.question_strategy = activeBrand.questions
    const blob = new Blob([JSON.stringify(full, null, 2)], { type: "application/json" })
    downloadBlob(blob, `${activeBrand.strategyPlan.project_name || "GEO策略"}_完整方案.json`)
  }, [activeBrand.strategyPlan, activeBrand.questions])

  const handleExportMarkdown = useCallback(() => {
    if (!activeBrand.strategyPlan) return
    const md = generateMarkdown(activeBrand.strategyPlan, activeBrand.questions)
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" })
    downloadBlob(blob, `${activeBrand.strategyPlan.project_name || "GEO策略"}_方案报告.md`)
  }, [activeBrand.strategyPlan, activeBrand.questions])

  const handleExportWord = useCallback(() => {
    if (!activeBrand.strategyPlan) return
    const html = generateWordHtml(activeBrand.strategyPlan, activeBrand.questions)
    const blob = new Blob([html], { type: "application/msword;charset=utf-8" })
    downloadBlob(blob, `${activeBrand.strategyPlan.project_name || "GEO策略"}_方案报告.doc`)
  }, [activeBrand.strategyPlan, activeBrand.questions])

  const handleExportQuestionsCsv = useCallback(() => {
    if (!activeBrand.strategyPlan || activeBrand.questions.length === 0) return
    const csv = generateQuestionCsv(activeBrand.questions)
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" })
    downloadBlob(blob, `${buildQuestionExportBaseName(activeBrand.strategyPlan)}_疑问句池.csv`)
  }, [activeBrand.strategyPlan, activeBrand.questions])

  const handleExportQuestionsWord = useCallback(() => {
    if (!activeBrand.strategyPlan || activeBrand.questions.length === 0) return
    const html = generateQuestionWordHtml(activeBrand.strategyPlan, activeBrand.questions)
    const blob = new Blob([html], { type: "application/msword;charset=utf-8" })
    downloadBlob(blob, `${buildQuestionExportBaseName(activeBrand.strategyPlan)}_疑问句池.doc`)
  }, [activeBrand.strategyPlan, activeBrand.questions])

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
              questionStatus={ab.questionStatus}
              questionError={ab.questionError}
              questionJobProgress={ab.questionJobProgress}
              questionCount={ab.questionCount}
              customQuestionCount={ab.customQuestionCount}
              questionModelProvider={ab.questionModelProvider}
              questionModel={ab.questionModel}
              questionCustomKeywords={ab.questionCustomKeywords}
              questionCustomPainScenarios={ab.questionCustomPainScenarios}
              layer2Ratio={ab.layer2Ratio}
              onQuestionCountChange={v => setBrandField("questionCount", v)}
              onCustomQuestionCountChange={v => setBrandField("customQuestionCount", v)}
              onQuestionModelProviderChange={provider => updateBrand({
                questionModelProvider: provider,
                questionModel: getDefaultQuestionModel(provider),
              })}
              onQuestionModelChange={v => setBrandField("questionModel", normalizeQuestionModel(ab.questionModelProvider, v))}
              onQuestionCustomKeywordsChange={v => setBrandField("questionCustomKeywords", v)}
              onQuestionCustomPainScenariosChange={v => setBrandField("questionCustomPainScenarios", v)}
              onLayer2RatioChange={v => setBrandField("layer2Ratio", v)}
              categoryConfig={ab.categoryConfig}
              questionProviderSettings={questionProviderSettings}
              onCategoryConfigChange={v => setBrandField("categoryConfig", v)}
              onGenerateQuestions={handleGenerateQuestions}
              onStopQuestions={handleStopGenerateQuestions}
              onExportJson={handleExportJson}
              onExportMarkdown={handleExportMarkdown}
              onExportWord={handleExportWord}
              onExportQuestionsCsv={handleExportQuestionsCsv}
              onExportQuestionsWord={handleExportQuestionsWord}
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
  plan, questions, questionStatus, questionError,
  questionJobProgress,
  questionCount, customQuestionCount, questionModelProvider, questionModel, questionCustomKeywords, questionCustomPainScenarios, layer2Ratio,
  categoryConfig, questionProviderSettings, onCategoryConfigChange,
  onQuestionCountChange, onCustomQuestionCountChange, onQuestionModelProviderChange, onQuestionModelChange, onQuestionCustomKeywordsChange, onQuestionCustomPainScenariosChange, onLayer2RatioChange, onGenerateQuestions, onStopQuestions,
  onExportJson, onExportMarkdown, onExportWord, onExportQuestionsCsv, onExportQuestionsWord, onBack,
  hasQuestions,
}: {
  plan: GeoStrategyPlan
  questions: QuestionItem[]
  questionStatus: GenerationStatus
  questionError: string
  questionJobProgress?: QuestionJobProgress
  questionCount: number
  customQuestionCount: number
  questionModelProvider: QuestionModelProvider
  questionModel: string
  questionCustomKeywords: string
  questionCustomPainScenarios: string
  layer2Ratio: number
  categoryConfig: QuestionCategoryConfig
  questionProviderSettings: Partial<Record<QuestionModelProvider, AiProviderPublicSetting>>
  onCategoryConfigChange: (cfg: QuestionCategoryConfig) => void
  onQuestionCountChange: (v: number) => void
  onCustomQuestionCountChange: (v: number) => void
  onQuestionModelProviderChange: (v: QuestionModelProvider) => void
  onQuestionModelChange: (v: string) => void
  onQuestionCustomKeywordsChange: (v: string) => void
  onQuestionCustomPainScenariosChange: (v: string) => void
  onLayer2RatioChange: (v: number) => void
  onGenerateQuestions: () => void
  onStopQuestions: () => void
  onExportJson: () => void
  onExportMarkdown: () => void
  onExportWord: () => void
  onExportQuestionsCsv: () => void
  onExportQuestionsWord: () => void
  onBack: () => void
  hasQuestions: boolean
}) {
  const [showJson, setShowJson] = useState(false)
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
        {hasQuestions && questionStatus === "generating" && questionJobProgress && (
          <div className="mb-4 space-y-2">
            <QuestionJobProgressBar progress={questionJobProgress} />
            <button
              onClick={onStopQuestions}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-100 sm:w-auto"
            >
              <X className="h-3.5 w-3.5" />
              停止生成
            </button>
          </div>
        )}
        {!hasQuestions ? (
          <QuestionSettingsPanel
            plan={plan}
            questionCount={questionCount}
            customQuestionCount={customQuestionCount}
            questionCustomKeywords={questionCustomKeywords}
            questionCustomPainScenarios={questionCustomPainScenarios}
            layer2Ratio={layer2Ratio}
            categoryConfig={categoryConfig}
            questionStatus={questionStatus}
            questionError={questionError}
            questionJobProgress={questionJobProgress}
            questionModelProvider={questionModelProvider}
            questionModel={questionModel}
            questionProviderSettings={questionProviderSettings}
            onQuestionCountChange={onQuestionCountChange}
            onCustomQuestionCountChange={onCustomQuestionCountChange}
            onQuestionModelProviderChange={onQuestionModelProviderChange}
            onQuestionModelChange={onQuestionModelChange}
            onQuestionCustomKeywordsChange={onQuestionCustomKeywordsChange}
            onQuestionCustomPainScenariosChange={onQuestionCustomPainScenariosChange}
            onLayer2RatioChange={onLayer2RatioChange}
            onCategoryConfigChange={onCategoryConfigChange}
            onGenerateQuestions={onGenerateQuestions}
            onStopQuestions={onStopQuestions}
          />
        ) : (
          <>
            {/* Show question summary */}
            <div className="mb-4 flex flex-col gap-3 rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-slate-500">
                共 {questions.length} 条疑问句（第一层: {questions.filter(q => q.layer === "第一层").length} 条, 第二层: {questions.filter(q => q.layer === "第二层").length} 条）
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={onExportQuestionsCsv}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-medium text-violet-700 transition hover:bg-violet-50"
                  title="导出为 CSV 表格"
                >
                  <Download className="h-3.5 w-3.5" />
                  导出表格
                </button>
                <button
                  onClick={onExportQuestionsWord}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-medium text-violet-700 transition hover:bg-violet-50"
                  title="导出为 Word 文档"
                >
                  <FileText className="h-3.5 w-3.5" />
                  导出文档
                </button>
              </div>
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
                  questionCustomPainScenarios={questionCustomPainScenarios}
                  layer2Ratio={layer2Ratio}
                  categoryConfig={categoryConfig}
                  questionStatus={questionStatus}
                  questionError={questionError}
                  questionJobProgress={questionJobProgress}
                  questionModelProvider={questionModelProvider}
                  questionModel={questionModel}
                  questionProviderSettings={questionProviderSettings}
                  onQuestionCountChange={onQuestionCountChange}
                  onCustomQuestionCountChange={onCustomQuestionCountChange}
                  onQuestionModelProviderChange={onQuestionModelProviderChange}
                  onQuestionModelChange={onQuestionModelChange}
                  onQuestionCustomKeywordsChange={onQuestionCustomKeywordsChange}
                  onQuestionCustomPainScenariosChange={onQuestionCustomPainScenariosChange}
                  onLayer2RatioChange={onLayer2RatioChange}
                  onCategoryConfigChange={onCategoryConfigChange}
                  onGenerateQuestions={onGenerateQuestions}
                  onStopQuestions={onStopQuestions}
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

function QuestionJobProgressBar({ progress }: { progress: QuestionJobProgress }) {
  const total = Math.max(1, progress.totalCount)
  const percent = Math.min(100, Math.round(progress.completedCount / total * 100))
  const batchText = progress.totalBatches > 0
    ? `第 ${Math.min(progress.currentBatch, progress.totalBatches)}/${progress.totalBatches} 批`
    : "准备中"
  const longTaskText = progress.totalCount >= 300
    ? "大批量任务会持续后台生成，可切换客户面板，完成后自动写入当前客户。"
    : ""

  return (
    <div className="rounded-xl border border-violet-100 bg-violet-50/70 px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-3 text-[11px] text-violet-700">
        <span className="font-medium">后台生成中</span>
        <span>{progress.completedCount}/{progress.totalCount} 条 · {batchText}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white">
        <div
          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-600 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      {longTaskText && (
        <div className="mt-1.5 text-[10px] leading-4 text-violet-600">{longTaskText}</div>
      )}
    </div>
  )
}

function QuestionSettingsPanel({
  plan, questionCount, customQuestionCount, questionModelProvider, questionModel, questionCustomKeywords, questionCustomPainScenarios, layer2Ratio, categoryConfig,
  questionStatus, questionError, questionJobProgress, questionProviderSettings,
  onQuestionCountChange, onCustomQuestionCountChange, onQuestionModelProviderChange, onQuestionModelChange, onQuestionCustomKeywordsChange, onQuestionCustomPainScenariosChange, onLayer2RatioChange,
  onCategoryConfigChange, onGenerateQuestions, onStopQuestions,
}: {
  plan: GeoStrategyPlan
  questionCount: number
  customQuestionCount: number
  questionModelProvider: QuestionModelProvider
  questionModel: string
  questionCustomKeywords: string
  questionCustomPainScenarios: string
  layer2Ratio: number
  categoryConfig: QuestionCategoryConfig
  questionStatus: GenerationStatus
  questionError: string
  questionJobProgress?: QuestionJobProgress
  questionProviderSettings: Partial<Record<QuestionModelProvider, AiProviderPublicSetting>>
  onQuestionCountChange: (v: number) => void
  onCustomQuestionCountChange: (v: number) => void
  onQuestionModelProviderChange: (v: QuestionModelProvider) => void
  onQuestionModelChange: (v: string) => void
  onQuestionCustomKeywordsChange: (v: string) => void
  onQuestionCustomPainScenariosChange: (v: string) => void
  onLayer2RatioChange: (v: number) => void
  onCategoryConfigChange: (cfg: QuestionCategoryConfig) => void
  onGenerateQuestions: () => void
  onStopQuestions: () => void
}) {
  const baseCount = effectiveQuestionBaseCount(questionCount, customQuestionCount)
  const sectionPlan = calculateQuestionSectionPlan(plan, categoryConfig, baseCount)
  const weaknesses = plan.profile?.weaknesses || []
  const systemKeywords = deriveCoreKeywords(plan)
  const customKeywords = parseQuestionKeywords(questionCustomKeywords)
  const keywordSource = categoryConfig.keywordSource || "system"
  const previewKeywords = keywordSource === "custom" ? customKeywords : systemKeywords
  const systemPainScenarios = derivePainScenarioTerms(plan)
  const customPainScenarios = parseQuestionKeywords(questionCustomPainScenarios)
  const painScenarioSource = categoryConfig.painScenarioSource || "system"
  const previewPainScenarios = painScenarioSource === "custom" ? customPainScenarios : systemPainScenarios
  const nonBlockingMessage = isNonBlockingQuestionMessage(questionError)
  const totalTooHigh = sectionPlan.totalCount > QUESTION_GENERATION_LIMIT
  const noSectionsSelected = sectionPlan.totalCount <= 0
  const keywordCustomMissing = sectionPlan.counts.keyword > 0 && keywordSource === "custom" && customKeywords.length === 0
  const painCustomMissing = sectionPlan.counts.painScenario > 0 && painScenarioSource === "custom" && customPainScenarios.length === 0
  const selectedProviderSetting = questionProviderSettings[questionModelProvider]
  const selectedProviderMissingKey = selectedProviderSetting?.hasApiKey === false
  const selectedProviderStatusTone = selectedProviderMissingKey
    ? "border-amber-200 bg-amber-50 text-amber-700"
    : selectedProviderSetting
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-slate-200 bg-slate-50 text-slate-500"
  const selectedProviderStatusText = selectedProviderMissingKey
    ? "后台 API Key 未配置"
    : selectedProviderSetting
      ? "后台 API Key 已配置"
      : "正在读取后台配置"
  const selectedModelOption = QUESTION_MODEL_OPTIONS[questionModelProvider].find(option => option.model === questionModel)
  const generateDisabled = totalTooHigh || noSectionsSelected || keywordCustomMissing || painCustomMissing || selectedProviderMissingKey

  const updateConfig = (patch: Partial<QuestionCategoryConfig>) => {
    const next = { ...categoryConfig, ...patch }
    next.weaknessesPerWeakness = Math.min(30, Math.max(1, Math.round(Number(next.weaknessesPerWeakness ?? 10) || 10)))
    next.keywordCount = clampQuestionSectionCount(next.keywordCount, 20)
    next.weaknessCount = clampQuestionSectionCount(next.weaknessCount, Math.max(10, weaknesses.length * next.weaknessesPerWeakness))
    next.painScenarioCount = clampQuestionSectionCount(next.painScenarioCount, 10)
    next.coreRatio = Math.min(0.70, Math.max(0.30, Number(next.coreRatio ?? 0.30)))
    const maxSecondary = Math.min(0.50, 1.0 - next.coreRatio - 0.05)
    next.secondaryRatio = Math.min(maxSecondary, Math.max(0.05, Number(next.secondaryRatio ?? 0.35)))
    next.coreCount = clampQuestionSectionCount(next.coreCount, 0)
    next.secondaryCount = clampQuestionSectionCount(next.secondaryCount, 0)
    onCategoryConfigChange(next)
  }

  const setCountMode = (section: QuestionSectionKey, mode: "system" | "custom") => {
    if (section === "keyword") updateConfig({ keywordCountMode: mode, keywordCount: sectionPlan.counts.keyword || 20 })
    if (section === "weakness") updateConfig({ weaknessCountMode: mode, weaknessCount: sectionPlan.counts.weakness || Math.max(1, weaknesses.length * categoryConfig.weaknessesPerWeakness) })
    if (section === "painScenario") updateConfig({ painScenarioCountMode: mode, painScenarioCount: sectionPlan.counts.painScenario || 10 })
  }

  const countModeButton = (section: QuestionSectionKey, mode: "system" | "custom", label: string) => {
    const currentMode = section === "keyword"
      ? categoryConfig.keywordCountMode || "system"
      : section === "weakness"
        ? categoryConfig.weaknessCountMode || "system"
        : categoryConfig.painScenarioCountMode || "system"
    return (
      <button
        type="button"
        onClick={() => setCountMode(section, mode)}
        className={`text-[11px] px-2.5 py-1 rounded-md transition ${currentMode === mode ? "bg-[#004B73] text-white" : "text-slate-500 hover:bg-slate-50"}`}
      >
        {label}
      </button>
    )
  }

  const sourceButton = (
    source: "system" | "custom",
    current: "system" | "custom",
    onClick: () => void,
    label: string,
  ) => (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] px-2.5 py-1 rounded-md transition ${current === source ? "bg-[#004B73] text-white" : "text-slate-500 hover:bg-slate-50"}`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="text-xs text-slate-500">策略已生成，可选择生成关键词、劣势、痛点场景三类疑问句。</div>

      <div className="bg-slate-50/80 rounded-xl border border-slate-100 p-4 space-y-3">
        <h3 className="text-xs font-semibold text-slate-600">基础设置</h3>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[11px] font-semibold text-slate-600">AI 模型</div>
              <div className="text-[10px] text-slate-400">模型名称已按官方文档核对至 {QUESTION_MODEL_OPTIONS_LAST_VERIFIED}</div>
            </div>
            <div className="inline-flex w-fit rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              {(["qwen", "doubao"] as QuestionModelProvider[]).map(provider => (
                <button
                  key={provider}
                  type="button"
                  onClick={() => onQuestionModelProviderChange(provider)}
                  className={`text-[11px] px-3 py-1.5 rounded-md transition ${questionModelProvider === provider ? "bg-[#004B73] text-white shadow-sm" : "text-slate-500 hover:bg-white"}`}
                >
                  {QUESTION_MODEL_PROVIDER_LABELS[provider]}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
            <div>
              <label className="text-[11px] font-medium text-slate-500">具体模型</label>
              <select
                value={questionModel}
                onChange={e => onQuestionModelChange(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              >
                {QUESTION_MODEL_OPTIONS[questionModelProvider].map(option => (
                  <option key={option.model} value={option.model}>{option.label} · {option.model}</option>
                ))}
              </select>
              <div className="mt-1 text-[10px] leading-4 text-slate-400">
                {selectedModelOption?.description || "请选择一个可用模型。"}
              </div>
            </div>
            <div className={`rounded-lg border px-3 py-2 text-[11px] ${selectedProviderStatusTone}`}>
              <div className="font-semibold">{QUESTION_MODEL_PROVIDER_LABELS[questionModelProvider]}</div>
              <div>{selectedProviderStatusText}</div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-[11px] font-medium text-slate-500">系统建议总量</label>
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
              <label className="text-[11px] font-medium text-slate-500">自定义基准 (最多{QUESTION_GENERATION_LIMIT})</label>
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
              第一层 {Math.round(sectionPlan.totalCount * (1 - layer2Ratio))} 条 · 第二层 {Math.round(sectionPlan.totalCount * layer2Ratio)} 条
            </div>
          </div>
        </div>
        <div className="text-[10px] text-slate-400">
          选择“系统建议数量”的部分会按上面的基准自动分配；选择“自定义数量”的部分直接按填写数量生成。
        </div>
      </div>

      {questionStatus === "generating" && questionJobProgress && (
        <QuestionJobProgressBar progress={questionJobProgress} />
      )}

      <div className="space-y-3">
        <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={categoryConfig.keywordEnabled !== false}
                onChange={e => updateConfig({ keywordEnabled: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              关键词生成
            </label>
            <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
              {sectionPlan.counts.keyword} 条
            </span>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1.5 text-[11px] font-medium text-slate-500">数量</div>
              <div className="mb-2 inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                {countModeButton("keyword", "system", "系统建议")}
                {countModeButton("keyword", "custom", "自定义")}
              </div>
              {(categoryConfig.keywordCountMode || "system") === "custom" && (
                <input
                  type="number"
                  min={0}
                  max={QUESTION_GENERATION_LIMIT}
                  value={categoryConfig.keywordCount ?? sectionPlan.counts.keyword}
                  onChange={e => updateConfig({ keywordCount: Number(e.target.value) })}
                  className="block w-28 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none"
                />
              )}
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-medium text-slate-500">关键词来源</div>
              <div className="mb-2 inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                {sourceButton("system", keywordSource, () => updateConfig({ keywordSource: "system" }), "系统推荐")}
                {sourceButton("custom", keywordSource, () => updateConfig({ keywordSource: "custom" }), "自定义")}
              </div>
              {keywordSource === "custom" && (
                <textarea
                  value={questionCustomKeywords}
                  onChange={e => onQuestionCustomKeywordsChange(e.target.value)}
                  rows={3}
                  placeholder={"每行一个关键词，也可用逗号/顿号分隔\n例如：AI Agent 工具\n企业级智能体"}
                  className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              )}
            </div>
          </div>
          {previewKeywords.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {previewKeywords.slice(0, 12).map((kw, i) => (
                <span key={`${kw}-${i}`} className="rounded-full border border-blue-100 bg-white/70 px-2 py-1 text-[10px] text-blue-700">
                  {kw}
                </span>
              ))}
              {previewKeywords.length > 12 && <span className="text-[10px] text-slate-400">+{previewKeywords.length - 12} 更多</span>}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={categoryConfig.weaknessEnabled !== false}
                disabled={weaknesses.length === 0}
                onChange={e => updateConfig({ weaknessEnabled: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-amber-600 disabled:opacity-40"
              />
              劣势生成
            </label>
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
              {sectionPlan.counts.weakness} 条
            </span>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1.5 text-[11px] font-medium text-slate-500">数量</div>
              <div className="mb-2 inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                {countModeButton("weakness", "system", "系统建议")}
                {countModeButton("weakness", "custom", "自定义")}
              </div>
              {(categoryConfig.weaknessCountMode || "system") === "custom" ? (
                <input
                  type="number"
                  min={0}
                  max={QUESTION_GENERATION_LIMIT}
                  value={categoryConfig.weaknessCount ?? sectionPlan.counts.weakness}
                  onChange={e => updateConfig({ weaknessCount: Number(e.target.value) })}
                  className="block w-28 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none"
                />
              ) : (
                <div className="text-[11px] text-slate-500">
                  每个劣势
                  <select
                    value={categoryConfig.weaknessesPerWeakness}
                    onChange={e => updateConfig({ weaknessesPerWeakness: Number(e.target.value) })}
                    className="mx-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs outline-none"
                  >
                    {[5, 8, 10, 12, 15, 20, 25, 30].map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  条
                </div>
              )}
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-medium text-slate-500">系统劣势</div>
              {weaknesses.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {weaknesses.map((weakness, index) => (
                    <span key={`${weakness}-${index}`} className="rounded-full border border-amber-200 bg-white/70 px-2 py-1 text-[10px] text-amber-700">
                      {weakness}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-amber-700">当前策略没有可用劣势，生成时会自动跳过这一部分。</div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={categoryConfig.painScenarioEnabled !== false}
                onChange={e => updateConfig({ painScenarioEnabled: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600"
              />
              痛点场景生成
            </label>
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
              {sectionPlan.counts.painScenario} 条
            </span>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1.5 text-[11px] font-medium text-slate-500">数量</div>
              <div className="mb-2 inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                {countModeButton("painScenario", "system", "系统建议")}
                {countModeButton("painScenario", "custom", "自定义")}
              </div>
              {(categoryConfig.painScenarioCountMode || "system") === "custom" && (
                <input
                  type="number"
                  min={0}
                  max={QUESTION_GENERATION_LIMIT}
                  value={categoryConfig.painScenarioCount ?? sectionPlan.counts.painScenario}
                  onChange={e => updateConfig({ painScenarioCount: Number(e.target.value) })}
                  className="block w-28 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none"
                />
              )}
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-medium text-slate-500">痛点场景来源</div>
              <div className="mb-2 inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                {sourceButton("system", painScenarioSource, () => updateConfig({ painScenarioSource: "system" }), "系统推荐")}
                {sourceButton("custom", painScenarioSource, () => updateConfig({ painScenarioSource: "custom" }), "自定义")}
              </div>
              {painScenarioSource === "custom" && (
                <textarea
                  value={questionCustomPainScenarios}
                  onChange={e => onQuestionCustomPainScenariosChange(e.target.value)}
                  rows={3}
                  placeholder={"每行一个痛点或场景，也可用逗号/顿号分隔\n例如：预算有限\n首次采购怕踩坑\n本地交付不确定"}
                  className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              )}
            </div>
          </div>
          {previewPainScenarios.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {previewPainScenarios.slice(0, 12).map((term, i) => (
                <span key={`${term}-${i}`} className="rounded-full border border-emerald-100 bg-white/70 px-2 py-1 text-[10px] text-emerald-700">
                  {term}
                </span>
              ))}
              {previewPainScenarios.length > 12 && <span className="text-[10px] text-slate-400">+{previewPainScenarios.length - 12} 更多</span>}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-600">本次生成预览</span>
          <span className={`font-bold ${totalTooHigh || noSectionsSelected ? "text-red-600" : "text-slate-800"}`}>
            合计 {sectionPlan.totalCount} 条
          </span>
        </div>
        <div className="space-y-1 text-[11px]">
          <div className="flex justify-between"><span className="text-slate-500">关键词生成</span><span className="font-medium text-slate-700">{sectionPlan.counts.keyword} 条</span></div>
          <div className="flex justify-between"><span className="text-slate-500">劣势生成</span><span className="font-medium text-slate-700">{sectionPlan.counts.weakness} 条</span></div>
          <div className="flex justify-between"><span className="text-slate-500">痛点场景生成</span><span className="font-medium text-slate-700">{sectionPlan.counts.painScenario} 条</span></div>
        </div>
        {noSectionsSelected && (
          <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-600">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            请至少选择一个生成部分，并设置大于 0 的数量。
          </div>
        )}
        {totalTooHigh && (
          <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-600">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            本次合计超过 {QUESTION_GENERATION_LIMIT} 条，请减少某个部分的数量。
          </div>
        )}
        {keywordCustomMissing && (
          <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            关键词生成已选择自定义来源，请填写关键词。
          </div>
        )}
        {painCustomMissing && (
          <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            痛点场景生成已选择自定义来源，请填写痛点或场景。
          </div>
        )}
      </div>

      {questionError && (
        <div className={`rounded-xl border px-3 py-2 text-xs flex items-start gap-2 ${
          nonBlockingMessage
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : "border-red-200 bg-red-50 text-red-600"
        }`}>
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          {questionError}
        </div>
      )}

      {questionStatus === "generating" ? (
        <button
          onClick={onStopQuestions}
          className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-all"
        >
          <X className="h-4 w-4" />
          停止生成
        </button>
      ) : (
        <button onClick={onGenerateQuestions}
          disabled={generateDisabled}
          className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white hover:shadow-lg hover:shadow-violet-300/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
          <Sparkles className="h-4 w-4" /> 生成疑问句池
        </button>
      )}
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

function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "GEO策略"
}

function buildQuestionExportBaseName(plan: GeoStrategyPlan): string {
  return sanitizeFileName(plan.project_name || plan.profile?.brand_or_product || "GEO策略")
}

function escapeCsvCell(value: unknown): string {
  const text = String(value ?? "")
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function generateQuestionCsv(questions: QuestionItem[]): string {
  const headers = ["序号", "层级", "疑问句", "生成类型", "关键词"]
  const rows = questions.map(question => [
    question.id,
    question.layer,
    question.question,
    question.category,
    question.keyword,
  ])
  return [headers, ...rows].map(row => row.map(escapeCsvCell).join(",")).join("\n")
}

function generateQuestionWordHtml(
  plan: GeoStrategyPlan,
  questions: QuestionItem[],
): string {
  const projectName = plan.project_name || plan.profile?.brand_or_product || "GEO 疑问句池"
  const layer1Count = questions.filter(question => question.layer === "第一层").length
  const layer2Count = questions.filter(question => question.layer === "第二层").length
  const categoryCounts = questions.reduce<Record<string, number>>((acc, question) => {
    const category = question.category || "未分类"
    acc[category] = (acc[category] || 0) + 1
    return acc
  }, {})

  const rows = questions.map(question => (
    `<tr><td>${escapeHtml(question.id)}</td><td>${escapeHtml(question.layer)}</td><td>${escapeHtml(question.question)}</td><td>${escapeHtml(question.category)}</td><td>${escapeHtml(question.keyword)}</td></tr>`
  ))

  return [
    `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>`,
    `<head><meta charset="utf-8"><title>${escapeHtml(projectName)} 疑问句池</title>`,
    `<style>body{font-family:'微软雅黑',Arial,sans-serif;font-size:11pt;color:#1e293b;line-height:1.5;margin:2cm}h1{font-size:20pt;color:#4c1d95;border-bottom:2px solid #8b5cf6;padding-bottom:8px}p{margin:6px 0 12px;color:#64748b}.summary{margin:12px 0 16px;padding:10px 12px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;color:#4c1d95}table{border-collapse:collapse;width:100%;font-size:9.5pt}td,th{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;vertical-align:top}th{background:#ede9fe;color:#4c1d95;font-weight:600}tr:nth-child(even){background:#f8fafc}.q{width:48%}</style></head><body>`,
    `<h1>${escapeHtml(projectName)} 疑问句池</h1>`,
    `<div class="summary">共 ${questions.length} 条疑问句，第一层 ${layer1Count} 条，第二层 ${layer2Count} 条。</div>`,
    Object.keys(categoryCounts).length > 0
      ? `<p>生成类型：${Object.entries(categoryCounts).map(([category, count]) => `${escapeHtml(category)} ${count} 条`).join("；")}</p>`
      : "",
    `<table><tr><th>#</th><th>层级</th><th class="q">疑问句</th><th>生成类型</th><th>关键词</th></tr>`,
    ...rows,
    `</table>`,
    `<p style="color:#94a3b8;font-size:9pt;margin-top:24px">Generated by 势途 GEO · ${new Date().toLocaleDateString("zh-CN")}</p>`,
    `</body></html>`,
  ].join("\n")
}

// ==================== Export: Markdown ====================

function generateMarkdown(
  plan: GeoStrategyPlan,
  questions: QuestionItem[],
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
  return lines.join("\n")
}

function buildSection(title: string, content: string): string[] {
  return [`## ${title}`, ``, content, ``]
}

// ==================== Export: Word HTML ====================

function generateWordHtml(
  plan: GeoStrategyPlan,
  questions: QuestionItem[],
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
    parts.push(`<h2>疑问句池</h2><table><tr><th>#</th><th>层级</th><th>问题</th><th>分类</th><th>关键词</th></tr>`)
    questions.forEach(q => parts.push(`<tr><td>${h(q.id)}</td><td>${q.layer === "第一层" ? "第一层" : "第二层"}</td><td>${h(q.question)}</td><td>${h(q.category)}</td><td>${h(q.keyword)}</td></tr>`))
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
