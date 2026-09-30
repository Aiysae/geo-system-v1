import "server-only"

import { AsyncLocalStorage } from "node:async_hooks"
import type { ArticleContentPlan, ArticleSemanticQualityReport } from "@/lib/article-content-pipeline"
import type { ArticleWebContextResult } from "@/lib/article-web-context"
import type { ArticleModelProviderKey } from "@/types"

// Only the worker supplies this context; public request bodies cannot inject drafts.
export interface ArticleCheckpoint {
  draft: string
  repairedDraft?: string
  modelProvider: ArticleModelProviderKey
  model: string
  contentPlan?: ArticleContentPlan
  webContext?: ArticleWebContextResult
  planUsedFallback: boolean
  plannerIssue: string
  semanticQuality?: ArticleSemanticQualityReport
  semanticJudgeModel?: string
}

export class ArticleCheckpointError extends Error {
  constructor(cause: unknown) {
    super("文章阶段保存失败，已停止后续模型调用", { cause })
    this.name = "ArticleCheckpointError"
  }
}

export const articleCheckpointContext = new AsyncLocalStorage<{
  jobId?: string
  checkpoint?: ArticleCheckpoint
  save: (checkpoint: ArticleCheckpoint) => Promise<void>
}>()

export async function saveArticleCheckpoint(checkpoint: ArticleCheckpoint): Promise<void> {
  const context = articleCheckpointContext.getStore()
  if (!context) return
  try {
    await context.save(checkpoint)
    context.checkpoint = checkpoint
  } catch (error) {
    throw new ArticleCheckpointError(error)
  }
}
