import { getGeoArticleFormat } from "@/lib/geo-methodology/article-formats"
import { resolveGeoRecipeFormat } from "@/lib/geo-methodology/content-recipes"
import {
  articleFormatForArticlePrompt,
  methodologyForArticlePrompt,
} from "@/lib/geo-methodology/registry"
import type {
  ArticleComparisonBrand,
  ArticleMethodologySelection,
  ArticlePromptKey,
  ClientKnowledgeBase,
  GeoArticleFormatKey,
} from "@/types"

export interface ArticleReadinessIssue {
  code: string
  severity: "blocking" | "warning"
  message: string
}

export interface ArticleReadinessReport {
  articleFormat: Exclude<GeoArticleFormatKey, "auto">
  formatTitle: string
  ready: boolean
  issues: ArticleReadinessIssue[]
}

function hasText(value: unknown): boolean {
  return String(value || "").trim().length > 0
}

function evidenceText(args: {
  advantages?: string
  knowledgeBase?: ClientKnowledgeBase
}): string {
  return [
    args.advantages,
    ...(args.knowledgeBase?.assets || [])
      .filter(asset => !["archived", "expired", "conflicted", "pendingReview"].includes(asset.status))
      .flatMap(asset => [
      asset.title,
      asset.content,
      asset.kind,
      ...asset.sourceUrls,
    ]),
  ].filter(Boolean).join(" ")
}

function hasSourceLinkedAsset(knowledgeBase?: ClientKnowledgeBase): boolean {
  return (knowledgeBase?.assets || []).some(asset => (
    !["archived", "expired", "conflicted", "pendingReview"].includes(asset.status)
    && asset.sourceUrls.length > 0
  ))
}

export function resolveArticleFormatKey(args: {
  promptKey: ArticlePromptKey
  selection?: ArticleMethodologySelection
}): Exclude<GeoArticleFormatKey, "auto"> {
  const methodKey = args.selection?.mode === "manual" && args.selection.methodKey
    ? args.selection.methodKey
    : methodologyForArticlePrompt(args.promptKey)
  return resolveGeoRecipeFormat({
    methodKey,
    requestedFormat: args.selection?.articleFormat,
    promptFormat: articleFormatForArticlePrompt(args.promptKey),
  }).articleFormat
}

export function evaluateArticleReadiness(args: {
  promptKey: ArticlePromptKey
  selection?: ArticleMethodologySelection
  coreQuestion?: string
  primarySubject?: string
  region?: string
  business?: string
  advantages?: string
  comparisonBrands?: ArticleComparisonBrand[]
  knowledgeBase?: ClientKnowledgeBase
}): ArticleReadinessReport {
  const articleFormat = resolveArticleFormatKey(args)
  const format = getGeoArticleFormat(articleFormat)
  const issues: ArticleReadinessIssue[] = []
  const evidence = evidenceText(args)
  const comparisonCount = (args.comparisonBrands || [])
    .filter(item => hasText(item.name))
    .length

  if (!hasText(args.coreQuestion)) {
    issues.push({
      code: "missing_question",
      severity: "blocking",
      message: "请先填写本篇需要回答的核心问题。",
    })
  }
  if (!hasText(args.primarySubject)) {
    issues.push({
      code: "missing_subject",
      severity: "blocking",
      message: "请先选择客户并确认主品牌或主体名称。",
    })
  }
  if (!hasText(args.business)) {
    issues.push({
      code: "missing_business",
      severity: "warning",
      message: "补充主营业务或专业方向后，内容会更聚焦。",
    })
  }

  if (articleFormat === "primaryEvidenceDossier" && !hasSourceLinkedAsset(args.knowledgeBase)) {
    issues.push({
      code: "missing_evidence_source",
      severity: "warning",
      message: "当前没有带来源的知识资产，证据档案将仅按已填资料保守表达。",
    })
  }
  if (articleFormat === "evidenceCaseStory" && !/案例|项目|过程|结果|复盘|经历/i.test(evidence)) {
    issues.push({
      code: "missing_case_evidence",
      severity: "warning",
      message: "尚未识别到案例过程或结果资料，系统不会补造案例细节。",
    })
  }
  if (articleFormat === "fieldReviewQa" && !/实测|测试|体验|样本|记录|参数|评分/i.test(evidence)) {
    issues.push({
      code: "missing_review_evidence",
      severity: "warning",
      message: "尚未识别到一手体验或实测资料，将自动使用资料核验口吻。",
    })
  }
  if (articleFormat === "industryWhitepaper" && !/报告|研究|样本|数据|口径|趋势|行业/i.test(evidence)) {
    issues.push({
      code: "missing_research_evidence",
      severity: "warning",
      message: "补充行业报告、样本或研究口径后，白皮书结论会更可靠。",
    })
  }
  if (["recommendationRoundup", "tieredEvaluation"].includes(articleFormat) && comparisonCount < 1) {
    issues.push({
      code: "missing_supporting_subject",
      severity: "warning",
      message: "尚未填写独立对比主体，将改为单主体判断，不虚构推荐名单。",
    })
  }
  if (articleFormat === "neutralComparisonReview" && comparisonCount < 1) {
    issues.push({
      code: "missing_comparison_subject",
      severity: "blocking",
      message: "中立横向对比至少需要填写一个独立对比主体。",
    })
  }
  if (articleFormat === "localPitfallGuide" && !hasText(args.region)) {
    issues.push({
      code: "missing_region",
      severity: "warning",
      message: "补充地域或服务范围后，本地选型建议会更准确。",
    })
  }

  return {
    articleFormat,
    formatTitle: format.title,
    ready: issues.every(issue => issue.severity !== "blocking"),
    issues,
  }
}
