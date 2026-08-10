import { NextRequest, NextResponse } from "next/server"
import { getArticlePromptOption } from "@/lib/article-prompt-meta"
import { createArticleBatch, listArticleBatches } from "@/lib/article-batches/manager"
import { getArticleQuestionMaterialsByIds } from "@/lib/article-question-materials"
import { requireOperationAccess } from "@/lib/team-access"
import { isTeamAccessError } from "@/lib/article-batches/access"
import { hasUnlimitedCreditAccess, requireUserId } from "@/lib/with-credits"
import type {
  ArticleBatchQuestionTask,
  ArticleBatchTopicMode,
  ArticleComparisonBrand,
  ArticleModelProviderKey,
  ArticlePromptKey,
} from "@/types"
import { normalizeAnalysisSubjectType } from "@/lib/analysis-subject"
import { getUserById } from "@/lib/auth"
import { isAdminUser } from "@/lib/admin"
import {
  articleStrategyPromptCandidates,
  isRoutableArticlePrompt,
} from "@/lib/article-strategy-routing"
import { extractQuestionAdvantages, resolveQuestionAdvantage } from "@/lib/geo-strategy/question-advantages"
import { classifyQuestionMethodology } from "@/lib/geo-strategy/question-methodology"
import { getMembershipWithPaymentRepair, hasMembershipTier } from "@/lib/membership"
import { listWorkspaceClients } from "@/lib/workspace-store"
import {
  isRecognizedArticleModelProviderKey,
  resolveArticleModel,
} from "@/lib/article-models"
import { normalizeArticleComparisonBrands } from "@/lib/article-comparison-brands"
import { normalizeArticleMethodologySelection } from "@/lib/geo-methodology/compiler"
import { normalizeClientKnowledgeBase } from "@/lib/client-knowledge-base"
import { resolveGeoRecipeFormat } from "@/lib/geo-methodology/content-recipes"
import {
  articleFormatForArticlePrompt,
  methodologyForArticlePrompt,
} from "@/lib/geo-methodology/registry"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

const TOPIC_MODES = new Set<ArticleBatchTopicMode>(["auto", "questions", "custom", "strategy"])

function text(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringList(value: unknown, maxItems: number, maxLength: number): string[] {
  const source = Array.isArray(value) ? value : []
  return source.map(item => text(item, maxLength)).filter(Boolean).slice(0, maxItems)
}

function comparisonBrands(value: unknown): ArticleComparisonBrand[] {
  return normalizeArticleComparisonBrands(value)
}

function questionTasks(value: unknown): ArticleBatchQuestionTask[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 50).map(raw => {
    const item = record(raw)
    const promptKey = text(item.promptKey, 80) as ArticlePromptKey
    return {
      questionId: text(item.questionId, 200) || undefined,
      materialId: text(item.materialId, 200) || undefined,
      questionSource: item.questionSource === "excel"
        ? "excel"
        : item.questionSource === "keyword_strategy"
          ? "keyword_strategy"
          : undefined as ArticleBatchQuestionTask["questionSource"],
      question: text(item.question, 500),
      intent: text(item.intent, 300) || undefined,
      category: text(item.category, 120) || undefined,
      keyword: text(item.keyword, 200) || undefined,
      decisionDimension: text(item.decisionDimension, 200) || undefined,
      contentAngle: text(item.contentAngle, 500) || undefined,
      geoOptimizationText: text(item.geoOptimizationText, 2_000) || undefined,
      matchedAdvantage: text(item.matchedAdvantage, 3_000) || undefined,
      subIntent: text(item.subIntent, 300) || undefined,
      queryStyle: item.queryStyle as ArticleBatchQuestionTask["queryStyle"],
      methodologyCandidates: stringList(item.methodologyCandidates, 7, 80) as ArticleBatchQuestionTask["methodologyCandidates"],
      platformCandidates: stringList(item.platformCandidates, 10, 80) as ArticleBatchQuestionTask["platformCandidates"],
      targetPlatform: text(item.targetPlatform, 80) as ArticleBatchQuestionTask["targetPlatform"],
      articleFormat: text(item.articleFormat, 80) as ArticleBatchQuestionTask["articleFormat"],
      brandLayout: text(item.brandLayout, 80) as ArticleBatchQuestionTask["brandLayout"],
      titleStrategy: text(item.titleStrategy, 80) as ArticleBatchQuestionTask["titleStrategy"],
      knowledgeAssetIds: stringList(item.knowledgeAssetIds, 30, 140),
      methodologyVersion: text(item.methodologyVersion, 120) || undefined,
      promptKey: getArticlePromptOption(promptKey) && promptKey !== "rewrite"
        ? promptKey
        : undefined,
      promptTitle: text(item.promptTitle, 160) || undefined,
      routeConfidence: Number.isFinite(Number(item.routeConfidence))
        ? Math.max(0, Math.min(1, Number(item.routeConfidence)))
        : undefined,
      routeReason: text(item.routeReason, 500) || undefined,
      missingEvidence: stringList(item.missingEvidence, 12, 300),
    }
  }).filter(item => Boolean(item.question))
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const clientId = text(req.nextUrl.searchParams.get("clientId"), 200)
    const teamId = text(req.nextUrl.searchParams.get("teamId"), 200) || undefined
    if (!clientId) return NextResponse.json({ error: "客户标识缺失" }, { status: 400 })
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      module: "article",
      action: "view",
      teamId,
    })
    const batches = await listArticleBatches(access.actorUserId, clientId)
    return NextResponse.json({ batches }, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取批量文章失败" },
      { status: isTeamAccessError(error) ? 403 : 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUserId()
    if (!auth.ok) return auth.response
    const body = record(await req.json())
    const base = record(body.basePayload)
    const parsedComparisonBrands = comparisonBrands(base.comparisonBrands)
    const requestId = text(body.requestId, 160)
    const clientId = text(body.clientId, 200)
    const teamId = text(body.teamId, 200) || undefined
    const count = Math.floor(Number(body.count))
    const topicMode = text(body.topicMode, 24) as ArticleBatchTopicMode
    let parsedQuestionTasks = questionTasks(body.questionTasks)
    const promptKey = text(base.promptKey, 80) as ArticlePromptKey
    const prompt = getArticlePromptOption(promptKey)
    const modelProvider = text(base.modelProvider, 80) as ArticleModelProviderKey

    if (!/^[A-Za-z0-9_-]{16,160}$/.test(requestId)) {
      return NextResponse.json({ error: "批次请求编号无效，请刷新后重试" }, { status: 400 })
    }
    if (!clientId) return NextResponse.json({ error: "客户标识缺失" }, { status: 400 })
    const minimumCount = topicMode === "strategy" ? 1 : 2
    if (!Number.isFinite(count) || count < minimumCount || count > 50) {
      return NextResponse.json({
        error: topicMode === "strategy"
          ? "策略自动成文数量必须在 1 到 50 篇之间"
          : "批量生成数量必须在 2 到 50 篇之间",
      }, { status: 400 })
    }
    if (!TOPIC_MODES.has(topicMode)) {
      return NextResponse.json({ error: "请选择有效的批量选题方式" }, { status: 400 })
    }
    if (!prompt || promptKey === "rewrite") {
      return NextResponse.json({ error: "批量生成暂不支持文章改写" }, { status: 400 })
    }
    if (!isRecognizedArticleModelProviderKey(modelProvider)) {
      return NextResponse.json({ error: "文章模型来源无效" }, { status: 400 })
    }

    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      module: "article",
      action: "execute",
      teamId,
    })
    if (topicMode === "strategy") {
      const materialIds = parsedQuestionTasks
        .map(task => task.materialId)
        .filter((id): id is string => Boolean(id))
      const [billingUser, membership, records, importedMaterials] = await Promise.all([
        getUserById(access.billingUserId),
        getMembershipWithPaymentRepair(access.billingUserId),
        listWorkspaceClients(access.dataOwnerUserId),
        getArticleQuestionMaterialsByIds({
          ownerUserId: access.dataOwnerUserId,
          clientId: access.clientId,
          ids: materialIds,
        }),
      ])
      if (
        !isAdminUser(billingUser)
        && !hasUnlimitedCreditAccess(billingUser)
        && !hasMembershipTier(membership, "vip3")
      ) {
        return NextResponse.json({
          error: "关键词策略自动成文为 VIP3 及以上权益",
          code: "VIP3_REQUIRED",
        }, { status: 403 })
      }
      const client = records.find(item => item.client.id === clientId)?.client
      const canonicalQuestions = client?.keywordStrategy?.questions || []
      const byId = new Map(canonicalQuestions.map(question => [question.id, question]))
      const materialById = new Map(importedMaterials.map(material => [material.id, material]))
      const advantages = extractQuestionAdvantages(client?.keywordStrategy?.strategyPlan)
      parsedQuestionTasks = parsedQuestionTasks.flatMap(task => {
        if (!isRoutableArticlePrompt(task.promptKey)) return []
        const question = task.questionId ? byId.get(task.questionId) : undefined
        const material = task.materialId ? materialById.get(task.materialId) : undefined
        if (!question && !material) return []
        const sourceQuestion = question?.question || material?.question || ""
        const sourceIntent = question?.intent || material?.intent
        const sourceCategory = question?.category || material?.category
        const sourceKeyword = question?.keyword || material?.keyword
        const sourceContentAngle = question?.content_angle || material?.contentAngle
        const matchedAdvantage = question
          ? resolveQuestionAdvantage(question, advantages)
          : material?.matchedAdvantage
        const sourceMethodology = question
          ? {
              subIntent: question.subIntent,
              queryStyle: question.queryStyle,
              methodologyCandidates: question.methodologyCandidates,
              platformCandidates: question.platformCandidates,
              articleFormatCandidates: question.articleFormatCandidates,
              titleStrategyCandidates: question.titleStrategyCandidates,
            }
          : classifyQuestionMethodology({
              category: material?.category || "痛点解决型",
              question: sourceQuestion,
              intent: material?.intent,
            })
        const candidates = articleStrategyPromptCandidates({
          question: sourceQuestion,
          intent: sourceIntent,
          category: sourceCategory,
          matchedAdvantage,
          methodologyCandidates: task.methodologyCandidates?.length
            ? task.methodologyCandidates
            : sourceMethodology.methodologyCandidates,
          comparisonBrandCount: parsedComparisonBrands.length,
        })
        if (!candidates.includes(task.promptKey)) return []
        const methodKey = methodologyForArticlePrompt(task.promptKey)
        const articleFormat = resolveGeoRecipeFormat({
          methodKey,
          requestedFormat: task.articleFormat && task.articleFormat !== "auto"
            ? task.articleFormat
            : sourceMethodology.articleFormatCandidates?.[0] || "auto",
          promptFormat: articleFormatForArticlePrompt(task.promptKey),
        }).articleFormat
        return [{
          ...task,
          questionId: question?.id,
          materialId: material?.id,
          questionSource: material ? "excel" as const : "keyword_strategy" as const,
          question: sourceQuestion,
          intent: sourceIntent,
          category: sourceCategory,
          keyword: sourceKeyword,
          decisionDimension: question?.decisionDimension || material?.decisionDimension,
          contentAngle: sourceContentAngle,
          geoOptimizationText: material?.geoOptimizationText,
          matchedAdvantage,
          subIntent: sourceMethodology.subIntent,
          queryStyle: sourceMethodology.queryStyle,
          methodologyCandidates: [
            methodKey,
            ...(task.methodologyCandidates?.length
              ? task.methodologyCandidates
              : sourceMethodology.methodologyCandidates
            || []).filter(candidate => candidate !== methodKey),
          ],
          platformCandidates: sourceMethodology.platformCandidates,
          articleFormat,
          titleStrategy: task.titleStrategy && task.titleStrategy !== "auto"
            ? task.titleStrategy
            : sourceMethodology.titleStrategyCandidates?.[0] || "auto",
          promptTitle: getArticlePromptOption(task.promptKey)?.title,
        }]
      })
      if (parsedQuestionTasks.length !== count) {
        return NextResponse.json({
          error: "策略任务已更新或创作类型分配无效，请重新执行 AI 裁判分配",
        }, { status: 409 })
      }
    }
    const resolvedModel = await resolveArticleModel(modelProvider, text(base.model, 200))
    if (!resolvedModel.apiKey) {
      return NextResponse.json({ error: `${resolvedModel.label} API Key 未配置` }, { status: 400 })
    }
    if (!resolvedModel.model) {
      return NextResponse.json({ error: `${resolvedModel.label}模型名未配置` }, { status: 400 })
    }

    const coreQuestion = text(base.coreQuestion, 500) || parsedQuestionTasks[0]?.question || ""
    if (!coreQuestion) {
      return NextResponse.json({ error: "请先填写核心搜索问题或内容主题" }, { status: 400 })
    }

    const subjectType = normalizeAnalysisSubjectType(base.subjectType)
    const brandName = text(base.brandName, 160)
    const currentClient = (await listWorkspaceClients(access.dataOwnerUserId))
      .find(item => item.client.id === clientId)?.client
    if (!currentClient) {
      return NextResponse.json({ error: "客户资料已不存在，请刷新客户列表" }, { status: 404 })
    }
    const result = await createArticleBatch({
      requestId,
      clientId,
      promptTitle: prompt.title,
      count,
      topicMode,
      customTopics: text(body.customTopics, 30_000),
      questionTasks: parsedQuestionTasks,
      similarityRetry: body.similarityRetry !== false,
      basePayload: {
        promptKey,
        modelProvider: resolvedModel.providerKey,
        model: resolvedModel.model,
        clientName: text(base.clientName, 160),
        brandName,
        subjectType,
        subjectContext: text(base.subjectContext, 4_000),
        industry: text(base.industry, 240),
        website: text(base.website, 2_000),
        coreQuestion,
        keywords: text(base.keywords, 8_000),
        region: text(base.region, 240),
        business: text(base.business, 1_000),
        advantages: text(base.advantages, 12_000),
        comparisonBrands: parsedComparisonBrands,
        methodology: normalizeArticleMethodologySelection(base.methodology),
        knowledgeBase: normalizeClientKnowledgeBase(currentClient.knowledgeBase, {
          subjectType,
          subjectName: currentClient.ourBrand || brandName || text(base.clientName, 160),
          aliases: currentClient.brandAliases,
        }),
        audience: text(base.audience, 2_000),
        extraRequirements: text(base.extraRequirements, 5_000),
      },
    }, {
      actorUserId: access.actorUserId,
      billingUserId: access.billingUserId,
      runtimeUserId: access.billingUserId,
      workspaceOwnerUserId: access.dataOwnerUserId,
      teamId: access.teamId,
    })
    if (!result.ok) return result.response
    return NextResponse.json(result.batch, {
      status: result.reused ? 200 : 202,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量文章任务创建失败"
    const inputError = /(请选择|请先|缺失|无效|至少|补足|2 到 50)/.test(message)
    return NextResponse.json(
      { error: message },
      { status: isTeamAccessError(error) ? 403 : inputError ? 400 : 500 },
    )
  }
}
