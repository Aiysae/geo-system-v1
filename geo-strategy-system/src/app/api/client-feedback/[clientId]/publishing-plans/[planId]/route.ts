import { NextRequest, NextResponse } from "next/server"
import {
  activatePublishingPlan,
  deletePublishingPlanDraft,
  getPublishingPlan,
} from "@/lib/publishing-plan/store"
import { publishingPlanForViewer } from "@/lib/publishing-plan/access"
import {
  hasPublishingPlanPermission,
  requirePublishingPlanAccess,
} from "@/lib/publishing-plan/access-control"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ clientId: string; planId: string }> }

export async function GET(request: NextRequest, context: Context) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId, planId } = await context.params
    const access = await requirePublishingPlanAccess({
      userId: auth.userId,
      clientId,
      teamId: request.nextUrl.searchParams.get("teamId") || undefined,
      action: "view",
    })
    const costsVisible = hasPublishingPlanPermission(access.permissionKeys, "manage")
    const plan = await getPublishingPlan(access.dataOwnerUserId, planId, true)
    if (!plan || plan.clientId !== access.clientId || (!costsVisible && plan.status !== "active")) {
      throw new Error("发布规划不存在")
    }
    return NextResponse.json({ plan: publishingPlanForViewer(plan, costsVisible), costsVisible })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "发布规划读取失败",
    }, { status: 403 })
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId, planId } = await context.params
    const body = await request.json() as { action?: unknown; teamId?: unknown }
    const access = await requirePublishingPlanAccess({
      userId: auth.userId,
      clientId,
      teamId: typeof body.teamId === "string" ? body.teamId : undefined,
      action: "manage",
    })
    const current = await getPublishingPlan(access.dataOwnerUserId, planId, false)
    if (!current || current.clientId !== access.clientId) throw new Error("发布规划不存在")
    if (body.action !== "activate") throw new Error("不支持的发布规划操作")
    const plan = await activatePublishingPlan(access.dataOwnerUserId, planId)
    return NextResponse.json({ plan })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "发布规划更新失败",
    }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId, planId } = await context.params
    const access = await requirePublishingPlanAccess({
      userId: auth.userId,
      clientId,
      teamId: request.nextUrl.searchParams.get("teamId") || undefined,
      action: "manage",
    })
    const current = await getPublishingPlan(access.dataOwnerUserId, planId, false)
    if (!current || current.clientId !== access.clientId) throw new Error("发布规划不存在")
    const deleted = await deletePublishingPlanDraft(access.dataOwnerUserId, planId)
    if (!deleted) throw new Error("只有尚未生效的规划草案可以删除")
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "发布规划删除失败",
    }, { status: 400 })
  }
}
