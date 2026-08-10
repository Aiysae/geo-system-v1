import { NextRequest } from "next/server"
import {
  AgentApiError,
  agentError,
  agentSuccess,
  assertAgentClientGrant,
  requireAgentAuth,
} from "@/lib/agent/api"
import { invokeAgentBusinessRoute } from "@/lib/agent/business-route"
import { getOwnedStoredArticleBatch } from "@/lib/article-batches/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ batchId: string }> },
) {
  let traceId: string | undefined
  try {
    const auth = await requireAgentAuth(request, ["article.view"])
    traceId = auth.traceId
    const { batchId } = await context.params
    const batch = await getOwnedStoredArticleBatch(batchId, auth.userId)
    if (!batch) throw new AgentApiError({ code: "NOT_FOUND", message: "批量文章任务不存在", status: 404 })
    assertAgentClientGrant(auth, batch.clientId, batch.teamId)
    const route = await import("@/app/api/article-generation/batches/[batchId]/route")
    const result = await invokeAgentBusinessRoute({
      auth,
      origin: request.url,
      path: `/api/article-generation/batches/${encodeURIComponent(batchId)}`,
      handler: inner => route.GET(inner, { params: Promise.resolve({ batchId }) }),
    })
    return agentSuccess(result.data, auth.traceId)
  } catch (error) {
    return agentError(error, traceId)
  }
}
