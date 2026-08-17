import { NextRequest, NextResponse } from "next/server"
import { publishingPlanForViewer } from "@/lib/publishing-plan/access"
import { getClientExecutionProfile } from "@/lib/client-feedback/store"
import {
  createPublishingPlanDraft,
  getPublishingPlan,
  listPublishingPlans,
} from "@/lib/publishing-plan/store"
import {
  hasPublishingPlanPermission,
  requirePublishingPlanAccess,
} from "@/lib/publishing-plan/access-control"
import { requireUserId } from "@/lib/with-credits"
import { listWorkspaceClients } from "@/lib/workspace-store"
import type {
  PublishingPlanInput,
  PublishingPlanSourceEvidence,
} from "@/types/publishing-plan"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId } = await context.params
    const teamId = request.nextUrl.searchParams.get("teamId") || undefined
    const access = await requirePublishingPlanAccess({
      userId: auth.userId,
      clientId,
      teamId,
      action: "view",
    })
    const costsVisible = hasPublishingPlanPermission(access.permissionKeys, "manage")
    const [plans, profile] = await Promise.all([
      listPublishingPlans(access.dataOwnerUserId, access.clientId),
      getClientExecutionProfile(access.dataOwnerUserId, access.clientId),
    ])
    const visiblePlans = costsVisible ? plans : plans.filter(plan => plan.status === "active")
    const selected = costsVisible
      ? plans.find(plan => plan.status === "draft") || plans.find(plan => plan.status === "active")
      : plans.find(plan => plan.status === "active")
    const current = selected
      ? await getPublishingPlan(access.dataOwnerUserId, selected.id, true)
      : null
    return noStore(NextResponse.json({
      plans: visiblePlans.map(plan => publishingPlanForViewer(plan, costsVisible)),
      current: current ? publishingPlanForViewer(current, costsVisible) : null,
      canEdit: hasPublishingPlanPermission(access.permissionKeys, "edit"),
      canManage: costsVisible,
      costsVisible,
      profile,
    }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "发布规划读取失败",
    }, { status: 403 }))
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId } = await context.params
    const body = await request.json() as {
      teamId?: unknown
      input?: PublishingPlanInput
      sourceSnapshot?: PublishingPlanSourceEvidence[]
      recommendationModel?: unknown
      recommendationGeneratedAt?: unknown
    }
    const access = await requirePublishingPlanAccess({
      userId: auth.userId,
      clientId,
      teamId: typeof body.teamId === "string" ? body.teamId : undefined,
      action: "manage",
    })
    const client = (await listWorkspaceClients(access.dataOwnerUserId))
      .find(record => record.client.id === access.clientId)?.client
    if (!client) throw new Error("客户面板不存在或无权访问")
    if (!body.input) throw new Error("发布规划配置缺失")
    const questions = [...(client.keywordStrategy?.questions || [])]
      .sort((left, right) => Number(right.top10Eligible === true) - Number(left.top10Eligible === true))
      .map(question => ({
        id: question.id,
        question: question.question,
        matchedAdvantage: question.matched_advantage,
      }))
    const plan = await createPublishingPlanDraft({
      ownerUserId: access.dataOwnerUserId,
      clientId: access.clientId,
      clientName: client.name,
      createdByUserId: auth.userId,
      input: body.input,
      sourceSnapshot: Array.isArray(body.sourceSnapshot) ? body.sourceSnapshot.slice(0, 100) : [],
      recommendationModel: String(body.recommendationModel || "").trim() || undefined,
      recommendationGeneratedAt: String(body.recommendationGeneratedAt || "").trim() || undefined,
      questionMaterials: questions,
    })
    return noStore(NextResponse.json({ plan }, { status: 201 }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "发布规划创建失败",
    }, { status: 400 }))
  }
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return response
}
