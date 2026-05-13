// ============ Legacy (保留兼容 /api/generate) ============
export interface BrandInput {
  brandName: string
  brandSlogan: string
  industry: string
  coreAdvantages: string
  targetMetrics: string
  targetAudience: string
  competitors: string
}

export interface DomainStrategy {
  domain: string
  purpose: string
  contentStrategy: string
}

export interface KeyDataPoint {
  metric: string
  value: string
  packaging: string
}

export interface ContentAngle {
  angle: string
  intent: string
  format: string
  difficulty: string
}

export interface MediaDistribution {
  ecosystem: string
  platforms: string
  contentAdvice: string
  personaAdvice: string
}

export interface GeoStrategy {
  domainStrategy: DomainStrategy[]
  keyDataPoints: KeyDataPoint[]
  contentAngles: ContentAngle[]
  domesticMediaDistribution: MediaDistribution[]
}

export type GenerationStatus = "idle" | "generating" | "done" | "error"

// ============ 新版：多客户 + 三大模块 ============

export type ModelKey = "doubao" | "deepseek" | "qwen" | "kimi"

export interface PenetrationItem {
  question: string
  answer: string
  mentionedBrands: string[]
  topRecommended: string | null
  // 客观判分结果：盲测回答文本中是否真实出现了我方品牌（代码层 includes 匹配，忽略大小写/空格）
  hitOur: boolean
}

export type PenetrationByModel = Partial<Record<ModelKey, PenetrationItem[]>>

export interface IndustryShareItem {
  brand: string
  count: number
  ratio: number
}

export interface PerModelRate {
  model: ModelKey
  rate: number
  mentions: number
  total: number
}

export interface PenetrationAggregated {
  penetrationRate: number
  ourMentions: number
  totalSlots: number
  industryShare: IndustryShareItem[]
  ourRanking: number | null
  perModelRate: PerModelRate[]
  missedQuestions: string[]
  topCompetitors: string[]
}

export interface PenetrationResult {
  byModel: PenetrationByModel
  aggregated: PenetrationAggregated
  generatedAt: string
}

export interface DiagnosisDimensions {
  authority: number
  structure: number
  traceability: number
  coverage: number
  sentiment: number
}

export interface ModelDiagnosisItem {
  preference: string
  weakness: string
  fix: string
}

export interface Diagnosis {
  gemScore: number
  dimensions: DiagnosisDimensions
  modelDiagnosis: Record<"doubao" | "qwen" | "deepseek" | "kimi", ModelDiagnosisItem>
  generatedAt: string
}

export interface StrategyRow {
  newKeyword: string
  attackQuestion: string
  thirdPartyAngle: string
  priority: "高" | "中" | "低"
  platform: string
}

export interface WebsiteMatrixItem {
  siteType: string
  strategicIntent: string
  domainSuggestions: string[]
  contentFocus: string
}

export interface StrategyResult {
  rows: StrategyRow[]
  websiteMatrix?: WebsiteMatrixItem[]
  generatedAt: string
}

export interface Client {
  id: string
  name: string
  ourBrand: string
  industry: string
  website: string
  questions: string[]
  competitors: string[]
  selectedModels: ModelKey[]
  createdAt: string
  updatedAt: string
  penetration?: PenetrationResult
  diagnosis?: Diagnosis
  strategy?: StrategyResult
}
