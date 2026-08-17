import { NextRequest, NextResponse } from "next/server"
import { getContentProductionRun } from "@/lib/content-production/store"
import {
  cancelContentProductionRun,
  syncContentProductionRun,
} from "@/lib/content-production/service"
import { requireOperationAccess, isOperationAccessError } from "@/lib/team-access"
import { requireUserId } from "@/lib/with-credits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  return handle(request, context, false)
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  return handle(request, context, true)
}

async function handle(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
  cancel: boolean,
) {
  const auth = await requireUserId()
  if (!auth.ok) return auth.response
  try {
    const { runId } = await context.params
    const clientId = String(request.nextUrl.searchParams.get("clientId") || "").trim()
    const teamId = String(request.nextUrl.searchParams.get("teamId") || "").trim() || undefined
    if (!clientId) return NextResponse.json({ error: "客户标识缺失" }, { status: 400 })
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      teamId,
      module: "article",
      action: cancel ? "execute" : "view",
    })
    const stored = await getContentProductionRun(access.dataOwnerUserId, runId)
    if (!stored || stored.clientId !== access.clientId) {
      return NextResponse.json({ error: "内容生产批次不存在" }, { status: 404 })
    }
    const run = cancel
      ? await cancelContentProductionRun(stored)
      : await syncContentProductionRun(stored)
    const query = new URLSearchParams({ clientId })
    if (teamId) query.set("teamId", teamId)
    const statusPath = `/api/article-generation/production-runs/${encodeURIComponent(run.id)}?${query}`
    return noStore(NextResponse.json({
      run,
      links: {
        status: statusPath,
        downloadPassed: `${statusPath.replace("?", "/download?")}&scope=passed`,
        downloadAll: `${statusPath.replace("?", "/download?")}&scope=all`,
      },
    }))
  } catch (error) {
    return noStore(NextResponse.json({
      error: error instanceof Error ? error.message : cancel ? "停止内容生产失败" : "读取内容生产批次失败",
    }, { status: isOperationAccessError(error) ? 403 : 500 }))
  }
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return response
}
