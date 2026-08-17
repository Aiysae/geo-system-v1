import { NextRequest, NextResponse } from "next/server"
import {
  listContentProductionRuns,
} from "@/lib/content-production/store"
import {
  startContentProductionRun,
  syncContentProductionRun,
} from "@/lib/content-production/service"
import { getCurrentPublishingPlan } from "@/lib/publishing-plan/store"
import { publishingPlanForViewer } from "@/lib/publishing-plan/access"
import { requireOperationAccess, isOperationAccessError } from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"
import { listWorkspaceClients } from "@/lib/workspace-store"
import type { ArticleModelProviderKey } from "@/types"

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

function date(value: unknown, fallback = ""): string {
  const source = text(value, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(source) ? source : fallback
}

function dateSpan(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.floor((end - start) / 86_400_000) + 1
    : 0
}

export async function GET(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const clientId = text(request.nextUrl.searchParams.get("clientId"), 200)
    const teamId = text(request.nextUrl.searchParams.get("teamId"), 200) || undefined
    const limit = Math.max(1, Math.min(100, Number(request.nextUrl.searchParams.get("limit")) || 30))
    if (!clientId) return NextResponse.json({ error: "客户标识缺失" }, { status: 400 })
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      teamId,
      module: "article",
      action: "view",
    })
    const [storedRuns, plan] = await Promise.all([
      listContentProductionRuns(access.dataOwnerUserId, access.clientId, { limit }),
      getCurrentPublishingPlan(access.dataOwnerUserId, access.clientId, true),
    ])
    const runs = await Promise.all(storedRuns.map(run => (
      ["succeeded", "partial", "failed", "cancelled"].includes(run.status)
        ? run
        : syncContentProductionRun(run)
    )))
    return noStore(NextResponse.json({
      runs,
      plan: plan?.status === "active" ? publishingPlanForViewer(plan, false) : null,
      links: Object.fromEntries(runs.map(run => [run.id, productionRunLinks(run.id, clientId, teamId)])),
    }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : "内容生产批次读取失败",
    }, { status: isOperationAccessError(error) ? 403 : 500 }))
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const body = record(await request.json())
    const clientId = text(body.clientId, 200)
    const teamId = text(body.teamId, 200) || undefined
    const requestId = text(body.requestId, 160)
    const dateFrom = date(body.dateFrom)
    const dateTo = date(body.dateTo, dateFrom)
    const selectedPlatformKeys = Array.isArray(body.platformKeys)
      ? [...new Set(body.platformKeys.map(value => text(value, 160)).filter(Boolean))].slice(0, 100)
      : []
    if (!clientId) return NextResponse.json({ error: "客户标识缺失" }, { status: 400 })
    if (!/^[A-Za-z0-9_-]{16,160}$/.test(requestId)) {
      return NextResponse.json({ error: "生产批次请求编号无效，请刷新后重试" }, { status: 400 })
    }
    const span = dateSpan(dateFrom, dateTo)
    if (span < 1 || span > 31) {
      return NextResponse.json({ error: "单次可以生成 1 到 31 天的发布内容" }, { status: 400 })
    }

    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      teamId,
      module: "article",
      action: "execute",
    })
    const [plan, clients, previousRuns] = await Promise.all([
      getCurrentPublishingPlan(access.dataOwnerUserId, access.clientId, true),
      listWorkspaceClients(access.dataOwnerUserId),
      listContentProductionRuns(access.dataOwnerUserId, access.clientId, { limit: 100 }),
    ])
    if (!plan || plan.status !== "active") {
      return NextResponse.json({ error: "请先在关键词策略中确认并启用内容发布规划" }, { status: 409 })
    }
    const client = clients.find(item => item.client.id === access.clientId)?.client
    if (!client) return NextResponse.json({ error: "客户档案不存在" }, { status: 404 })

    const generatedTaskIds = new Set(previousRuns
      .filter(run => run.planId === plan.id)
      .flatMap(run => run.items)
      .filter(item => !["failed", "cancelled"].includes(item.status))
      .flatMap(item => item.deliveries.map(delivery => delivery.publishingTaskId)))
    const candidates = plan.calculation.tasks.filter(task => (
      task.plannedDate >= dateFrom
      && task.plannedDate <= dateTo
      && task.status !== "completed"
      && task.status !== "skipped"
      && (selectedPlatformKeys.length === 0 || selectedPlatformKeys.includes(task.platformKey))
    ))
    const tasks = candidates.filter(task => !generatedTaskIds.has(task.id))
    const skippedAlreadyGenerated = candidates.length - tasks.length
    if (tasks.length === 0) {
      return NextResponse.json({
        error: candidates.length > 0
          ? "所选发布任务已经生成过内容，可直接查看原生产批次"
          : "所选日期和平台没有待生产内容",
        skippedAlreadyGenerated,
      }, { status: 409 })
    }

    const result = await startContentProductionRun({
      requestId,
      ownerUserId: access.dataOwnerUserId,
      actorUserId: access.actorUserId,
      billingUserId: access.billingUserId,
      teamId: access.teamId,
      client,
      plan,
      tasks,
      dateFrom,
      dateTo,
      selectedPlatformKeys,
      modelProvider: text(body.modelProvider, 100) as ArticleModelProviderKey || undefined,
      model: text(body.model, 200) || undefined,
    })
    return noStore(NextResponse.json({
      run: result.run,
      reused: result.reused,
      skippedAlreadyGenerated,
      links: productionRunLinks(result.run.id, clientId, teamId),
    }, { status: result.reused ? 200 : 202 }))
  } catch (error) {
    const message = error instanceof Error ? error.message : "内容生产批次创建失败"
    return noStore(NextResponse.json({ error: message }, {
      status: isOperationAccessError(error)
        ? 403
        : /(请先|没有|缺失|无效|尚未|关联疑问句)/.test(message) ? 400 : 500,
    }))
  }
}

function productionRunLinks(runId: string, clientId: string, teamId?: string) {
  const query = new URLSearchParams({ clientId })
  if (teamId) query.set("teamId", teamId)
  const statusPath = `/api/article-generation/production-runs/${encodeURIComponent(runId)}?${query}`
  return {
    status: statusPath,
    workspace: `/workspace?${new URLSearchParams({
      clientId,
      ...(teamId ? { teamId } : {}),
      module: "article",
      view: "production",
      jobId: runId,
    })}`,
    downloadPassed: `${statusPath.replace("?", "/download?")}&scope=passed`,
    downloadAll: `${statusPath.replace("?", "/download?")}&scope=all`,
  }
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return response
}
