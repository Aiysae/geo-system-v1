import { NextRequest, NextResponse } from "next/server"
import { getUserById } from "@/lib/auth"
import { isAdminUser } from "@/lib/admin"
import { resolveArticleModel } from "@/lib/article-models"
import { getArticleQuestionMaterialsByIds } from "@/lib/article-question-materials"
import { routeArticleStrategyTasks } from "@/lib/article-strategy-service"
import { resolveQuestionAdvantage, extractQuestionAdvantages } from "@/lib/geo-strategy/question-advantages"
import { classifyQuestionMethodology } from "@/lib/geo-strategy/question-methodology"
import { getMembershipWithPaymentRepair, hasMembershipTier } from "@/lib/membership"
import { requireOperationAccess, isOperationAccessError } from "@/lib/team-access"
import { hasUnlimitedCreditAccess, requireUserId } from "@/lib/with-credits"
import { listWorkspaceClients } from "@/lib/workspace-store"
import type { ArticleBatchQuestionTask, ArticleModelProviderKey } from "@/types"
import { normalizeArticleMethodologySelection } from "@/lib/geo-methodology/compiler"
import { GEO_METHODOLOGY_VERSION } from "@/lib/geo-methodology/registry"
import { classifyArticleQuestionSelection } from "@/lib/article-question-selection"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

function text(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUserId()
    if (!auth.ok) return auth.response
    const body = record(await req.json())
    const clientId = text(body.clientId, 200)
    const teamId = text(body.teamId, 200) || undefined
    const selectedIds = Array.isArray(body.questionIds)
      ? [...new Set(body.questionIds.map(item => text(item, 200)).filter(Boolean))]
      : []
    const selectedMaterialIds = Array.isArray(body.materialIds)
      ? [...new Set(body.materialIds.map(item => text(item, 200)).filter(Boolean))]
      : []
    const selectedCount = selectedIds.length + selectedMaterialIds.length
    if (!clientId || selectedCount === 0) {
      return NextResponse.json({ error: "请至少选择一条疑问句" }, { status: 400 })
    }
    if (selectedCount > 300) {
      return NextResponse.json({
        error: "单次最多可分配 300 条疑问句，请分批选择后生成。",
      }, { status: 400 })
    }

    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      module: "article",
      action: "execute",
      teamId,
    })
    const [billingUser, membership, records, importedMaterials] = await Promise.all([
      getUserById(access.billingUserId),
      getMembershipWithPaymentRepair(access.billingUserId),
      listWorkspaceClients(access.dataOwnerUserId),
      getArticleQuestionMaterialsByIds({
        ownerUserId: access.dataOwnerUserId,
        clientId: access.clientId,
        ids: selectedMaterialIds,
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
        membership,
      }, { status: 403 })
    }

    const client = records.find(item => item.client.id === clientId)?.client
    if (!client) return NextResponse.json({ error: "客户档案不存在" }, { status: 404 })
    const questions = client.keywordStrategy?.questions || []
    const byId = new Map(questions.map(question => [question.id, question]))
    const advantages = extractQuestionAdvantages(client.keywordStrategy?.strategyPlan)
    const methodology = normalizeArticleMethodologySelection(body.methodology)
    const keywordTasks: ArticleBatchQuestionTask[] = selectedIds.flatMap(id => {
      const question = byId.get(id)
      if (!question) return []
      const questionMethodology = classifyQuestionMethodology({
        category: question.category,
        question: question.question,
        intent: question.intent,
        suppliedSubIntent: question.subIntent,
        suppliedQueryStyle: question.queryStyle,
        suppliedMethodologies: question.methodologyCandidates,
        suppliedArticleFormats: question.articleFormatCandidates,
        suppliedTitleStrategies: question.titleStrategyCandidates,
        suppliedPlatforms: question.platformCandidates,
      })
      const questionSelection = classifyArticleQuestionSelection({
        question: question.question,
        category: question.category,
        intent: question.intent,
        queryStyle: questionMethodology.queryStyle,
      })
      return [{
        questionId: question.id,
        questionSource: "keyword_strategy" as const,
        question: question.question,
        intent: question.intent,
        category: question.category,
        keyword: question.keyword,
        decisionDimension: question.decisionDimension,
        contentAngle: question.content_angle,
        matchedAdvantage: resolveQuestionAdvantage(question, advantages),
        subIntent: questionMethodology.subIntent,
        queryStyle: questionMethodology.queryStyle,
        methodologyCandidates: methodology.mode === "manual" && methodology.methodKey
          ? [methodology.methodKey, ...questionMethodology.methodologyCandidates]
          : questionMethodology.methodologyCandidates,
        platformCandidates: questionMethodology.platformCandidates,
        targetPlatform: methodology.targetPlatform === "auto"
          ? questionMethodology.platformCandidates[0] || "auto"
          : methodology.targetPlatform,
        articleFormat: methodology.articleFormat === "auto"
          ? questionMethodology.articleFormatCandidates[0] || "auto"
          : methodology.articleFormat,
        brandLayout: methodology.brandLayout,
        titleStrategy: methodology.titleStrategy === "auto"
          ? questionMethodology.titleStrategyCandidates[0] || "auto"
          : methodology.titleStrategy,
        methodologyVersion: GEO_METHODOLOGY_VERSION,
        questionSelectionType: questionSelection.type,
        questionSelectionConfidence: questionSelection.confidence,
        questionSelectionReason: questionSelection.reason,
        questionSelectionVersion: questionSelection.version,
      }]
    })
    const importedById = new Map(importedMaterials.map(material => [material.id, material]))
    const importedTasks: ArticleBatchQuestionTask[] = selectedMaterialIds.flatMap(id => {
      const material = importedById.get(id)
      if (!material) return []
      const questionMethodology = classifyQuestionMethodology({
        category: material.category || "痛点解决型",
        question: material.question,
        intent: material.intent,
      })
      const questionSelection = classifyArticleQuestionSelection({
        question: material.question,
        category: material.category,
        intent: material.intent,
        queryStyle: questionMethodology.queryStyle,
      })
      return [{
        materialId: material.id,
        questionSource: "excel" as const,
        question: material.question,
        intent: material.intent,
        category: material.category,
        keyword: material.keyword,
        decisionDimension: material.decisionDimension,
        contentAngle: material.contentAngle,
        geoOptimizationText: material.geoOptimizationText,
        matchedAdvantage: material.matchedAdvantage,
        subIntent: questionMethodology.subIntent,
        queryStyle: questionMethodology.queryStyle,
        methodologyCandidates: methodology.mode === "manual" && methodology.methodKey
          ? [methodology.methodKey, ...questionMethodology.methodologyCandidates]
          : questionMethodology.methodologyCandidates,
        platformCandidates: questionMethodology.platformCandidates,
        targetPlatform: methodology.targetPlatform === "auto"
          ? questionMethodology.platformCandidates[0] || "auto"
          : methodology.targetPlatform,
        articleFormat: methodology.articleFormat === "auto"
          ? questionMethodology.articleFormatCandidates[0] || "auto"
          : methodology.articleFormat,
        brandLayout: methodology.brandLayout,
        titleStrategy: methodology.titleStrategy === "auto"
          ? questionMethodology.titleStrategyCandidates[0] || "auto"
          : methodology.titleStrategy,
        methodologyVersion: GEO_METHODOLOGY_VERSION,
        questionSelectionType: questionSelection.type,
        questionSelectionConfidence: questionSelection.confidence,
        questionSelectionReason: questionSelection.reason,
        questionSelectionVersion: questionSelection.version,
      }]
    })
    const tasks = [...keywordTasks, ...importedTasks]
    if (
      keywordTasks.length !== selectedIds.length
      || importedTasks.length !== selectedMaterialIds.length
    ) {
      return NextResponse.json({ error: "部分疑问句已更新，请刷新后重新选择" }, { status: 409 })
    }

    const providerKey = text(body.modelProvider, 80) as ArticleModelProviderKey
    const model = await resolveArticleModel(providerKey, text(body.model, 200))
    if (!model.apiKey || !model.model) {
      return NextResponse.json({ error: `${model.label}尚未完成配置` }, { status: 400 })
    }
    const comparisonBrandCount = Math.max(
      0,
      Math.min(9, Math.floor(Number(body.comparisonBrandCount) || 0)),
    )
    const routed = await routeArticleStrategyTasks({
      tasks,
      model,
      comparisonBrandCount,
      userId: access.billingUserId,
    })
    return NextResponse.json({
      tasks: routed,
      membership,
      modelProvider: model.providerKey,
      model: model.model,
    }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "文章任务分配失败",
    }, { status: isOperationAccessError(error) ? 403 : 500 })
  }
}
