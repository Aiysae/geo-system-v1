import { NextRequest, NextResponse } from "next/server"
import { publishingTaskPackageForViewer } from "@/lib/publishing-plan/access"
import { listClientExecutionActionsOnDate } from "@/lib/client-feedback/store"
import { buildClientPublicationProgress } from "@/lib/publishing-plan/evidence-reconciliation"
import {
  claimPublishingTasks,
  getPublishingPlan,
  listPublishingTasks,
} from "@/lib/publishing-plan/store"
import { buildPublishingTaskPackages } from "@/lib/publishing-plan/task-service"
import {
  hasPublishingPlanPermission,
  requirePublishingPlanAccess,
} from "@/lib/publishing-plan/access-control"
import { requireUserId } from "@/lib/with-credits"
import type { PublishingTaskStatus } from "@/types/publishing-plan"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const TASK_STATUSES = new Set<PublishingTaskStatus>(["planned", "claimed", "completed", "failed", "skipped"])

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ clientId: string; planId: string }> },
) {
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
    const date = request.nextUrl.searchParams.get("date") || undefined
    const progressOnly = request.nextUrl.searchParams.get("progressOnly") === "1"
    if (date && progressOnly) {
      const [plan, tasks, actions] = await Promise.all([
        getPublishingPlan(access.dataOwnerUserId, planId, false),
        listPublishingTasks(access.dataOwnerUserId, planId, { date, limit: 10_000 }),
        listClientExecutionActionsOnDate(access.dataOwnerUserId, access.clientId, date),
      ])
      if (!plan || plan.clientId !== access.clientId) throw new Error("发布规划不存在")
      return NextResponse.json({
        tasks: [],
        costsVisible: hasPublishingPlanPermission(access.permissionKeys, "manage"),
        progress: buildClientPublicationProgress({ date, plan, tasks, actions }),
      })
    }
    const plan = await getPublishingPlan(access.dataOwnerUserId, planId, true)
    if (!plan || plan.clientId !== access.clientId) throw new Error("发布规划不存在")
    const statusValue = request.nextUrl.searchParams.get("status") as PublishingTaskStatus | null
    const [tasks, actions] = await Promise.all([
      listPublishingTasks(access.dataOwnerUserId, planId, {
        date,
        from: request.nextUrl.searchParams.get("from") || undefined,
        to: request.nextUrl.searchParams.get("to") || undefined,
        platformKey: request.nextUrl.searchParams.get("platformKey") || undefined,
        status: statusValue && TASK_STATUSES.has(statusValue) ? statusValue : undefined,
        limit: Number(request.nextUrl.searchParams.get("limit")) || undefined,
      }),
      date
        ? listClientExecutionActionsOnDate(access.dataOwnerUserId, access.clientId, date)
        : Promise.resolve([]),
    ])
    const costsVisible = hasPublishingPlanPermission(access.permissionKeys, "manage")
    const packages = buildPublishingTaskPackages(plan, tasks)
    return NextResponse.json({
      tasks: packages.map(item => publishingTaskPackageForViewer(item, costsVisible)),
      costsVisible,
      progress: date
        ? buildClientPublicationProgress({ date, plan, actions })
        : undefined,
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "发布任务读取失败",
    }, { status: 403 })
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ clientId: string; planId: string }> },
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { clientId, planId } = await context.params
    const body = await request.json() as {
      teamId?: unknown
      date?: unknown
      limit?: unknown
      leaseSeconds?: unknown
    }
    const access = await requirePublishingPlanAccess({
      userId: auth.userId,
      clientId,
      teamId: typeof body.teamId === "string" ? body.teamId : undefined,
      action: "edit",
    })
    const plan = await getPublishingPlan(access.dataOwnerUserId, planId, true)
    if (!plan || plan.clientId !== access.clientId) throw new Error("发布规划不存在")
    const tokenId = request.headers.get("x-agent-token-id") || ""
    const tasks = await claimPublishingTasks({
      ownerUserId: access.dataOwnerUserId,
      clientId: access.clientId,
      planId,
      agentId: tokenId ? `agent:${tokenId}` : `user:${auth.userId}`,
      date: String(body.date || "").trim() || undefined,
      limit: Number(body.limit) || undefined,
      leaseSeconds: Number(body.leaseSeconds) || undefined,
    })
    return NextResponse.json({
      tasks: buildPublishingTaskPackages(plan, tasks),
      leaseSeconds: Math.max(60, Math.min(3_600, Number(body.leaseSeconds) || 900)),
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "发布任务领取失败",
    }, { status: 400 })
  }
}
