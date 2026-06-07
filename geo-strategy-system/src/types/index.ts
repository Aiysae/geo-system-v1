// ============ Legacy (保留兼容 /api/generate) ============
import type { KeywordStrategyState } from "./geo-strategy"

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

export type ModelKey = "doubao" | "deepseek" | "qwen" | "kimi" | "ernie" | "hunyuan"

export type LlmMode = "consumer" | "judge"

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

export type ResearchMode = "hypothesis" | "ai"

export type ResearchSourceMode = "module" | "manual"

export interface ResearchManualInput {
  region: string
  industry: string
  fullName: string
  aliases: string
}

export interface ResearchDimension {
  name: string
  score: number
  insight: string
  evidence: string[]
}

export interface ResearchResult {
  mode: ResearchMode
  sourceMode?: ResearchSourceMode
  hypothesis?: string
  region?: string
  aliases?: string[]
  executiveSummary: string
  brandImage: string
  modelMentality: string
  dimensions: ResearchDimension[]
  audiencePerception: string[]
  trustSignals: string[]
  evidenceGaps: string[]
  risks: string[]
  opportunities: string[]
  recommendations: string[]
  generatedAt: string
}

export type CompetitorCompareSourceMode = "module" | "manual"

export interface CompetitorComparison {
  competitor: string
  positioningSummary: string
  ourAdvantages: string[]
  competitorAdvantages: string[]
  ourWeaknesses: string[]
  competitorWeaknesses: string[]
  differentiators: string[]
  userChoiceDrivers: string[]
  contentActions: string[]
}

export interface CompetitorCompareResult extends CompetitorComparison {
  selectedCompetitors?: string[]
  comparisons?: CompetitorComparison[]
  ourWeaknessSummary?: string[]
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
  research?: ResearchResult
  competitorCompare?: CompetitorCompareResult
  researchSourceMode?: ResearchSourceMode
  researchManualInput?: ResearchManualInput
  competitorCompareSourceMode?: CompetitorCompareSourceMode
  competitorCompareCustomCompetitors?: string[]
  competitorCompareSelectedCompetitors?: string[]
  diagnosis?: Diagnosis
  keywordStrategy?: KeywordStrategyState
}
