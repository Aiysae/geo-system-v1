import type {
  ArticleBatchItemStatus,
  ArticleBatchQualityStatus,
  ArticleGenerationQualityAudit,
} from "@/types"

type ArticleBatchQualityInput = {
  status: ArticleBatchItemStatus
  markdown?: string
  hasDraft?: boolean
  qualityAudit?: ArticleGenerationQualityAudit
  qualityStatus?: ArticleBatchQualityStatus
}

export function hasArticleBatchDraft(item: ArticleBatchQualityInput): boolean {
  return item.hasDraft === true || Boolean(item.markdown?.trim())
}

export function resolveArticleBatchQualityStatus(
  item: ArticleBatchQualityInput,
): ArticleBatchQualityStatus {
  if (!hasArticleBatchDraft(item)) {
    return item.status === "queued" || item.status === "running" || item.status === "word_processing"
      ? "pending"
      : "not_available"
  }
  if (item.qualityAudit?.finalPassed === false || item.qualityStatus === "review_required") {
    return "review_required"
  }
  return "passed"
}

export function isArticleBatchDraftDownloadable(item: ArticleBatchQualityInput): boolean {
  return hasArticleBatchDraft(item) && (item.status === "succeeded" || item.status === "failed")
}

export function isArticleBatchQualityPassed(item: ArticleBatchQualityInput): boolean {
  return isArticleBatchDraftDownloadable(item)
    && resolveArticleBatchQualityStatus(item) === "passed"
}
