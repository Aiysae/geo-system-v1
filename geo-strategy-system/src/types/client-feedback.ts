export type ClientExecutionPeriodMode = "service" | "calendar"
export type ClientFeedbackReportType = "weekly" | "monthly"
export type ClientFeedbackReportStatus = "draft" | "published"
export type ClientExecutionActionSource = "manual" | "system"
export type ClientExecutionActionStatus = "planned" | "completed"
export type ClientExecutionActionVisibility = "client" | "internal"
export type ClientExecutionActionPublication = "internal" | "summary" | "full"

export interface ClientExecutionResultRef {
  module: "penetration"
  resourceType: "history"
  resourceId: string
}

export type ClientExecutionStage =
  | "baseline"
  | "foundation"
  | "initial_mention"
  | "coverage_growth"
  | "stable_mention"
  | "continuous_optimization"

export type ClientExecutionActionCategory =
  | "penetration_check"
  | "content_production"
  | "self_media_publish"
  | "authority_media_publish"
  | "video_publish"
  | "website_optimization"
  | "strategy_adjustment"
  | "client_communication"
  | "other"

export interface ClientExecutionProfile {
  version: 1
  ownerUserId: string
  clientId: string
  startDate: string
  timezone: "Asia/Shanghai"
  periodMode: ClientExecutionPeriodMode
  currentStage: ClientExecutionStage
  stageProgress: number
  projectOwner: string
  expectedDurationDays?: number
  nextPlan: string[]
  updatedAt: string
  updatedByUserId: string
}

export interface ClientExecutionEvidence {
  label: string
  url: string
}

export interface ClientExecutionContentTrace {
  generationId: string
  promptKey: string
  primarySubject: string
  comparisonSubjects: string[]
  questionId?: string
  coreQuestion: string
  questionIntent?: string
  questionSubIntent?: string
  questionCategory?: string
  questionKeyword?: string
  matchedAdvantage?: string
  methodologyVersion: string
  methodKey: string
  articleFormat?: string
  targetPlatform: string
  brandLayout: string
  titleStrategy: string
  knowledgeAssetIds: string[]
  knowledgeClaimIds?: string[]
  knowledgeSourceIds?: string[]
  knowledgeBaseRevision?: number
  recipeVersion?: string
  modelProvider: string
  model: string
  contentPipelineVersion?: string
  deterministicQualityScore?: number
  semanticQualityScore?: number
  qualityRepaired?: boolean
}

export interface ClientExecutionAction {
  id: string
  ownerUserId: string
  clientId: string
  category: ClientExecutionActionCategory
  source: ClientExecutionActionSource
  status: ClientExecutionActionStatus
  visibility: ClientExecutionActionVisibility
  title: string
  description: string
  occurredAt: string
  quantity?: number
  unit?: string
  platform?: string
  evidence: ClientExecutionEvidence[]
  sourceRecordId?: string
  contentTrace?: ClientExecutionContentTrace
  resultRef?: ClientExecutionResultRef
  publication?: ClientExecutionActionPublication
  importBatchId?: string
  importedFrom?: "url_batch"
  createdByUserId: string
  createdAt: string
  updatedAt: string
}

export type ClientExecutionActionDetailKind =
  | "publication"
  | "general"

export interface ClientExecutionActionDetailEvidence extends ClientExecutionEvidence {
  actionId: string
  platform?: string
  occurredAt: string
}

export interface ClientExecutionActionDetailPlatform {
  name: string
  count: number
}

export interface ClientExecutionActionDetail {
  kind: ClientExecutionActionDetailKind
  clientId: string
  clientName: string
  teamId?: string
  accessMode: "standard" | "client"
  action: ClientExecutionAction
  relatedActions: ClientExecutionAction[]
  evidence: ClientExecutionActionDetailEvidence[]
  platforms: ClientExecutionActionDetailPlatform[]
  itemCount: number
  totalQuantity: number
  unit: string
}

export interface ClientExecutionPublicationOverride {
  publication: ClientExecutionActionPublication
  updatedAt: string
  updatedByUserId: string
}

export interface ClientExecutionPublicationPolicy {
  version: 1
  ownerUserId: string
  clientId: string
  defaultPenetration: ClientExecutionActionPublication
  overrides: Record<string, ClientExecutionPublicationOverride>
  updatedAt: string
  updatedByUserId: string
}

export interface ClientEvidenceImportRowInput {
  title: string
  url: string
  platform?: string
}

export interface ClientEvidenceImportDefaults {
  category: ClientExecutionActionCategory
  status: ClientExecutionActionStatus
  visibility: ClientExecutionActionVisibility
  occurredDate: string
  description?: string
}

export interface ClientEvidenceImportSkippedRow {
  rowNumber: number
  title: string
  url: string
  reason: "duplicate_existing" | "duplicate_batch"
}

export interface ClientEvidenceImportResult {
  importId: string
  created: ClientExecutionAction[]
  skipped: ClientEvidenceImportSkippedRow[]
  createdCount: number
  skippedCount: number
}

export interface ClientFeedbackMetricSnapshot {
  penetrationRate: number | null
  balancedPenetrationRate: number | null
  modelCount: number
  questionCount: number
  completedSlots: number
  totalSlots: number
  sourceCount: number
  uniqueSourceCount: number
  uniqueDomainCount: number
  sampleConfidence?: "low" | "medium" | "high"
  completedAt?: string
  historyRecordId?: string
}

export type ClientFeedbackMetricSelectionMode = "automatic" | "manual"

export interface ClientFeedbackMetricOption extends ClientFeedbackMetricSnapshot {
  historyRecordId: string
  status: "succeeded" | "partial"
  operation: "replace" | "append"
  subjectName: string
  completedAt: string
}

export interface ClientFeedbackMetricComparison {
  baseline: ClientFeedbackMetricSnapshot | null
  current: ClientFeedbackMetricSnapshot | null
  baselineSelectionMode?: ClientFeedbackMetricSelectionMode
  currentSelectionMode?: ClientFeedbackMetricSelectionMode
  comparable: boolean
  comparabilityNote: string
  penetrationDelta: number | null
  balancedPenetrationDelta: number | null
  sourceDelta: number | null
  domainDelta: number | null
}

export interface ClientFeedbackReportSnapshot {
  clientName: string
  subjectName: string
  industry: string
  projectStartDate?: string
  reportTitle: string
  generatedAt: string
  dataCutoffAt: string
  executionDay: number
  serviceWeek: number
  serviceMonth: number
  currentStage: ClientExecutionStage
  stageProgress: number
  projectOwner: string
  executiveSummary: string[]
  actions: ClientExecutionAction[]
  comparison: ClientFeedbackMetricComparison
  contentAttribution?: ClientFeedbackContentAttribution
  nextPlan: string[]
  evidenceRecordCount: number
}

export interface ClientFeedbackContentAttribution {
  generatedArticleCount: number
  coveredQuestionCount: number
  evidenceLinkedArticleCount: number
  knowledgeAssetUseCount: number
  platformCounts: Array<{
    platform: string
    count: number
  }>
}

export interface ClientFeedbackReport {
  id: string
  ownerUserId: string
  clientId: string
  type: ClientFeedbackReportType
  status: ClientFeedbackReportStatus
  periodIndex: number
  periodStart: string
  periodEnd: string
  version: number
  snapshot: ClientFeedbackReportSnapshot
  shareTokenHash?: string
  shareEnabled: boolean
  publishedAt?: string
  publishedByUserId?: string
  createdAt: string
  createdByUserId: string
  updatedAt: string
}

export interface ClientFeedbackPeriod {
  type: ClientFeedbackReportType
  index: number
  start: string
  end: string
  label: string
}

export interface ClientFeedbackReportOptions {
  period: ClientFeedbackPeriod
  metrics: ClientFeedbackMetricOption[]
  suggestedBaselineHistoryRecordId?: string
  suggestedCurrentHistoryRecordId?: string
  truncated: boolean
}
