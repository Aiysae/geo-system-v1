import { NextRequest } from "next/server"
import {
  AgentApiError,
  agentError,
  agentSuccess,
  assertAgentClientGrant,
  requireAgentAuth,
} from "@/lib/agent/api"
import { invokeAgentBusinessRoute } from "@/lib/agent/business-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ importId: string }> },
) {
  let traceId: string | undefined
  try {
    const auth = await requireAgentAuth(request, ["knowledge.view", "client.view"])
    traceId = auth.traceId
    const { importId } = await context.params
    const clientId = String(request.nextUrl.searchParams.get("clientId") || "").trim()
    const teamId = String(request.nextUrl.searchParams.get("teamId") || "").trim() || undefined
    if (!clientId) throw new AgentApiError({ code: "INVALID_ARGUMENT", message: "clientId 不能为空", status: 400 })
    assertAgentClientGrant(auth, clientId, teamId)
    const query = new URLSearchParams({ clientId })
    if (teamId) query.set("teamId", teamId)
    const route = await import("@/app/api/knowledge-base/imports/[importId]/route")
    const result = await invokeAgentBusinessRoute({
      auth,
      origin: request.url,
      path: `/api/knowledge-base/imports/${encodeURIComponent(importId)}?${query}`,
      handler: inner => route.GET(inner, { params: Promise.resolve({ importId }) }),
    })
    return agentSuccess(result.data, auth.traceId)
  } catch (error) {
    return agentError(error, traceId)
  }
}
