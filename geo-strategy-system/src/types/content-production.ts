import type {
  ArticleBatchItemStatus,
  ArticleBatchQualityStatus,
  ArticleModelProviderKey,
  ArticlePromptKey,
  GeoContentPlatform,
} from "@/types"
import type { PublishingContentType } from "@/types/publishing-plan"

export type ContentProductionRunStatus =
  | "preparing"
  | "queued"
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "cancelled"

export type ContentProductionItemStatus =
  | "planned"
  | "queued"
  | "running"
  | "ready"
  | "review_required"
  | "failed"
  | "cancelled"

export type ContentProductionReuseMode = "master_reuse" | "platform_specific"

export interface ContentProductionDelivery {
  publishingTaskId: string
  plannedDate: string
  platformKey: string
  platformName: string
  accountSlot: number
}

export interface ContentProductionItem {
  id: string
  assetId: string
  contentType: PublishingContentType
  plannedDate: string
  questionId?: string
  question: string
  matchedAdvantage?: string
  reuseMode: ContentProductionReuseMode
  targetPlatform: GeoContentPlatform
  promptKey?: ArticlePromptKey
  promptTitle?: string
  deliveries: ContentProductionDelivery[]
  articleBatchId?: string
  articleItemId?: string
  articleBatchStatus?: ArticleBatchItemStatus
  qualityStatus?: ArticleBatchQualityStatus
  status: ContentProductionItemStatus
  title?: string
  fileName?: string
  error?: string
  createdAt: string
  updatedAt: string
}

export interface ContentProductionChildBatch {
  id: string
  requestId: string
  itemIds: string[]
  createdAt: string
}

export interface ContentProductionRun {
  id: string
  ownerUserId: string
  clientId: string
  clientName: string
  planId: string
  planVersion: number
  requestId: string
  createdByUserId: string
  articleOwnerUserId: string
  billingUserId: string
  teamId?: string
  dateFrom: string
  dateTo: string
  selectedPlatformKeys: string[]
  modelProvider: ArticleModelProviderKey
  model: string
  status: ContentProductionRunStatus
  stage: string
  requestedPublicationCount: number
  requestedAssetCount: number
  completedCount: number
  passedCount: number
  reviewRequiredCount: number
  failedCount: number
  cancelledCount: number
  orchestrationAttempts?: number
  orchestrationBatchSize?: number
  orchestrationStartedAt?: string
  orchestrationFinishedAt?: string
  orchestrationLastError?: string
  error?: string
  childBatches: ContentProductionChildBatch[]
  items: ContentProductionItem[]
  createdAt: string
  updatedAt: string
  finishedAt?: string
}

export interface ContentProductionRunFilters {
  limit?: number
  planId?: string
  status?: ContentProductionRunStatus
}
