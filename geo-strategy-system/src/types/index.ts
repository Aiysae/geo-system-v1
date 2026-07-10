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

export type ArticlePromptKey =
  | "thirdPartyObservation"
  | "pitfallGuide"
  | "competitorComparison"
  | "shortVideoScript"
  | "rewrite"

export type ArticleModelProviderKey = ModelKey | "article"

export type BackgroundJobKind =
  | "articleGeneration"
  | "research"
  | "diagnosis"
  | "competitorCompare"
  | "keywordExtract"
  | "keywordAdvantages"
  | "keywordStrategy"
  | "keywordWebsitePrompt"

export type BackgroundJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled"

export interface BackgroundJobRef {
  requestId: string
  jobId?: string
}

export interface BackgroundJobRecord<TResult = unknown> {
  id: string
  kind: BackgroundJobKind
  clientId: string
  requestId: string
  status: BackgroundJobStatus
  progressPercent: number
  stage: string
  result?: TResult
  error?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  creditsRefunded?: boolean
}

export interface ArticleGenerationState {
  promptKey: ArticlePromptKey
  modelProvider: ArticleModelProviderKey
  model: string
  sourceUrl?: string
  sourceTitle?: string
  sourceMarkdown?: string
  rewriteBrand?: string
  rewriteMaterials?: string
  extractStatus?: GenerationStatus
  extractError?: string
  coreQuestion: string
  keywords: string
  region: string
  business: string
  advantages: string
  audience: string
  extraRequirements: string
  output: string
  status: GenerationStatus
  error?: string
  generatedAt?: string
}

export type DifficultyLevel = "容易" | "中等" | "困难" | "超难"

export type DifficultyAssessmentMode = "industry" | "brand"

export type DifficultyStageKey =
  | "research"
  | "comparison"
  | "scoring"
  | "review"
  | "report"

export interface DifficultyStageOutput {
  title: string
  summary: string
  evidence: string[]
  tags: string[]
}

export type DifficultyProcess = Record<DifficultyStageKey, DifficultyStageOutput>

export interface DifficultyDimensionResult {
  name: string
  score: number
  max: number
  level: DifficultyLevel
  analysis: string
}

export interface DifficultyAssessmentResult {
  mode?: DifficultyAssessmentMode
  targetBrand?: string
  website?: string
  totalScore: number
  level: DifficultyLevel
  stableMentionPeriod: string
  summary: string
  dimensions: Record<string, DifficultyDimensionResult>
  insights: string[]
  suggestions: string[]
  process: DifficultyProcess
  generatedAt: string
  providerLabel?: string
}

export interface DifficultyAssessmentEntry {
  id: string
  mode?: DifficultyAssessmentMode
  industry: string
  city: string
  targetBrand?: string
  website?: string
  source: string
  createdAt: string
  result: DifficultyAssessmentResult
}

export type DifficultyModelSelection = "auto" | ModelKey

export type DifficultyJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled"

export interface DifficultyJobRecord {
  id: string
  clientId: string
  status: DifficultyJobStatus
  mode: DifficultyAssessmentMode
  industry: string
  city: string
  targetBrand?: string
  website?: string
  requestedModel: DifficultyModelSelection
  currentModel?: ModelKey
  currentStage?: DifficultyStageKey
  completedStages: number
  totalStages: number
  progressPercent: number
  attempts: number
  stageModels: Partial<Record<DifficultyStageKey, ModelKey>>
  modelErrors: Partial<Record<ModelKey, string>>
  result?: DifficultyAssessmentResult
  error?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  creditsRefunded?: boolean
}

export interface PenetrationSource {
  title: string
  snippet: string
  url: string
  domain: string
  query: string
}

export interface SourceDomainCount {
  domain: string
  count: number
}

export type PenetrationSearchMode =
  | "native_web"
  | "local_tool_search"
  | "presearch_context"
  | "none"

export type PenetrationPromptPurity =
  | "raw_question_only"
  | "tool_augmented"
  | "search_context_augmented"
  | "unknown"

export interface PenetrationItem {
  question: string
  answer: string
  mentionedBrands: string[]
  topRecommended: string | null
  searchSources?: PenetrationSource[]
  sourceDomains?: SourceDomainCount[]
  topSourceDomain?: SourceDomainCount | null
  searchMode?: PenetrationSearchMode
  promptPurity?: PenetrationPromptPurity
  webAttempted?: boolean
  searchQueries?: string[]
  webFailureReason?: string | null
  sourceCount?: number
  webVerified?: boolean
  webVerificationNote?: string
  // 客观判分结果：盲测回答中是否出现我方全称，或出现经原文字面校验的同品牌简称/别名。
  hitOur: boolean
}

export type PenetrationByModel = Partial<Record<ModelKey, PenetrationItem[]>>

export interface IndustryShareItem {
  brand: string
  count: number
  ratio: number
  penetrationRate: number
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

export type PenetrationJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled"

export interface PenetrationJobRecord {
  id: string
  clientId: string
  status: PenetrationJobStatus
  totalSlots: number
  completedSlots: number
  totalBatches: number
  completedBatches: number
  result?: PenetrationResult
  skipped: string[]
  modelErrors: Partial<Record<ModelKey, string>>
  error?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
}

export type CommercialReportKind = "combined" | "penetration" | "difficulty"
export type CommercialReportDetail = "concise" | "full"
export type CommercialReportJobStatus = "queued" | "running" | "succeeded" | "failed"

export interface ReportExportPreset {
  kind?: CommercialReportKind
  difficultyEntryId?: string
}

export interface CommercialReportInput {
  kind: CommercialReportKind
  detail: CommercialReportDetail
  client: {
    id: string
    name: string
    ourBrand: string
    brandAliases: string[]
    industry: string
    website: string
  }
  penetration?: PenetrationResult
  difficulty?: DifficultyAssessmentEntry
}

export interface CommercialReportJobRecord {
  id: string
  clientId: string
  kind: CommercialReportKind
  detail: CommercialReportDetail
  status: CommercialReportJobStatus
  progress: number
  stage: string
  fileName?: string
  fileSize?: number
  error?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  expiresAt: string
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
  brandAliases?: string[]
  industry: string
  website: string
  questions: string[]
  competitors: string[]
  selectedModels: ModelKey[]
  createdAt: string
  updatedAt: string
  penetration?: PenetrationResult
  penetrationJobId?: string
  research?: ResearchResult
  competitorCompare?: CompetitorCompareResult
  researchSourceMode?: ResearchSourceMode
  researchManualInput?: ResearchManualInput
  competitorCompareSourceMode?: CompetitorCompareSourceMode
  competitorCompareCustomCompetitors?: string[]
  competitorCompareSelectedCompetitors?: string[]
  diagnosis?: Diagnosis
  keywordStrategy?: KeywordStrategyState
  articleGeneration?: ArticleGenerationState
  difficultyAssessments?: DifficultyAssessmentEntry[]
  difficultyJobId?: string
  backgroundJobs?: Partial<Record<BackgroundJobKind, BackgroundJobRef>>
}
