import { NextRequest, NextResponse } from "next/server"
import {
  completePublishingTaskWithFeedback,
  failPublishingTaskForPlan,
} from "@/lib/publishing-plan/task-service"
import { requirePublishingPlanAccess } from "@/lib/publishing-plan/access-control"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ clientId: string; planId: string; taskId: string }> }

export async function PATCH(request: NextRequest, context: Context) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId, planId, taskId } = await context.params
    const body = await request.json() as {
      action?: unknown
      teamId?: unknown
      publishedUrl?: unknown
      publishedAt?: unknown
      title?: unknown
      reason?: unknown
      claimToken?: unknown
    }
    const access = await requirePublishingPlanAccess({
      userId: auth.userId,
      clientId,
      teamId: typeof body.teamId === "string" ? body.teamId : undefined,
      action: "edit",
    })
    if (body.action === "fail") {
      const task = await failPublishingTaskForPlan({
        ownerUserId: access.dataOwnerUserId,
        clientId: access.clientId,
        planId,
        taskId,
        claimToken: String(body.claimToken || "").trim() || undefined,
        reason: String(body.reason || "人工标记失败"),
      })
      return NextResponse.json({ task })
    }
    if (body.action !== "complete") throw new Error("不支持的发布任务操作")
    const result = await completePublishingTaskWithFeedback({
      ownerUserId: access.dataOwnerUserId,
      clientId: access.clientId,
      planId,
      taskId,
      actorUserId: auth.userId,
      claimToken: String(body.claimToken || "").trim() || undefined,
      publishedUrl: String(body.publishedUrl || "").trim(),
      publishedAt: String(body.publishedAt || "").trim() || undefined,
      title: String(body.title || "").trim() || undefined,
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "发布任务更新失败",
    }, { status: 400 })
  }
}
