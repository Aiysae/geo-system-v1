// ============ GEO 策略生成工具 - 类型定义 ============

/** API 供应商配置 */
export interface ApiProviderConfig {
  id: string
  label: string
  baseUrl: string
  defaultModel: string
  chatPath: string
}

/** 迁入到主系统后，按客户保存的关键词策略工作台状态 */
export interface KeywordStrategyState {
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

/** 基础项目信息 */
export interface ProjectInfo {
  project_name: string
  industry: string
  audience: string
  location_terms: string[]
  product_description: string
  core_advantages: string
  pain_points_raw: string
  competitors_raw: string
  geo_goals: string
}

/** 抽取后的客户资料 */
export interface ExtractedProfile {
  project_name: string
  industry: string
  audience: string
  product_description: string
  pain_points: ExtractedItem[]
  advantages: ExtractedItem[]
  weaknesses: ExtractedItem[]
  competitors: ExtractedItem[]
  scenes: ExtractedItem[]
  geo_goals: string
  source_notes: string
}

/** 可编辑的条目 */
export interface ExtractedItem {
  id: string
  text: string
  enabled: boolean
  confidence: "high" | "medium" | "low"
}

/** 关键词条目 */
export interface KeywordItem {
  priority: string
  keyword: string
  logic: string
}

/** 官网策略条目 */
export interface OfficialSiteAction {
  module: string
  action: string
  goal: string
}

/** 第三方网站策略 */
export interface ThirdPartySite {
  priority: string
  site_type: string
  suggested_name: string
  positioning: string
  content_pillars: string
  weakness_conversion?: string
  cross_validation_role: string
}

/** 自媒体计划 */
export interface MediaPlanItem {
  platform: string
  role: string
  keyword_focus: string
  sample_title: string
  cadence: string
}

/** 复盘指标 */
export interface GeoMonitoringItem {
  metric: string
  method: string
  target: string
}

/** 执行排期 */
export interface ExecutionPhase {
  phase: string
  focus: string
  deliverable: string
}

/** 疑问句条目 */
export interface QuestionItem {
  id: string
  layer: "第一层" | "第二层"
  category: string
  difficulty: string
  keyword: string
  question: string
  intent: string
  content_angle: string
}

/** 完整策略方案 */
export interface GeoStrategyPlan {
  project_name: string
  summary: string
  profile: {
    brand_or_product: string
    industry: string
    audience: string
    product_description: string
    business_goals: string
    competitors: string[]
    terms: string[]
    pain_points: string[]
    advantages: string[]
    weaknesses: string[]
    scenes: string[]
  }
  keyword_strategy: {
    core_keywords: KeywordItem[]
    pain_advantage_keywords: KeywordItem[]
    weakness_conversion_keywords: KeywordItem[]
    scenario_keywords: KeywordItem[]
  }
  official_site_strategy: OfficialSiteAction[]
  third_party_site_strategy: ThirdPartySite[]
  media_plan: MediaPlanItem[]
  geo_monitoring_plan: GeoMonitoringItem[]
  execution_roadmap: ExecutionPhase[]
  question_strategy?: QuestionItem[]
}

/** 上传文件信息 */
export interface UploadedFile {
  id: string
  name: string
  type: "pdf" | "image" | "text" | "word" | "excel"
  content: string
  size: number
}

/** 整体流程状态 */
export type ToolStep = "input" | "extraction" | "strategy" | "questions" | "export"

export type GenerationStatus = "idle" | "generating" | "done" | "error"

export type QuestionJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled"

export interface QuestionJobProgress {
  completedCount: number
  totalCount: number
  currentBatch: number
  totalBatches: number
}

export interface QuestionJobRecord extends QuestionJobProgress {
  id: string
  status: QuestionJobStatus
  completedBatches: number
  questions: QuestionItem[]
  warnings: string[]
  error?: string
  createdAt: string
  updatedAt: string
  finishedAt?: string
}

/** 疑问句生成可选模型供应商 */
export type QuestionModelProvider = "qwen" | "doubao"

export interface QuestionModelOption {
  model: string
  label: string
  description: string
}

export const QUESTION_MODEL_OPTIONS_LAST_VERIFIED = "2026-06-14"

export const QUESTION_MODEL_PROVIDER_LABELS: Record<QuestionModelProvider, string> = {
  qwen: "通义千问",
  doubao: "豆包",
}

export const QUESTION_MODEL_OPTIONS: Record<QuestionModelProvider, QuestionModelOption[]> = {
  qwen: [
    {
      model: "qwen3-max",
      label: "Qwen3 Max",
      description: "千问通用文本旗舰稳定别名，当前指向 qwen3-max-2026-01-23。",
    },
    {
      model: "qwen3-max-2026-01-23",
      label: "Qwen3 Max 2026-01-23",
      description: "千问旗舰固定快照，便于复现同一批生成效果。",
    },
    {
      model: "qwen3-max-preview",
      label: "Qwen3 Max Preview",
      description: "千问旗舰预览版，适合想尝试预览能力的生成任务。",
    },
    {
      model: "qwen-plus-latest",
      label: "Qwen Plus Latest",
      description: "千问 Plus 最新别名，适合较大批量的性价比生成。",
    },
  ],
  doubao: [
    {
      model: "doubao-seed-2-0-pro-260215",
      label: "Doubao Seed 2.0 Pro",
      description: "豆包 Seed 2.0 Pro，适合高质量疑问句生成。",
    },
    {
      model: "doubao-seed-2-0-lite-260428",
      label: "Doubao Seed 2.0 Lite",
      description: "豆包 Seed 2.0 Lite，适合较大批量快速生成。",
    },
    {
      model: "doubao-seed-2-0-mini-260428",
      label: "Doubao Seed 2.0 Mini",
      description: "豆包 Seed 2.0 Mini，适合低成本批量补充。",
    },
  ],
}

export const DEFAULT_QUESTION_MODEL_PROVIDER: QuestionModelProvider = "qwen"

export function getDefaultQuestionModel(provider: QuestionModelProvider): string {
  return QUESTION_MODEL_OPTIONS[provider][0]?.model || ""
}

export function normalizeQuestionModelProvider(value: unknown): QuestionModelProvider {
  return value === "doubao" ? "doubao" : "qwen"
}

export function normalizeQuestionModel(
  provider: QuestionModelProvider,
  value: unknown,
): string {
  const model = typeof value === "string" ? value.trim() : ""
  const options = QUESTION_MODEL_OPTIONS[provider]
  return options.some(option => option.model === model)
    ? model
    : getDefaultQuestionModel(provider)
}

/** 疑问句生成分类配置 */
export interface QuestionCategoryConfig {
  /** 每个劣势生成的问题数量 (5-30, 默认 10) */
  weaknessesPerWeakness: number
  /** 是否生成关键词问题 */
  keywordEnabled?: boolean
  /** 是否生成劣势转化问题 */
  weaknessEnabled?: boolean
  /** 是否生成痛点/场景问题 */
  painScenarioEnabled?: boolean
  /** 关键词数量模式 */
  keywordCountMode?: "system" | "custom"
  /** 劣势数量模式 */
  weaknessCountMode?: "system" | "custom"
  /** 痛点/场景数量模式 */
  painScenarioCountMode?: "system" | "custom"
  /** 关键词来源 */
  keywordSource?: "system" | "custom"
  /** 痛点/场景来源 */
  painScenarioSource?: "system" | "custom"
  /** 自定义关键词问题数 */
  keywordCount?: number
  /** 自定义劣势转化问题数 */
  weaknessCount?: number
  /** 关键词分类分配模式：按比例或自定义精确数量 */
  allocationMode?: "ratio" | "custom"
  /** 核心关键词占比 (0.30-0.70, 默认 0.30) */
  coreRatio: number
  /** 次关键词占比 (0.05-0.50, 默认 0.35)，痛点/场景占比自动计算 */
  secondaryRatio: number
  /** 自定义核心关键词问题数 */
  coreCount?: number
  /** 自定义次关键词问题数 */
  secondaryCount?: number
  /** 自定义痛点/场景关键词问题数 */
  painScenarioCount?: number
}

export const DEFAULT_CATEGORY_CONFIG: QuestionCategoryConfig = {
  weaknessesPerWeakness: 10,
  keywordEnabled: true,
  weaknessEnabled: true,
  painScenarioEnabled: true,
  keywordCountMode: "system",
  weaknessCountMode: "system",
  painScenarioCountMode: "system",
  keywordSource: "system",
  painScenarioSource: "system",
  keywordCount: 20,
  weaknessCount: 10,
  painScenarioCount: 10,
  allocationMode: "ratio",
  coreRatio: 0.30,
  secondaryRatio: 0.35,
}

/** 服务端计算后的类别分配 */
export interface CategoryAllocation {
  category: "weakness_spin" | "core_keywords" | "secondary_keywords" | "pain_scenario"
  count: number
  keywords: string[]
  weaknesses?: string[]
}

/** API 供应商列表 */
export const API_PROVIDERS: ApiProviderConfig[] = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com", defaultModel: "gpt-4o-mini", chatPath: "/v1/chat/completions" },
  { id: "bai", label: "B.AI", baseUrl: "https://api.b.ai", defaultModel: "gpt-4o-mini", chatPath: "/v1/chat/completions" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com", defaultModel: "deepseek-chat", chatPath: "/v1/chat/completions" },
  { id: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com", defaultModel: "claude-sonnet-4-6", chatPath: "/v1/messages" },
  { id: "dashscope", label: "通义千问 DashScope", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode", defaultModel: "qwen3-vl-plus", chatPath: "/v1/chat/completions" },
  { id: "moonshot", label: "Moonshot Kimi", baseUrl: "https://api.moonshot.cn", defaultModel: "moonshot-v1-8k", chatPath: "/v1/chat/completions" },
  { id: "glm", label: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas", defaultModel: "glm-4v", chatPath: "/v4/chat/completions" },
  { id: "siliconflow", label: "硅基流动", baseUrl: "https://api.siliconflow.cn", defaultModel: "Qwen/Qwen2.5-VL-72B-Instruct", chatPath: "/v1/chat/completions" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api", defaultModel: "openai/gpt-4o-mini", chatPath: "/v1/chat/completions" },
  { id: "custom", label: "自定义(OpenAI兼容)", baseUrl: "", defaultModel: "", chatPath: "/v1/chat/completions" },
]
