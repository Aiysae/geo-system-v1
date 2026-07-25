import { NextRequest, NextResponse } from "next/server"
import { getUserById } from "@/lib/auth"
import { isAdminUser } from "@/lib/admin"
import { resolveArticleModel } from "@/lib/article-models"
import { routeArticleStrategyTasks } from "@/lib/article-strategy-service"
import { resolveQuestionAdvantage, extractQuestionAdvantages } from "@/lib/geo-strategy/question-advantages"
import { getMembershipWithPaymentRepair, hasMembershipTier } from "@/lib/membership"
import { requireOperationAccess, isOperationAccessError } from "@/lib/team-access"
import { hasUnlimitedCreditAccess, requireUserId } from "@/lib/with-credits"
import { listWorkspaceClients } from "@/lib/workspace-store"
import type { ArticleBatchQuestionTask, ArticleModelProviderKey } from "@/types"

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
    if (!clientId || selectedIds.length === 0) {
      return NextResponse.json({ error: "请至少选择一条疑问句" }, { status: 400 })
    }
    if (selectedIds.length > 300) {
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
    const [billingUser, membership, records] = await Promise.all([
      getUserById(access.billingUserId),
      getMembershipWithPaymentRepair(access.billingUserId),
      listWorkspaceClients(access.dataOwnerUserId),
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
    const tasks: ArticleBatchQuestionTask[] = selectedIds.flatMap(id => {
      const question = byId.get(id)
      if (!question) return []
      return [{
        questionId: question.id,
        question: question.question,
        intent: question.intent,
        category: question.category,
        keyword: question.keyword,
        contentAngle: question.content_angle,
        matchedAdvantage: resolveQuestionAdvantage(question, advantages),
      }]
    })
    if (tasks.length !== selectedIds.length) {
      return NextResponse.json({ error: "部分疑问句已更新，请刷新后重新选择" }, { status: 409 })
    }

    const providerKey = text(body.modelProvider, 80) as ArticleModelProviderKey
    const model = await resolveArticleModel(providerKey, text(body.model, 200))
    if (!model.apiKey || !model.model) {
      return NextResponse.json({ error: `${model.label}尚未完成配置` }, { status: 400 })
    }
    const comparisonBrandCount = Math.max(
      0,
      Math.min(2, Math.floor(Number(body.comparisonBrandCount) || 0)),
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
