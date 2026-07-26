import { NextRequest, NextResponse } from "next/server"
import {
  cancelCommercialReportJob,
  deleteCommercialReportJob,
  getCommercialReportJob,
} from "@/lib/reports/report-jobs"
import {
  isReportAccessError,
  requireReportJobAccess,
} from "@/lib/reports/access"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response
  try {
    const { jobId } = await context.params
    const authorized = await requireReportJobAccess({
      jobId,
      userId: userGuard.userId,
      action: "view",
    })
    if (!authorized) {
      return NextResponse.json({ error: "报告任务不存在或已过期" }, { status: 404 })
    }
    const job = await getCommercialReportJob(jobId, authorized.scope.ownerUserId)
    if (!job) {
      return NextResponse.json({ error: "报告任务不存在或已过期" }, { status: 404 })
    }
    return NextResponse.json(job, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取报告任务失败" },
      { status: isReportAccessError(error) ? 403 : 500 },
    )
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response
  try {
    const { jobId } = await context.params
    const authorized = await requireReportJobAccess({
      jobId,
      userId: userGuard.userId,
      action: "manage",
    })
    if (!authorized) {
      return NextResponse.json({ error: "报告不存在或无权删除" }, { status: 404 })
    }
    const result = await deleteCommercialReportJob(jobId, authorized.scope.ownerUserId)
    if (result === "not_found") {
      return NextResponse.json({ error: "报告不存在或无权删除" }, { status: 404 })
    }
    if (result === "active") {
      return NextResponse.json({ error: "报告正在生成，完成后才能删除" }, { status: 409 })
    }
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除报告失败" },
      { status: isReportAccessError(error) ? 403 : 500 },
    )
  }
}

export async function PATCH(
  _req: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const userGuard = await requireUserId()
  if (!userGuard.ok) return userGuard.response
  try {
    const { jobId } = await context.params
    const authorized = await requireReportJobAccess({
      jobId,
      userId: userGuard.userId,
      action: "execute",
    })
    if (!authorized) {
      return NextResponse.json({ error: "报告任务不存在或无权停止" }, { status: 404 })
    }
    const job = await cancelCommercialReportJob(jobId, authorized.scope.ownerUserId)
    if (!job) {
      return NextResponse.json({ error: "报告任务不存在或无权停止" }, { status: 404 })
    }
    return NextResponse.json(job, {
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "停止报告任务失败" },
      { status: isReportAccessError(error) ? 403 : 500 },
    )
  }
}
