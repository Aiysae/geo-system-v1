"use client"

import { useState, useCallback, useRef } from "react"
import { API_PROVIDERS, DEFAULT_CATEGORY_CONFIG, type ApiProviderConfig, type ExtractedProfile, type ExtractedItem, type GeoStrategyPlan, type ToolStep, type GenerationStatus, type UploadedFile, type QuestionItem, type ContentCalendarItem, type QuestionCategoryConfig } from "@/types/geo-strategy"
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, ChevronLeft, CloudUpload, Download, FileText, Loader2, Plus, RefreshCw, Settings, Trash2, X, Sparkles, Search, Eye, EyeOff, ListOrdered, AlertCircle } from "lucide-react"

// ==================== Brand Data ====================

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
  strategyStatus: GenerationStatus
  strategyError: string
  strategyPlan: GeoStrategyPlan | null
  questionStatus: GenerationStatus
  questionError: string
  questionCount: number
  customQuestionCount: number
  layer2Ratio: number
  categoryConfig: QuestionCategoryConfig
  questions: QuestionItem[]
  contentCalendar: ContentCalendarItem[]
}

function createBrand(name: string): BrandData {
  return {
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
    strategyStatus: "idle",
    strategyError: "",
    strategyPlan: null,
    questionStatus: "idle",
    questionError: "",
    questionCount: 40,
    customQuestionCount: 120,
    layer2Ratio: 0.35,
    categoryConfig: DEFAULT_CATEGORY_CONFIG,
    questions: [],
    contentCalendar: [],
  }
}

// ==================== Helpers ====================

function genId(): string {
  return Math.random().toString(36).slice(2, 10)
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

function deriveSecondaryKeywords(strategy: GeoStrategyPlan, coreSet: Set<string>): string[] {
  const secondary = new Set<string>()
  for (const kw of [
    ...(strategy.keyword_strategy?.weakness_conversion_keywords || []),
    ...(strategy.keyword_strategy?.pain_advantage_keywords || []),
  ]) {
    const k = kw.keyword?.trim()
    if (k && !coreSet.has(k)) secondary.add(k)
  }
  return Array.from(secondary)
}

function derivePainScenarioKeywords(strategy: GeoStrategyPlan): string[] {
  const keywords = new Set<string>()
  for (const kw of [
    ...(strategy.keyword_strategy?.scenario_keywords || []),
    ...(strategy.keyword_strategy?.pain_advantage_keywords || []),
  ]) {
    const k = kw.keyword?.trim()
    if (k) keywords.add(k)
  }
  return Array.from(keywords)
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

// ==================== Main Page ====================

export default function GeoStrategyToolPage() {
  // Brands state
  const initialBrand = createBrand("品牌 1")
  const [brands, setBrands] = useState<Record<string, BrandData>>({ [initialBrand.id]: initialBrand })
  const [brandOrder, setBrandOrder] = useState<string[]>([initialBrand.id])
  const [activeBrandId, setActiveBrandId] = useState(initialBrand.id)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeBrand = brands[activeBrandId]

  // Generic brand updater – merges a partial update into the active brand
  function updateBrand(patch: Partial<BrandData>) {
    setBrands(prev => ({
      ...prev,
      [activeBrandId]: { ...prev[activeBrandId], ...patch },
    }))
  }

  function setBrandField<K extends keyof BrandData>(field: K, value: BrandData[K]) {
    updateBrand({ [field]: value })
  }

  function addBrand() {
    const count = brandOrder.length + 1
    const b = createBrand(`品牌 ${count}`)
    setBrands(prev => ({ ...prev, [b.id]: b }))
    setBrandOrder(prev => [...prev, b.id])
    setActiveBrandId(b.id)
  }

  function removeBrand(id: string) {
    if (brandOrder.length <= 1) return // keep at least one
    setBrands(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setBrandOrder(prev => prev.filter(bid => bid !== id))
    if (activeBrandId === id) {
      setActiveBrandId(brandOrder.find(bid => bid !== id) || brandOrder[0])
    }
  }

  // API settings (shared across brands)
  const [apiProvider, setApiProvider] = useState<ApiProviderConfig>(API_PROVIDERS[0])
  const [apiBaseUrl, setApiBaseUrl] = useState(apiProvider.baseUrl)
  const [apiModel, setApiModel] = useState(apiProvider.defaultModel)
  const [apiKey, setApiKey] = useState("")
  const [apiTimeout, setApiTimeout] = useState(900)
  const [showApiSettings, setShowApiSettings] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Provider change handler
  const handleProviderChange = useCallback((providerId: string) => {
    const provider = API_PROVIDERS.find(p => p.id === providerId)
    if (provider && provider.id !== "custom") {
      setApiProvider(provider)
      setApiBaseUrl(provider.baseUrl)
      setApiModel(provider.defaultModel)
    } else if (provider) {
      setApiProvider(provider)
    }
  }, [])

  // File handlers
  const handleFilesSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const processed: UploadedFile[] = []

    for (const file of files) {
      try {
        const content = await readFileContent(file)
        const type = file.type.startsWith("image/") ? "image" as const
          : file.type === "application/pdf" || file.name.endsWith(".pdf") ? "pdf" as const
          : "text" as const
        processed.push({ id: genId(), name: file.name, type, content, size: file.size })
      } catch {
        // skip files that can't be read
      }
    }

    updateBrand({ uploadedFiles: [...activeBrand.uploadedFiles, ...processed] })
    if (e.target) e.target.value = ""
  }, [activeBrandId, activeBrand.uploadedFiles])

  const removeFile = useCallback((id: string) => {
    updateBrand({ uploadedFiles: activeBrand.uploadedFiles.filter(f => f.id !== id) })
  }, [activeBrandId, activeBrand.uploadedFiles])

  // API config object
  const getApiConfig = useCallback(() => ({
    baseUrl: apiBaseUrl,
    apiKey,
    model: apiModel,
    timeout: apiTimeout,
    chatPath: apiProvider.chatPath || "/v1/chat/completions",
  }), [apiBaseUrl, apiKey, apiModel, apiTimeout, apiProvider.chatPath])

  // Extraction
  const handleExtract = useCallback(async () => {
    if (!apiKey) {
      updateBrand({ extractionError: "请填写 API Key" })
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
            product_description: activeBrand.productDesc,
            geo_goals: activeBrand.geoGoals,
          },
          apiConfig: getApiConfig(),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || `请求失败 (${res.status})`)
      }

      const brand = brands[activeBrandId]
      updateBrand({
        extractedProfile: data as ExtractedProfile,
        step: "extraction",
        completedSteps: [...new Set([...brand.completedSteps, "extraction" as ToolStep])],
      })
    } catch (err) {
      updateBrand({ extractionError: err instanceof Error ? err.message : "提取失败" })
    } finally {
      updateBrand({ extracting: false })
    }
  }, [activeBrandId, brands, activeBrand.uploadedFiles, activeBrand.projectName, activeBrand.industry, activeBrand.audience, activeBrand.productDesc, activeBrand.geoGoals, getApiConfig, apiKey])

  // Strategy generation
  const handleGenerateStrategy = useCallback(async () => {
    if (!activeBrand.extractedProfile) return

    updateBrand({ strategyStatus: "generating", strategyError: "" })

    try {
      const res = await fetch("/api/geo-strategy/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: activeBrand.extractedProfile,
          apiConfig: getApiConfig(),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || `请求失败 (${res.status})`)
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
  }, [activeBrandId, activeBrand.extractedProfile, activeBrand.completedSteps, getApiConfig])

  // Question generation
  const handleGenerateQuestions = useCallback(async () => {
    if (!activeBrand.strategyPlan) return

    updateBrand({ questionStatus: "generating", questionError: "" })

    const effectiveCount = activeBrand.questionCount === -1 ? activeBrand.customQuestionCount : activeBrand.questionCount
    const weaknessCount = (activeBrand.strategyPlan.profile?.weaknesses?.length || 0) * activeBrand.categoryConfig.weaknessesPerWeakness

    if (weaknessCount > effectiveCount) {
      updateBrand({
        questionError: `劣势转化问题 (${weaknessCount}条) 超过总问题数 (${effectiveCount}条)，请减少每个劣势的问题数或增加总数`,
        questionStatus: "error",
      })
      return
    }

    const coreKeywords = deriveCoreKeywords(activeBrand.strategyPlan)

    try {
      const res = await fetch("/api/geo-strategy/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy: activeBrand.strategyPlan,
          apiConfig: getApiConfig(),
          totalCount: effectiveCount,
          layer2Ratio: activeBrand.layer2Ratio,
          categoryConfig: activeBrand.categoryConfig,
          coreKeywords,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || `请求失败 (${res.status})`)
      }

      updateBrand({
        questions: data.question_strategy || [],
        contentCalendar: data.content_calendar || [],
        questionStatus: "done",
        completedSteps: [...new Set([...activeBrand.completedSteps, "questions" as ToolStep])],
      })
    } catch (err) {
      updateBrand({
        questionError: err instanceof Error ? err.message : "生成失败",
        questionStatus: "error",
      })
    }
  }, [activeBrandId, activeBrand.strategyPlan, activeBrand.completedSteps, activeBrand.questionCount, activeBrand.customQuestionCount, activeBrand.layer2Ratio, activeBrand.categoryConfig, getApiConfig])

  // Export
  const handleExportJson = useCallback(() => {
    if (!activeBrand.strategyPlan) return
    const full = { ...activeBrand.strategyPlan }
    if (activeBrand.questions.length) full.question_strategy = activeBrand.questions
    if (activeBrand.contentCalendar.length) full.content_calendar = activeBrand.contentCalendar
    const blob = new Blob([JSON.stringify(full, null, 2)], { type: "application/json" })
    downloadBlob(blob, `${activeBrand.strategyPlan.project_name || "GEO策略"}_完整方案.json`)
  }, [activeBrandId, activeBrand.strategyPlan, activeBrand.questions, activeBrand.contentCalendar])

  const handleExportMarkdown = useCallback(() => {
    if (!activeBrand.strategyPlan) return
    const md = generateMarkdown(activeBrand.strategyPlan, activeBrand.questions, activeBrand.contentCalendar)
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" })
    downloadBlob(blob, `${activeBrand.strategyPlan.project_name || "GEO策略"}_方案报告.md`)
  }, [activeBrandId, activeBrand.strategyPlan, activeBrand.questions, activeBrand.contentCalendar])

  const handleExportWord = useCallback(() => {
    if (!activeBrand.strategyPlan) return
    const html = generateWordHtml(activeBrand.strategyPlan, activeBrand.questions, activeBrand.contentCalendar)
    const blob = new Blob([html], { type: "application/msword;charset=utf-8" })
    downloadBlob(blob, `${activeBrand.strategyPlan.project_name || "GEO策略"}_方案报告.doc`)
  }, [activeBrandId, activeBrand.strategyPlan, activeBrand.questions, activeBrand.contentCalendar])

  const handleReExtract = useCallback(async () => {
    await handleExtract()
  }, [handleExtract])

  // ==================== Render ====================

  const ab = activeBrand

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 flex">
      {/* Sidebar */}
      <BrandSidebar
        open={sidebarOpen}
        brands={brandOrder.map(id => ({ id, name: brands[id].name, step: brands[id].step }))}
        activeId={activeBrandId}
        onSelect={setActiveBrandId}
        onAdd={addBrand}
        onDelete={removeBrand}
        onToggle={() => setSidebarOpen(v => !v)}
      />

      {/* Main area */}
      <div className="flex-1 min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-lg border-b border-slate-200/60 shadow-sm">
          <div className="px-4 md:px-8 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(v => !v)}
                className="text-slate-400 hover:text-slate-600 transition p-1 -ml-1"
              >
                <ChevronLeft className={`h-4 w-4 transition-transform ${sidebarOpen ? "" : "rotate-180"}`} />
              </button>
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#004B73] to-[#00B4D8] flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <div>
                <div className="text-sm font-bold tracking-tight bg-gradient-to-r from-[#004B73] to-[#0077B6] bg-clip-text text-transparent">
                  关键词策略 · GEO 策略生成工具
                </div>
                <div className="text-[10px] text-slate-400">生成式引擎优化策略方案</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400 hidden sm:block">{ab.name}</span>
              <button
                onClick={() => setShowApiSettings(v => !v)}
                className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition"
              >
                <Settings className="h-3.5 w-3.5" />
                API 设置
              </button>
            </div>
          </div>
        </header>

        {showApiSettings && (
          <ApiSettingsPanel
            provider={apiProvider}
            baseUrl={apiBaseUrl}
            model={apiModel}
            apiKey={apiKey}
            timeout={apiTimeout}
            onProviderChange={handleProviderChange}
            onBaseUrlChange={setApiBaseUrl}
            onModelChange={setApiModel}
            onApiKeyChange={setApiKey}
            onTimeoutChange={setApiTimeout}
            onClose={() => setShowApiSettings(false)}
          />
        )}

        {/* Progress Bar */}
        <div className="px-4 md:px-8 pt-4">
          <StepProgress current={ab.step} />
        </div>

        <main className="px-4 md:px-8 py-6">
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
              apiKeyConfigured={!!apiKey}
              apiModel={apiModel}
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
              layer2Ratio={ab.layer2Ratio}
              onQuestionCountChange={v => setBrandField("questionCount", v)}
              onCustomQuestionCountChange={v => setBrandField("customQuestionCount", v)}
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
    </div>
  )
}

// ==================== Brand Sidebar ====================

function BrandSidebar({ open, brands, activeId, onSelect, onAdd, onDelete, onToggle }: {
  open: boolean
  brands: { id: string; name: string; step: ToolStep }[]
  activeId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onDelete: (id: string) => void
  onToggle: () => void
}) {
  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 z-30 bg-black/20 sm:hidden" onClick={onToggle} />
      )}
      <aside className={`fixed sm:sticky top-0 z-40 sm:z-10 h-screen flex flex-col bg-white border-r border-slate-200/60 shadow-sm transition-all duration-200 ${
        open ? "translate-x-0 w-64" : "-translate-x-full sm:w-0 sm:translate-x-0 sm:overflow-hidden sm:border-0"
      }`}>
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 shrink-0">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">品牌列表</span>
          <button onClick={onToggle} className="text-slate-400 hover:text-slate-600 transition p-1 sm:hidden">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Brand list */}
        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {brands.map(b => (
            <button
              key={b.id}
              onClick={() => onSelect(b.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition text-sm ${
                b.id === activeId
                  ? "bg-[#004B73]/10 text-[#004B73] font-semibold shadow-sm"
                  : "hover:bg-slate-100 text-slate-600"
              }`}
            >
              <div className={`w-2 h-2 rounded-full shrink-0 ${
                b.step === "input" ? "bg-slate-300" :
                b.step === "extraction" ? "bg-amber-400" :
                "bg-emerald-400"
              }`} />
              <span className="truncate">{b.name}</span>
              {brands.length > 1 && (
                <button
                  onClick={e => { e.stopPropagation(); onDelete(b.id) }}
                  className="ml-auto text-slate-300 hover:text-red-400 transition p-0.5 shrink-0"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </button>
          ))}
        </div>

        {/* Add brand */}
        <div className="px-2 pb-3 shrink-0">
          <button
            onClick={onAdd}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50/30 transition text-sm"
          >
            <Plus className="h-4 w-4" />
            新增品牌
          </button>
        </div>
      </aside>
    </>
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
    <div className="flex items-center gap-1 mb-2">
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
  apiKeyConfigured, apiModel,
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
  apiKeyConfigured: boolean
  apiModel: string
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
          <div className="bg-white/70 backdrop-blur rounded-2xl border border-slate-200/60 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <CloudUpload className="h-4 w-4 text-blue-500" />
              上传资料
            </h2>
            <div
              className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileText className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-xs text-slate-500">点击上传 PDF / JPG / PNG / 文本文件</p>
              <p className="text-[10px] text-slate-400 mt-1">支持调研报告、截图、笔记等</p>
              <p className="text-[10px] text-amber-500 mt-1">⚠ 图片/PDF 需使用支持视觉识别的模型（gpt-4o、qwen-vl-plus 等），DeepSeek 不支持</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.txt,.md,.csv"
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
                      {f.type === "image" ? "图片" : f.type === "pdf" ? "PDF" : "文本"}
                    </span>
                    <button onClick={() => onRemoveFile(f.id)} className="text-slate-300 hover:text-red-400 transition">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white/70 backdrop-blur rounded-2xl border border-slate-200/60 p-5 shadow-sm">
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
          <div className="bg-white/70 backdrop-blur rounded-2xl border border-slate-200/60 p-5 shadow-sm">
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

          {uploadedFiles.some(f => f.type === "image" || f.type === "pdf") && isTextOnlyModel(apiModel) && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-xs text-amber-800 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold mb-1">当前模型不支持图片/PDF</div>
                <div><code className="bg-amber-100 px-1 rounded">{apiModel}</code> 是纯文本模型，无法识别图片和 PDF 中的内容。请将模型名改为：<code className="bg-green-100 px-1 rounded text-green-800">qwen3-vl-plus</code></div>
              </div>
            </div>
          )}

          <button
            onClick={onExtract}
            disabled={extracting || !apiKeyConfigured}
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
  profile, onProfileChange, onBack, onGenerate, generating, strategyError, reExtracting, onReExtract,
}: {
  profile: ExtractedProfile
  onProfileChange: (p: ExtractedProfile) => void
  onBack: () => void
  onGenerate: () => void
  generating: boolean
  strategyError: string
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">确认资料抽取结果</h1>
          <p className="text-xs text-slate-500 mt-1">编辑、删除或新增条目后，点击"确认并生成策略"</p>
        </div>
        <div className="flex items-center gap-2">
          {profile.source_notes && (
            <span className="text-[10px] text-slate-400">{profile.source_notes}</span>
          )}
        </div>
      </div>

      {/* Basic fields */}
      <div className="bg-white/70 backdrop-blur rounded-2xl border border-slate-200/60 p-5 shadow-sm grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        <div key={section.key} className="bg-white/70 backdrop-blur rounded-2xl border border-slate-200/60 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700">{section.label}</h2>
            <button onClick={() => addItem(section.key)}
              className="text-xs inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition">
              <Plus className="h-3 w-3" /> 新增
            </button>
          </div>
          <div className="space-y-2">
            {(profile[section.key] as ExtractedItem[]).length === 0 && (
              <p className="text-xs text-slate-400 py-2">暂无条目</p>
            )}
            {(profile[section.key] as ExtractedItem[]).map((item, i) => (
              <div key={item.id} className={`flex items-start gap-2 p-3 rounded-xl border transition ${
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

      <div className="flex items-center justify-between gap-3">
        <button onClick={onBack} className="text-sm inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition">
          <ArrowLeft className="h-4 w-4" /> 返回修改资料
        </button>
        <div className="flex items-center gap-2">
          <button onClick={onReExtract} disabled={reExtracting}
            className="text-sm inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 disabled:opacity-50 transition">
            {reExtracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            重新抽取
          </button>
          <button onClick={onGenerate} disabled={generating}
            className="text-sm inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#004B73] to-[#0077B6] text-white font-semibold hover:shadow-lg hover:shadow-blue-300/30 disabled:opacity-50 transition-all">
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
  questionCount, customQuestionCount, layer2Ratio,
  categoryConfig, onCategoryConfigChange,
  onQuestionCountChange, onCustomQuestionCountChange, onLayer2RatioChange, onGenerateQuestions,
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
  layer2Ratio: number
  categoryConfig: QuestionCategoryConfig
  onCategoryConfigChange: (cfg: QuestionCategoryConfig) => void
  onQuestionCountChange: (v: number) => void
  onCustomQuestionCountChange: (v: number) => void
  onLayer2RatioChange: (v: number) => void
  onGenerateQuestions: () => void
  onExportJson: () => void
  onExportMarkdown: () => void
  onExportWord: () => void
  onBack: () => void
  hasQuestions: boolean
}) {
  const effectiveCount = questionCount === -1 ? customQuestionCount : questionCount
  const [showJson, setShowJson] = useState(false)
  const [showCalendar, setShowCalendar] = useState(false)

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
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <ProfileField label="品牌/产品" value={plan.profile.brand_or_product} />
            <ProfileField label="行业" value={plan.profile.industry} />
            <ProfileField label="目标受众" value={plan.profile.audience} />
            <ProfileField label="产品说明" value={plan.profile.product_description} className="col-span-2 md:col-span-3" />
            <ProfileField label="商业目标" value={plan.profile.business_goals} className="col-span-2 md:col-span-3" />
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
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
        <Card title="官网优化策略" icon={<Settings className="h-4 w-4 text-indigo-500" />}>
          <div className="space-y-3">
            {plan.official_site_strategy.map((item, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 w-5 mt-0.5">#{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-700">{item.module}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{item.action}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{item.goal}</div>
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
                <div className="text-[11px] text-slate-400"><span className="font-medium text-slate-500">交叉验证：</span>{site.cross_validation_role}</div>
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
                <div key={i} className="flex items-start gap-2 text-xs p-2 rounded-lg bg-slate-50">
                  <span className="font-medium text-slate-700 w-24 shrink-0">{item.metric}</span>
                  <span className="text-slate-500 flex-1">{item.method}</span>
                  <span className="text-slate-400 text-right w-16">{item.target}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {plan.execution_roadmap && plan.execution_roadmap.length > 0 && (
          <Card title="执行排期" icon={<ArrowRight className="h-4 w-4 text-blue-500" />}>
            <div className="space-y-2">
              {plan.execution_roadmap.map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-xs p-2 rounded-lg bg-slate-50">
                  <span className="font-medium text-slate-700 w-20 shrink-0">{item.phase}</span>
                  <span className="text-slate-500 flex-1">{item.focus}</span>
                  <span className="text-slate-400 text-right max-w-[120px]">{item.deliverable}</span>
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
        {!hasQuestions ? (
          <QuestionSettingsPanel
            plan={plan}
            questionCount={questionCount}
            customQuestionCount={customQuestionCount}
            layer2Ratio={layer2Ratio}
            categoryConfig={categoryConfig}
            questionStatus={questionStatus}
            questionError={questionError}
            onQuestionCountChange={onQuestionCountChange}
            onCustomQuestionCountChange={onCustomQuestionCountChange}
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

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {questions.slice(0, showJson ? questions.length : 10).map((q, i) => (
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
  plan, questionCount, customQuestionCount, layer2Ratio, categoryConfig,
  questionStatus, questionError,
  onQuestionCountChange, onCustomQuestionCountChange, onLayer2RatioChange,
  onCategoryConfigChange, onGenerateQuestions,
}: {
  plan: GeoStrategyPlan
  questionCount: number
  customQuestionCount: number
  layer2Ratio: number
  categoryConfig: QuestionCategoryConfig
  questionStatus: GenerationStatus
  questionError: string
  onQuestionCountChange: (v: number) => void
  onCustomQuestionCountChange: (v: number) => void
  onLayer2RatioChange: (v: number) => void
  onCategoryConfigChange: (cfg: QuestionCategoryConfig) => void
  onGenerateQuestions: () => void
}) {
  const effectiveCount = questionCount === -1 ? customQuestionCount : questionCount
  const weaknesses = plan.profile?.weaknesses || []
  const weaknessTotal = weaknesses.length * categoryConfig.weaknessesPerWeakness
  const remainingForKeywords = Math.max(0, effectiveCount - weaknessTotal)
  const coreMin = Math.ceil(effectiveCount * 0.30)

  // Apply ratios to remaining (keywords portion)
  const coreAlloc = Math.floor(remainingForKeywords * categoryConfig.coreRatio)
  const secondaryAlloc = Math.floor(remainingForKeywords * categoryConfig.secondaryRatio)
  const painScenarioAlloc = remainingForKeywords - coreAlloc - secondaryAlloc

  // Validation
  const weaknessOverflow = weaknessTotal > effectiveCount
  const coreBelowMin = remainingForKeywords > 0 && coreAlloc < coreMin
  const weaknessTooHeavy = weaknessTotal > effectiveCount * 0.5

  const coreKeywords = deriveCoreKeywords(plan)

  const updateConfig = (patch: Partial<QuestionCategoryConfig>) => {
    const next = { ...categoryConfig, ...patch }
    // Clamp: core 30%-70%, secondary 5%-min(50%, 100%-core-5%)
    next.coreRatio = Math.min(0.70, Math.max(0.30, next.coreRatio))
    const maxSecondary = Math.min(0.50, 1.0 - next.coreRatio - 0.05)
    next.secondaryRatio = Math.min(maxSecondary, Math.max(0.05, next.secondaryRatio))
    onCategoryConfigChange(next)
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
              <option value={320}>320 条</option>
              <option value={-1}>自定义</option>
            </select>
          </div>
          {questionCount === -1 && (
            <div>
              <label className="text-[11px] font-medium text-slate-500">自定义数量 (最多600)</label>
              <input type="number" min={10} max={600} value={customQuestionCount}
                onChange={e => onCustomQuestionCountChange(Math.min(600, Math.max(10, Number(e.target.value) || 10)))}
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
        <h3 className="text-xs font-semibold text-slate-600">关键词分类比例（剩余 {remainingForKeywords} 条）</h3>

        {/* Core keywords */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-medium text-slate-500">
              核心关键词（品牌+地域+核心优势，≥30%总量）
            </label>
            <span className="text-[11px] font-semibold text-blue-600">{Math.round(categoryConfig.coreRatio * 100)}% → {coreAlloc} 条</span>
          </div>
          <input type="range" min={0.30} max={0.70} step={0.05} value={categoryConfig.coreRatio}
            onChange={e => updateConfig({ coreRatio: Number(e.target.value) })}
            className="w-full accent-[#0077B6]" />
          {coreKeywords.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {coreKeywords.slice(0, 6).map((kw, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">{kw}</span>
              ))}
              {coreKeywords.length > 6 && <span className="text-[10px] text-slate-400">+{coreKeywords.length - 6} 更多</span>}
            </div>
          )}
        </div>

        {/* Secondary keywords */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-medium text-slate-500">次关键词</label>
            <span className="text-[11px] font-semibold text-purple-600">{Math.round(categoryConfig.secondaryRatio * 100)}% → {secondaryAlloc} 条</span>
          </div>
          <input type="range" min={0.05} max={Math.min(0.50, 1.0 - categoryConfig.coreRatio - 0.05)} step={0.05}
            value={categoryConfig.secondaryRatio}
            onChange={e => updateConfig({ secondaryRatio: Number(e.target.value) })}
            className="w-full accent-[#7c3aed]" />
        </div>

        {/* Pain/Scenario (auto) */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-medium text-slate-400">痛点/场景关键词（自动计算）</label>
            <span className="text-[11px] text-slate-400">
              {Math.round((1.0 - categoryConfig.coreRatio - categoryConfig.secondaryRatio) * 100)}% → {painScenarioAlloc} 条
            </span>
          </div>
          <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-emerald-500 rounded-full"
              style={{ width: "100%" }} />
          </div>
        </div>
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
            <span className={`font-bold ${weaknessTotal + remainingForKeywords > effectiveCount ? "text-red-600" : "text-slate-800"}`}>
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
        disabled={questionStatus === "generating" || weaknessOverflow}
        className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white hover:shadow-lg hover:shadow-violet-300/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
        {questionStatus === "generating" ? <><Loader2 className="h-4 w-4 animate-spin" /> 生成中...</> : <><Sparkles className="h-4 w-4" /> 生成疑问句池</>}
      </button>
    </div>
  )
}

// ==================== API Settings Panel ====================

function ApiSettingsPanel({
  provider, baseUrl, model, apiKey, timeout,
  onProviderChange, onBaseUrlChange, onModelChange, onApiKeyChange, onTimeoutChange, onClose,
}: {
  provider: ApiProviderConfig
  baseUrl: string
  model: string
  apiKey: string
  timeout: number
  onProviderChange: (id: string) => void
  onBaseUrlChange: (v: string) => void
  onModelChange: (v: string) => void
  onApiKeyChange: (v: string) => void
  onTimeoutChange: (v: number) => void
  onClose: () => void
}) {
  return (
    <div className="border-b border-slate-200 bg-white/90 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700">API 设置</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="text-[11px] font-medium text-slate-500">供应商</label>
            <select value={provider.id} onChange={e => onProviderChange(e.target.value)}
              className="w-full mt-1 text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white outline-none">
              {API_PROVIDERS.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-slate-500">接口地址</label>
            <input value={baseUrl} onChange={e => onBaseUrlChange(e.target.value)}
              placeholder="https://api.openai.com"
              className="w-full mt-1 text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white/60 outline-none focus:border-blue-400 transition" />
          </div>
          <div>
            <label className="text-[11px] font-medium text-slate-500">模型名</label>
            <input value={model} onChange={e => onModelChange(e.target.value)}
              placeholder="gpt-4o"
              className="w-full mt-1 text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white/60 outline-none focus:border-blue-400 transition" />
          </div>
          <div>
            <label className="text-[11px] font-medium text-slate-500">API Key</label>
            <input value={apiKey} onChange={e => onApiKeyChange(e.target.value)}
              type="password"
              placeholder="sk-..."
              className="w-full mt-1 text-xs px-3 py-2 rounded-lg border border-slate-200 bg-white/60 outline-none focus:border-blue-400 transition" />
          </div>
          <div>
            <label className="text-[11px] font-medium text-slate-500">超时(秒) {timeout}s</label>
            <input type="range" min={60} max={1800} step={30} value={timeout}
              onChange={e => onTimeoutChange(Number(e.target.value))}
              className="w-full mt-3 accent-[#0077B6]" />
          </div>
        </div>
        <p className="text-[10px] text-slate-400 mt-2">接口地址只需填根地址，系统自动拼接 /v1/chat/completions</p>
      </div>
    </div>
  )
}

// ==================== Utility Components ====================

function Card({ title, icon, children, extra }: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  extra?: React.ReactNode
}) {
  return (
    <div className="bg-white/70 backdrop-blur rounded-2xl border border-slate-200/60 p-5 shadow-sm">
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
          <div key={i} className="flex items-start gap-2 text-xs p-2 rounded-lg bg-slate-50">
            <span className="text-[10px] font-mono text-slate-400 w-4 shrink-0">P{kw.priority}</span>
            <span className="font-medium text-slate-700 w-48 shrink-0">{kw.keyword}</span>
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
  if (plan.third_party_site_strategy?.length) {
    lines.push(`## 第三方网站策略`)
    lines.push(``)
    plan.third_party_site_strategy.forEach(s => {
      lines.push(`### ${s.suggested_name}`)
      lines.push(`- **类型**：${s.site_type}`)
      lines.push(`- **定位**：${s.positioning}`)
      lines.push(`- **内容栏目**：${s.content_pillars}`)
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

  // Third party sites
  if (plan.third_party_site_strategy?.length) {
    parts.push(`<h2>第三方网站策略</h2>`)
    plan.third_party_site_strategy.forEach(s => {
      parts.push(`<h3>${h(s.suggested_name)}</h3><table><tr><td width="100"><b>类型</b></td><td>${h(s.site_type)}</td></tr><tr><td><b>定位</b></td><td>${h(s.positioning)}</td></tr><tr><td><b>内容栏目</b></td><td>${h(s.content_pillars)}</td></tr><tr><td><b>交叉验证</b></td><td>${h(s.cross_validation_role)}</td></tr></table>`)
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
