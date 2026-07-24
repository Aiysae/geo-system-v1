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

export type WorkspaceAccountMode = "standard" | "client"
export type ClientAccountStatus = "active" | "suspended"
export type AnalysisSubjectType = "brand" | "person"

export interface PersonSubjectProfile {
  profession: string
  specialties: string[]
  organization: string
  region: string
  title: string
  credentials: string[]
  profileUrls: string[]
}

export interface WorkspaceAccountAccess {
  mode: WorkspaceAccountMode
  status: "active" | "suspended"
  clientId?: string
  clientName?: string
  monthlyCredits?: number
  canCreateClients: boolean
  canManageClientIdentity: boolean
  canRunPenetration: boolean
  canRunOtherModules: boolean
  canCreateReports: boolean
  canViewFeedbackReports: boolean
  canManageFeedbackReports: boolean
}

export type ArticlePromptKey =
  | "thirdPartyObservation"
  | "pitfallGuide"
  | "competitorComparison"
  | "industryRankingReport"
  | "handsOnComparisonReport"
  | "mediaIndustryAnalysis"
  | "clientCaseStudy"
  | "credentialsAnalysis"
  | "selectionPitfallGuide"
  | "topBrandRanking"
  | "shortVideoScript"
  | "rewrite"

export type ArticleModelProviderKey = ModelKey | "article" | `gateway:${string}`

export type ArticleRewriteBrandRole = "primary" | "featured" | "listed" | "background"

export interface ArticleRewriteBrandCandidate {
  name: string
  aliases: string[]
  role: ArticleRewriteBrandRole
  mentionCount: number
  descriptionChars: number
  blockCount: number
  headingCount: number
  tableRowCount: number
  detailSignals: string[]
  firstBlockIndex: number
  score: number
  evidence: string[]
}

export interface ArticleRewriteAnalysis {
  sourceFingerprint: string
  brands: ArticleRewriteBrandCandidate[]
  analyzedAt: string
  provider: ArticleModelProviderKey
  model: string
}

export interface ArticleRewriteBrandMapping {
  sourceBrand: string
  sourceAliases: string[]
  targetBrand: string
  materials: string
}

export interface ArticleRewriteAudit {
  mappedPairs: Array<{ sourceBrand: string; targetBrand: string }>
  protectedBrands: string[]
  repaired: boolean
  checkedAt: string
}

export type BackgroundJobKind =
  | "articleGeneration"
  | "queryGeneration"
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
  payload?: unknown
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
  modelSelectionSource?: "default" | "user"
  sourceUrl?: string
  sourceTitle?: string
  sourceMarkdown?: string
  rewriteBrand?: string
  rewriteMaterials?: string
  rewriteAnalysis?: ArticleRewriteAnalysis
  rewriteMappings?: ArticleRewriteBrandMapping[]
  rewriteAudit?: ArticleRewriteAudit
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
  publishing?: ArticlePublishingSettings
  status: GenerationStatus
  error?: string
  generatedAt?: string
}

export interface ArticlePublishingSettings {
  title?: string
  digest?: string
  tags?: string
  coverUrl?: string
  selectedPlatforms?: string[]
  publishMode?: "review" | "auto"
  original?: boolean
  allowComment?: boolean
}

export type ArticleBatchTopicMode = "auto" | "questions" | "custom"

export type ArticleBatchStatus =
  | "preparing"
  | "queued"
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "cancelled"

export type ArticleBatchItemStatus =
  | "queued"
  | "running"
  | "word_processing"
  | "succeeded"
  | "failed"
  | "cancelled"

export interface ArticleBatchItemRecord {
  id: string
  position: number
  topic: string
  brief: string
  status: ArticleBatchItemStatus
  progressPercent: number
  stage: string
  title?: string
  fileName?: string
  error?: string
  attempt: number
  similarityScore?: number
  generatedAt?: string
  updatedAt: string
}

export interface ArticleBatchRecord {
  id: string
  clientId: string
  promptKey: ArticlePromptKey
  promptTitle: string
  modelProvider: ArticleModelProviderKey
  model: string
  topicMode: ArticleBatchTopicMode
  similarityRetry: boolean
  requestedCount: number
  completedCount: number
  failedCount: number
  cancelledCount: number
  status: ArticleBatchStatus
  stage: string
  error?: string
  createdAt: string
  updatedAt: string
  finishedAt?: string
  items: ArticleBatchItemRecord[]
}

export type DifficultyLevel = "容易" | "中等" | "困难" | "超难"

export type DifficultyAssessmentMode = "industry" | "brand"

export type DifficultyGeographicScope = "city" | "province" | "region" | "national"

export type DifficultyIndustryRiskLevel =
  | "auto"
  | "standard"
  | "high_trust"
  | "regulated"
  | "strict"

export type DifficultyResolvedIndustryRiskLevel = Exclude<DifficultyIndustryRiskLevel, "auto">

export interface DifficultyCommercialInput {
  averageOrderValue?: number
  grossMarginRate?: number
  annualRepeatPurchases?: number
  riskLevel?: DifficultyIndustryRiskLevel
}

export interface DifficultyCostRange {
  min: number
  max: number
}

export interface DifficultyCostWorkload {
  articlesPerMonth: number
  authorityAssets: number
  channelCount: number
  regionalPages: number
}

export interface DifficultyLegacyCostEstimate {
  version?: "legacy-budget-v1"
  currency: "CNY"
  confidence: "高" | "中" | "低"
  validation30Days: DifficultyCostRange
  stabilization90Days: DifficultyCostRange
  scale180Days: DifficultyCostRange
  oneTimeFoundation: DifficultyCostRange
  monthlyContent: DifficultyCostRange
  authorityAssets: DifficultyCostRange
  regionalCoverage: DifficultyCostRange
  monthlyMonitoring: DifficultyCostRange
  workload: DifficultyCostWorkload
  assumptions: string[]
}

export type DifficultyCostMilestoneKey = "firstMention" | "halfStable" | "stableMention"

export interface DifficultyContentAllocation {
  total: number
  selfMediaArticles: number
  authorityMediaArticles: number
  douyinVideos: number
}

export interface DifficultyContentCostMilestone {
  key: DifficultyCostMilestoneKey
  label: string
  successDefinition: string
  days: DifficultyCostRange
  contentCount: DifficultyCostRange & { recommended: number }
  allocation: DifficultyContentAllocation
  cumulativeCost: DifficultyCostRange
  incrementalCost: DifficultyCostRange
  recommendedCost?: number
}

interface DifficultyContentCostEstimateBase {
  currency: "CNY"
  confidence: "高" | "中" | "低"
  foundationCost: number
  unitCosts: {
    selfMediaArticle: number
    authorityMediaArticle: number
    douyinVideo: number
  }
  contentRatios: {
    selfMediaArticles: number
    authorityMediaArticles: number
    douyinVideos: number
  }
  milestones: DifficultyContentCostMilestone[]
  assumptions: string[]
}

export interface DifficultyContentCostEstimateV2 extends DifficultyContentCostEstimateBase {
  version: "content-volume-v2"
}

export interface DifficultyCostScoreImpact {
  fromScore: number
  toScore: number
  contentDelta: number
  costDelta: number
}

export interface DifficultyCostLevelTransition extends DifficultyCostScoreImpact {
  fromContent: number
  toContent: number
}

export interface DifficultyCostBandDetails {
  level: DifficultyLevel
  score: number
  minScore: number
  maxScore: number
  anchorContent: number
  scoreOffset: number
  perPointGrowthRate: number
  stableContent: number
  formula: string
  nextScoreImpact?: DifficultyCostScoreImpact
  nextLevelTransition?: DifficultyCostLevelTransition
}

export interface DifficultyIndustryCostProfile {
  requestedLevel: DifficultyIndustryRiskLevel
  resolvedLevel: DifficultyResolvedIndustryRiskLevel
  label: string
  source: "manual" | "system"
  reason: string
  riskMultiplier: number
  valueMultiplier: number
  effectiveMultiplier: number
  complianceMultiplier: number
  dailyThroughput: number
  averageOrderValue?: number
  valueReason: string
}

export interface DifficultyContentCostEstimateV3 extends DifficultyContentCostEstimateBase {
  version: "content-volume-v3"
  riskPreparationCost: number
  effectiveFoundationCost: number
  baselineWeightedUnitCost: number
  effectiveWeightedUnitCost: number
  difficultyBand: DifficultyCostBandDetails
  industryProfile: DifficultyIndustryCostProfile
}

export type DifficultyContentCostEstimate =
  | DifficultyContentCostEstimateV2
  | DifficultyContentCostEstimateV3

export type DifficultyCostEstimate = DifficultyLegacyCostEstimate | DifficultyContentCostEstimate

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
  scoreVersion?: "v1" | "v2"
  mode?: DifficultyAssessmentMode
  subjectType?: AnalysisSubjectType
  personProfile?: PersonSubjectProfile
  scope?: DifficultyGeographicScope
  region?: string
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
  costEstimate?: DifficultyCostEstimate
  generatedAt: string
  providerLabel?: string
}

export interface DifficultyAssessmentEntry {
  id: string
  mode?: DifficultyAssessmentMode
  subjectType?: AnalysisSubjectType
  personProfile?: PersonSubjectProfile
  industry: string
  city: string
  scope?: DifficultyGeographicScope
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
  subjectType?: AnalysisSubjectType
  personProfile?: PersonSubjectProfile
  industry: string
  city: string
  scope?: DifficultyGeographicScope
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

export type PenetrationEntityKind = "person" | "organization" | "brand" | "product"

export interface PenetrationMentionedEntity {
  name: string
  kind: PenetrationEntityKind
  isPeer?: boolean
  profession?: string
  organization?: string
}

export interface PenetrationItem {
  /** Identifies this exact model invocation, even when the question text is repeated. */
  sampleId?: string
  sampledAt?: string
  question: string
  answer: string
  mentionedBrands: string[]
  mentionedEntities?: PenetrationMentionedEntity[]
  topRecommended: string | null
  searchSources?: PenetrationSource[]
  sourceDomains?: SourceDomainCount[]
  topSourceDomain?: SourceDomainCount | null
  searchMode?: PenetrationSearchMode
  promptPurity?: PenetrationPromptPurity
  webAttempted?: boolean
  webExecutionVerified?: boolean
  providerRequestIds?: string[]
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

export type PenetrationQuestionCategory =
  | "recommendation"
  | "pain_solution"
  | "comparison"
  | "purchase_decision"
  | "scenario_audience"
  | "brand_cognition"
  | "risk_concern"

export type PenetrationQuestionAllocationMode = "balanced" | "custom"

export type PenetrationQuestionCategoryCounts = Partial<
  Record<PenetrationQuestionCategory, number>
>

export interface PenetrationQuestionGenerationSettings {
  count: number
  keywords: string
  allocationMode: PenetrationQuestionAllocationMode
  categories: PenetrationQuestionCategory[]
  categoryCounts: PenetrationQuestionCategoryCounts
}

export interface PenetrationQuestionIntentHint {
  question: string
  category: PenetrationQuestionCategory
}

export type PenetrationSampleConfidence = "low" | "medium" | "high"

export interface PenetrationQuestionSample {
  question: string
  category: PenetrationQuestionCategory
  intentId: string
  normalizedIntent: string
}

export interface PenetrationCategorySampleCount {
  category: PenetrationQuestionCategory
  questionCount: number
  intentCount: number
}

export interface PenetrationSourceDiversity {
  citationEvents: number
  uniqueUrlCount: number
  uniqueDomainCount: number
  duplicateCitationRate: number
  maxUrlReuse: number
  topDomain: string | null
  topDomainShare: number
}

export interface PenetrationSampleQuality {
  version: 1
  score: number
  confidence: PenetrationSampleConfidence
  confidenceLabel: string
  questionCount: number
  distinctQuestionCount: number
  semanticIntentCount: number
  semanticDuplicateRate: number
  categoryCoverageCount: number
  categoryCounts: PenetrationCategorySampleCount[]
  minCategoryCount: number
  maxCategoryShare: number
  modelCount: number
  plannedSlots: number
  completedSlots: number
  completionRate: number
  sourceDiversity?: PenetrationSourceDiversity
  scopeMode?: "comprehensive" | "focused"
  scopeCategories?: PenetrationQuestionCategory[]
  warnings: string[]
}

export interface PenetrationAggregated {
  penetrationRate: number
  ourMentions: number
  totalSlots: number
  /** Total model-question slots planned before retries or provider failures. */
  plannedSlots?: number
  completionRate?: number
  /** Average hit rate after each exact question receives equal weight. */
  questionLevelRate?: number
  /** Average hit rate after semantically equivalent questions receive one shared weight. */
  intentBalancedRate?: number
  /** Average of the seven question-category rates, using covered categories only. */
  categoryBalancedRate?: number
  sampleQuality?: PenetrationSampleQuality
  industryShare: IndustryShareItem[]
  institutionShare?: IndustryShareItem[]
  ourRanking: number | null
  perModelRate: PerModelRate[]
  missedQuestions: string[]
  topCompetitors: string[]
}

export interface PenetrationResult {
  byModel: PenetrationByModel
  aggregated: PenetrationAggregated
  questionIntents?: PenetrationQuestionIntentHint[]
  generatedAt: string
}

export type PenetrationJobStatus = "queued" | "running" | "succeeded" | "blocked" | "failed" | "cancelled"
export type PenetrationJobOperation = "replace" | "append"
export type PenetrationJobPhase = "preflight" | "sampling" | "retrying" | "finalizing"
export type PenetrationQueueReason = "capacity" | "user_limit" | "retry_wait" | "queued"

export interface PenetrationModelProgress {
  total: number
  succeeded: number
  retrying: number
  blocked: number
  attempts: number
}

export interface PenetrationJobRecord {
  id: string
  clientId: string
  status: PenetrationJobStatus
  operation?: PenetrationJobOperation
  totalSlots: number
  completedSlots: number
  totalBatches: number
  completedBatches: number
  phase?: PenetrationJobPhase
  retryRound?: number
  nextRetryAt?: string
  queuePosition?: number
  queueDepth?: number
  queueReason?: PenetrationQueueReason
  totalAttempts?: number
  retryingSlots?: number
  blockedSlots?: number
  modelProgress?: Partial<Record<ModelKey, PenetrationModelProgress>>
  result?: PenetrationResult
  skipped: string[]
  modelErrors: Partial<Record<ModelKey, string>>
  error?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  historyRecordId?: string
  historySavedAt?: string
  historySavePending?: boolean
}

export type PenetrationHistoryStatus = "succeeded" | "partial" | "cancelled" | "failed"
export type PenetrationHistorySource = "job" | "workspace_backfill"

export interface PenetrationHistoryRequestSnapshot {
  clientId: string
  clientName: string
  subjectType?: AnalysisSubjectType
  personProfile?: PersonSubjectProfile
  ourBrand: string
  brandAliases: string[]
  industry: string
  website: string
  questions: string[]
  questionIntents?: PenetrationQuestionIntentHint[]
  competitors: string[]
  /** User-selected models before readiness checks. */
  models: ModelKey[]
  /** Models that actually entered independent sampling. */
  activeModels: ModelKey[]
  skippedModels: string[]
  operation: PenetrationJobOperation
}

export interface PenetrationHistoryBrandVoiceItem {
  rank: number
  brand: string
  mentions: number
  ratio: number
  penetrationRate: number
  models: ModelKey[]
  modelCount: number
  isTarget: boolean
}

export interface PenetrationHistoryKeywordCompetitionItem {
  question: string
  totalMentions: number
  participatingModels: number
  perModelMentions: Partial<Record<ModelKey, number>>
}

export interface PenetrationHistoryDashboardSnapshot {
  brandVoice: PenetrationHistoryBrandVoiceItem[]
  keywordCompetition: PenetrationHistoryKeywordCompetitionItem[]
}

export interface PenetrationHistorySummary {
  subjectType?: AnalysisSubjectType
  ourBrand: string
  industry: string
  questionCount: number
  modelCount: number
  completedSlots: number
  totalSlots: number
  penetrationRate: number | null
  sourceCount: number
  uniqueSourceCount?: number
  uniqueDomainCount?: number
  semanticIntentCount?: number
  categoryCoverageCount?: number
  balancedPenetrationRate?: number | null
  sampleConfidence?: PenetrationSampleConfidence
  completionRate?: number
}

export interface PenetrationHistoryListItem {
  id: string
  actorUserId?: string
  clientId: string
  clientName: string
  operation: PenetrationJobOperation
  status: PenetrationHistoryStatus
  source: PenetrationHistorySource
  summary: PenetrationHistorySummary
  createdAt: string
  completedAt?: string
  updatedAt: string
}

export interface PenetrationHistoryRecord extends PenetrationHistoryListItem {
  request: PenetrationHistoryRequestSnapshot
  dashboard: PenetrationHistoryDashboardSnapshot
  result?: PenetrationResult
  error?: string
  schemaVersion: number
}

export interface PenetrationHistoryListPage {
  items: PenetrationHistoryListItem[]
  page: number
  pageSize: number
  total: number
  hasMore: boolean
}

export type CommercialReportKind =
  | "combined"
  | "penetration"
  | "research"
  | "diagnosis"
  | "difficulty"
export type CommercialReportDetail = "concise" | "full"
export type CommercialReportJobStatus = "queued" | "running" | "succeeded" | "failed"
export type ReportBrandingMode = "shitu" | "custom"

export interface ReportBrandingSettings {
  mode: ReportBrandingMode
  companyName: string
  website: string
  logoDataUrl?: string
}

export interface ReportExportPreset {
  kind?: CommercialReportKind
  difficultyEntryId?: string
}

export interface CommercialReportInput {
  kind: CommercialReportKind
  detail: CommercialReportDetail
  branding?: ReportBrandingSettings
  client: {
    id: string
    name: string
    subjectType?: AnalysisSubjectType
    personProfile?: PersonSubjectProfile
    ourBrand: string
    brandAliases: string[]
    industry: string
    website: string
  }
  penetration?: PenetrationResult
  research?: ResearchResult
  competitorCompare?: CompetitorCompareResult
  diagnosis?: Diagnosis
  difficulty?: DifficultyAssessmentEntry
}

export interface CommercialReportJobRecord {
  id: string
  clientId: string
  clientName?: string
  kind: CommercialReportKind
  detail: CommercialReportDetail
  brandingMode?: ReportBrandingMode
  publisherName?: string
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
  fileAvailable?: boolean
  creditCost?: number
  creditsRefunded?: boolean
}

export type MembershipTier = "free" | "vip1" | "vip2" | "vip3" | "vip4" | "vip5" | "vip6"
export type MembershipSource = "payment" | "admin"

export interface MembershipSnapshot {
  tier: MembershipTier
  active: boolean
  source?: MembershipSource
  sourceOrderId?: string
  activatedAt?: number
  paidCents: number
  qualifyingOrderCount: number
  nextTier?: Exclude<MembershipTier, "free">
  nextTierPaidCents?: number
  amountToNextTierCents?: number
  clientAccountLimit: number
}

export interface ReportBrandingAccess {
  membership: MembershipSnapshot
  canUseCustomBranding: boolean
  accessSource: "admin" | "membership" | "none"
  customReportCredits: number
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

export type GeoAuditCheckStatus = "pass" | "warning" | "fail" | "not_applicable"

export type GeoAuditCategory =
  | "crawlability"
  | "discoverability"
  | "contentStructure"
  | "structuredData"
  | "trust"
  | "aiReadability"

export interface GeoAuditCheck {
  id: string
  category: GeoAuditCategory
  label: string
  status: GeoAuditCheckStatus
  score: number
  maxScore: number
  summary: string
  evidence: string[]
  urls: string[]
  recommendation: string
  priority: "P0" | "P1" | "P2"
}

export interface GeoAuditDimension {
  key: GeoAuditCategory
  label: string
  score: number
  maxScore: number
}

export interface GeoAuditResource {
  kind: "robots" | "sitemap" | "llms"
  url: string
  status?: number
  available: boolean
  valid: boolean
  summary: string
  error?: string
}

export interface GeoAuditBotPolicy {
  key: "generic" | "oaiSearch" | "gptBot" | "googlebot" | "claudeBot" | "bytespider"
  label: string
  userAgent: string
  status: "allowed" | "blocked" | "unknown"
  explicit: boolean
  matchingLine?: number
  note: string
}

export interface GeoAuditPage {
  url: string
  finalUrl: string
  status: number
  title: string
  description: string
  language: string
  canonical: string
  robotsMeta: string
  xRobotsTag: string
  wordCount: number
  textLength: number
  leadText: string
  h1: string[]
  h2: string[]
  h3: string[]
  headingLevelSkips: number
  visibleQuestionCount: number
  structuredDataTypes: string[]
  structuredDataErrors: number
  entityNames: string[]
  authorSignals: string[]
  credentialSignals: string[]
  dateSignals: string[]
  trustLinks: string[]
  internalLinkCount: number
  externalCitationCount: number
  semanticLandmarks: string[]
  jsShellRisk: boolean
  loadTimeMs: number
  error?: string
}

export interface GeoAuditAiSummary {
  executiveSummary: string
  strengths: string[]
  risks: string[]
  actions: string[]
  generatedBy?: string
}

export interface WebsiteGeoAudit {
  version: 2
  requestUrl: string
  finalUrl: string
  auditedAt: string
  durationMs: number
  pagesRequested: number
  pagesFetched: number
  confidence: "high" | "medium" | "low"
  confidenceLabel: string
  resources: GeoAuditResource[]
  botPolicies: GeoAuditBotPolicy[]
  pages: GeoAuditPage[]
  checks: GeoAuditCheck[]
  dimensions: GeoAuditDimension[]
  score: number
  aiSummary: GeoAuditAiSummary
}

export interface Diagnosis {
  version?: 1 | 2
  gemScore: number
  dimensions: DiagnosisDimensions
  modelDiagnosis: Record<"doubao" | "qwen" | "deepseek" | "kimi", ModelDiagnosisItem>
  audit?: WebsiteGeoAudit
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
  subjectType: AnalysisSubjectType
  personProfile?: PersonSubjectProfile
  ourBrand: string
  brandAliases?: string[]
  industry: string
  website: string
  questions: string[]
  questionGenerationSettings?: PenetrationQuestionGenerationSettings
  questionIntentHints?: PenetrationQuestionIntentHint[]
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
