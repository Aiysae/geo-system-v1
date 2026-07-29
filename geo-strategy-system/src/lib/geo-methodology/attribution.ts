import "server-only"

import { createHash } from "crypto"
import { saveClientExecutionAction } from "@/lib/client-feedback/store"
import type {
  ArticleGenerationLineage,
} from "@/types"
import type {
  ClientExecutionAction,
  ClientExecutionContentTrace,
} from "@/types/client-feedback"

const PLATFORM_LABELS: Record<string, string> = {
  universal: "通用内容",
  officialSite: "官网",
  sohu: "搜狐",
  toutiao: "今日头条",
  netease: "网易",
  baijiahao: "百家号",
  zhihu: "知乎",
  xiaohongshu: "小红书",
  douyin: "抖音图文",
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value || "").trim().slice(0, maxLength)
}

function articleTitle(markdown: string, fallback: string): string {
  const heading = String(markdown || "").match(/^\s*#\s+(.+?)\s*#*\s*$/m)?.[1]
  return cleanText(heading || fallback || "文章内容", 120)
}

function attributionActionId(
  ownerUserId: string,
  clientId: string,
  generationId: string,
): string {
  const digest = createHash("sha256")
    .update([ownerUserId, clientId, generationId].join("\u0000"))
    .digest("hex")
    .slice(0, 32)
  return `cact_article_${digest}`
}

function contentTrace(lineage: ArticleGenerationLineage): ClientExecutionContentTrace {
  return {
    generationId: lineage.generationId,
    promptKey: lineage.promptKey,
    primarySubject: lineage.primarySubject,
    comparisonSubjects: lineage.comparisonSubjects,
    questionId: lineage.questionId,
    coreQuestion: lineage.coreQuestion,
    questionIntent: lineage.questionIntent,
    questionSubIntent: lineage.questionSubIntent,
    questionCategory: lineage.questionCategory,
    questionKeyword: lineage.questionKeyword,
    matchedAdvantage: lineage.matchedAdvantage,
    methodologyVersion: lineage.methodologyTrace.version,
    methodKey: lineage.methodologyTrace.methodKey,
    articleFormat: lineage.methodologyTrace.articleFormat,
    targetPlatform: lineage.methodologyTrace.targetPlatform,
    brandLayout: lineage.methodologyTrace.brandLayout,
    titleStrategy: lineage.methodologyTrace.titleStrategy,
    knowledgeAssetIds: lineage.methodologyTrace.knowledgeAssetIds,
    modelProvider: lineage.modelProvider,
    model: lineage.model,
  }
}

export async function recordArticleGenerationAttribution(input: {
  ownerUserId: string
  clientId: string
  actorUserId: string
  lineage: ArticleGenerationLineage
  markdown: string
  batchId?: string
}): Promise<ClientExecutionAction> {
  const title = articleTitle(input.markdown, input.lineage.coreQuestion)
  const platform = PLATFORM_LABELS[input.lineage.methodologyTrace.targetPlatform]
    || "通用内容"
  return saveClientExecutionAction({
    ownerUserId: input.ownerUserId,
    clientId: input.clientId,
    actorUserId: input.actorUserId,
    value: {
      id: attributionActionId(
        input.ownerUserId,
        input.clientId,
        input.lineage.generationId,
      ),
      category: "content_production",
      source: "system",
      status: "completed",
      visibility: "client",
      publication: "summary",
      title: `完成文章《${title}》`,
      description: `围绕“${cleanText(input.lineage.coreQuestion, 240)}”完成内容生产。`,
      occurredAt: input.lineage.generatedAt,
      quantity: 1,
      unit: "篇",
      platform,
      evidence: [],
      sourceRecordId: input.lineage.generationId,
      contentTrace: contentTrace(input.lineage),
      importBatchId: cleanText(input.batchId, 120) || undefined,
    },
  })
}
