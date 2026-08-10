import { NextRequest } from "next/server"
import {
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
  context: { params: Promise<{ clientId: string }> },
) {
  let traceId: string | undefined
  try {
    const auth = await requireAgentAuth(request, ["feedback.view"])
    traceId = auth.traceId
    const { clientId } = await context.params
    const teamId = String(request.nextUrl.searchParams.get("teamId") || "").trim() || undefined
    assertAgentClientGrant(auth, clientId, teamId)
    const query = new URLSearchParams()
    if (teamId) query.set("teamId", teamId)
    const route = await import("@/app/api/client-feedback/[clientId]/route")
    const result = await invokeAgentBusinessRoute({
      auth,
      origin: request.url,
      path: `/api/client-feedback/${encodeURIComponent(clientId)}${query.size ? `?${query}` : ""}`,
      handler: inner => route.GET(inner, { params: Promise.resolve({ clientId }) }),
    })
    return agentSuccess(result.data, auth.traceId)
  } catch (error) {
    return agentError(error, traceId)
  }
}
