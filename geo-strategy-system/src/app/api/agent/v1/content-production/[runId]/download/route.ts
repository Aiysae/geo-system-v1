import { NextRequest } from "next/server"
import {
  AgentApiError,
  agentError,
  assertAgentClientGrant,
  requireAgentAuth,
} from "@/lib/agent/api"
import { invokeAgentBusinessRoute } from "@/lib/agent/business-route"
import { taskCenterTaskId, getTaskCenterCancellationTarget } from "@/lib/task-center/store"

export const runtime = "nodejs"
export const maxDuration = 300
export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  let traceId: string | undefined
  try {
    const auth = await requireAgentAuth(request, ["article.export"])
    traceId = auth.traceId
    const { runId } = await context.params
    const target = await getTaskCenterCancellationTarget(
      taskCenterTaskId("contentProduction", runId),
      auth.userId,
    )
    if (!target || target.source !== "contentProduction") {
      throw new AgentApiError({ code: "NOT_FOUND", message: "发布内容生产批次不存在", status: 404 })
    }
    assertAgentClientGrant(auth, target.clientId, target.teamId)
    const scope = request.nextUrl.searchParams.get("scope") === "all" ? "all" : "passed"
    const query = new URLSearchParams({ clientId: target.clientId, scope })
    if (target.teamId) query.set("teamId", target.teamId)
    const route = await import("@/app/api/article-generation/production-runs/[runId]/download/route")
    const result = await invokeAgentBusinessRoute({
      auth,
      origin: request.url,
      path: `/api/article-generation/production-runs/${encodeURIComponent(runId)}/download?${query}`,
      handler: inner => route.GET(inner, { params: Promise.resolve({ runId }) }),
    })
    const headers = new Headers(result.response.headers)
    headers.set("Cache-Control", "private, no-store")
    headers.set("X-Trace-Id", auth.traceId)
    return new Response(result.response.body, { status: result.response.status, headers })
  } catch (error) {
    return agentError(error, traceId)
  }
}
