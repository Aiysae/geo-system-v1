import { NextRequest } from "next/server"
import {
  AgentApiError,
  agentError,
  assertAgentClientGrant,
  requireAgentAuth,
} from "@/lib/agent/api"
import { invokeAgentBusinessRoute } from "@/lib/agent/business-route"
import { getOwnedStoredArticleBatch } from "@/lib/article-batches/store"

export const runtime = "nodejs"
export const maxDuration = 120
export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ batchId: string }> },
) {
  let traceId: string | undefined
  try {
    const auth = await requireAgentAuth(request, ["article.export"])
    traceId = auth.traceId
    const { batchId } = await context.params
    const batch = await getOwnedStoredArticleBatch(batchId, auth.userId)
    if (!batch) throw new AgentApiError({ code: "NOT_FOUND", message: "批量文章任务不存在", status: 404 })
    assertAgentClientGrant(auth, batch.clientId, batch.teamId)
    const scope = request.nextUrl.searchParams.get("scope") === "all" ? "all" : "passed"
    const variant = request.nextUrl.searchParams.get("variant") === "media" ? "media" : "original"
    const route = await import("@/app/api/article-generation/batches/[batchId]/download/route")
    const result = await invokeAgentBusinessRoute({
      auth,
      origin: request.url,
      path: `/api/article-generation/batches/${encodeURIComponent(batchId)}/download?scope=${scope}&variant=${variant}`,
      handler: inner => route.GET(inner, { params: Promise.resolve({ batchId }) }),
    })
    const headers = new Headers(result.response.headers)
    headers.set("Cache-Control", "private, no-store")
    headers.set("X-Trace-Id", auth.traceId)
    return new Response(result.response.body, { status: result.response.status, headers })
  } catch (error) {
    return agentError(error, traceId)
  }
}
