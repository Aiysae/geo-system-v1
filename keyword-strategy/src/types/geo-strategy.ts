// ============ GEO 策略生成工具 - 类型定义 ============

/** API 供应商配置 */
export interface ApiProviderConfig {
  id: string
  label: string
  baseUrl: string
  defaultModel: string
  chatPath: string
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
  suggested_channel: string
}

/** 内容日历 */
export interface ContentCalendarItem {
  week: string
  platform: string
  question: string
  article_title: string
  content_type: string
  geo_goal: string
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
  content_calendar?: ContentCalendarItem[]
}

/** 上传文件信息 */
export interface UploadedFile {
  id: string
  name: string
  type: "pdf" | "image" | "text"
  content: string
  size: number
}

/** 整体流程状态 */
export type ToolStep = "input" | "extraction" | "strategy" | "questions" | "export"

export type GenerationStatus = "idle" | "generating" | "done" | "error"

/** 疑问句生成分类配置 */
export interface QuestionCategoryConfig {
  /** 每个劣势生成的问题数量 (5-30, 默认 10) */
  weaknessesPerWeakness: number
  /** 核心关键词占比 (0.30-0.70, 默认 0.30) */
  coreRatio: number
  /** 次关键词占比 (0.05-0.50, 默认 0.35)，痛点/场景占比自动计算 */
  secondaryRatio: number
}

export const DEFAULT_CATEGORY_CONFIG: QuestionCategoryConfig = {
  weaknessesPerWeakness: 10,
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
