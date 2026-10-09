import type { SourcePlatformCategory } from "@/types/geo-strategy"

export type PublishingPlanStatus = "draft" | "active" | "archived"
export type PublishingCustomerStage = "new_launch" | "maintenance"
export type PublishingPeriodMode = "service" | "calendar"
export type PublishingCapacityMode = "existing_accounts" | "planned_expansion"
export type PublishingContentType = "article" | "authority_article" | "video"
export type PublishingTaskStatus =
  | "planned"
  | "claimed"
  | "completed"
  | "failed"
  | "skipped"

export interface PublishingPlanSourceEvidence {
  platformKey: string
  platformName: string
  category: SourcePlatformCategory
  citationShare: number
  adoptionRate: number
  balancedAdoptionRate: number
  modelCoverage: number
  questionCoverage: number
  citationEvents: number
  domains: string[]
  evidenceUrls: string[]
  source: "penetration" | "keyword_strategy" | "manual" | "system"
}

export interface PublishingPlatformConfig {
  id: string
  platformKey: string
  platformName: string
  category: SourcePlatformCategory
  contentType: PublishingContentType
  enabled: boolean
  weightBps: number
  dailyLimitPerAccount: number
  safeUtilizationBps: number
  existingAccountCount: number
  publishUnitCostCents: number
  maxReusePlatforms: number
  evidenceScore?: number
  strategicScore?: number
  recommendationReason?: string
  sourceEvidence?: PublishingPlanSourceEvidence
}

export interface PublishingContentCostConfig {
  article: number
  authority_article: number
  video: number
}

export interface PublishingPlanInput {
  capacityMode: PublishingCapacityMode
  totalServiceFeeCents: number
  executionCostRateBps: number
  startDate: string
  endDate: string
  periodMode: PublishingPeriodMode
  customerStage: PublishingCustomerStage
  firstMonthBudgetBps: number
  firstSevenDaysBudgetBps: number
  servicePeriodWeightsBps?: number[]
  contentCreationCostsCents: PublishingContentCostConfig
  platformConfigs: PublishingPlatformConfig[]
}

export interface PublishingBudgetWindow {
  id: string
  label: string
  periodIndex: number
  startDate: string
  endDate: string
  budgetCents: number
  allocatedCostCents: number
  unallocatedCostCents: number
}

export interface PublishingPlatformQuota {
  platformKey: string
  platformName: string
  category: SourcePlatformCategory
  contentType: PublishingContentType
  weightBps: number
  publicationCount: number
  plannedCostCents: number
  peakDailyCount: number
  dailyLimitPerAccount: number
  safeUtilizationBps: number
  dailyCapacity: number
  requiredAccountCount: number
  plannedAccountCount: number
  additionalAccountCount: number
  existingAccountCount: number
  accountGap: number
  effectiveDailyLimitPerAccount: number
  capacityMode: PublishingCapacityMode
  capacityConstrained: boolean
  windowCounts: Record<string, number>
}

export interface PublishingPlanSummary {
  executionBudgetCents: number
  plannedCostCents: number
  unallocatedBudgetCents: number
  totalPublicationCount: number
  uniqueContentCount: number
  reusedPublicationCount: number
  reuseRate: number
  requiredAccountCount: number
  existingAccountCount: number
  accountGap: number
  activeDayCount: number
}

export interface PublishingContentAsset {
  id: string
  planId: string
  clientId: string
  windowId: string
  contentType: PublishingContentType
  plannedDate: string
  title?: string
  questionId?: string
  question?: string
  matchedAdvantage?: string
  promptKey?: string
  generationJobId?: string
  generatedArticleId?: string
  status: "planned" | "generating" | "ready" | "failed"
  createdAt: string
  updatedAt: string
}

export interface PublishingTaskEvidence {
  label: string
  url: string
}

export interface PublishingTask {
  id: string
  ownerUserId: string
  planId: string
  planVersion: number
  clientId: string
  assetId: string
  plannedDate: string
  platformKey: string
  platformName: string
  accountSlot: number
  status: PublishingTaskStatus
  plannedCostCents: number
  title?: string
  publishedUrl?: string
  publishedAt?: string
  evidence: PublishingTaskEvidence[]
  claimedBy?: string
  claimToken?: string
  claimExpiresAt?: string
  failureReason?: string
  executionActionId?: string
  createdAt: string
  updatedAt: string
}

export interface PublishingTaskPackage {
  task: PublishingTask
  asset: PublishingContentAsset
  platform: PublishingPlatformConfig
}

export interface PublishingPlanCalculation {
  windows: PublishingBudgetWindow[]
  platformQuotas: PublishingPlatformQuota[]
  assets: PublishingContentAsset[]
  tasks: PublishingTask[]
  summary: PublishingPlanSummary
  warnings: string[]
  calculationVersion: "publishing-plan-v1" | "publishing-plan-v2"
}

export interface PublishingPlan {
  id: string
  ownerUserId: string
  clientId: string
  clientName: string
  version: number
  status: PublishingPlanStatus
  input: PublishingPlanInput
  calculation: PublishingPlanCalculation
  sourceSnapshot: PublishingPlanSourceEvidence[]
  recommendationModel?: string
  recommendationGeneratedAt?: string
  createdByUserId: string
  createdAt: string
  updatedAt: string
  activatedAt?: string
  archivedAt?: string
}

export interface PublishingPlanRecommendation {
  platformConfigs: PublishingPlatformConfig[]
  sourceSnapshot: PublishingPlanSourceEvidence[]
  model?: string
  generatedAt: string
  usedFallback: boolean
  recommendationMode?: "ai_enhanced" | "ai_repaired" | "evidence_only"
  recommendationProvider?: string
  webEvidenceUsed?: boolean
  webSourceCount?: number
  cacheHit?: boolean
  traceId?: string
  aiCoveredPlatformCount?: number
  evidenceFilledPlatformCount?: number
  notes: string[]
}

export interface PublishingTaskListFilters {
  date?: string
  from?: string
  to?: string
  status?: PublishingTaskStatus
  platformKey?: string
  limit?: number
}
