import { NextRequest } from "next/server"
import { AgentApiError, agentError, agentSuccess, assertAgentClientGrant, requireAgentAuth } from "@/lib/agent/api"
import { runWithAgentActor } from "@/lib/agent/actor-context"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  let traceId: string | undefined
  try {
    const auth = await requireAgentAuth(request, ["report.view"])
    traceId = auth.traceId
    const clientId = String(request.nextUrl.searchParams.get("clientId") || "").trim()
    const teamId = String(request.nextUrl.searchParams.get("teamId") || "").trim() || undefined
    if (!clientId) {
      throw new AgentApiError({ code: "INVALID_ARGUMENT", message: "clientId 不能为空", status: 400 })
    }
    assertAgentClientGrant(auth, clientId, teamId)
    const route = await import("@/app/api/reports/jobs/route")
    const target = new URL("/api/reports/jobs", request.url)
    for (const [key, value] of request.nextUrl.searchParams.entries()) target.searchParams.set(key, value)
    const response = await runWithAgentActor({
      userId: auth.userId,
      tokenId: auth.token.id,
      traceId: auth.traceId,
    }, () => route.GET(new NextRequest(target)))
    const body = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) {
      throw new AgentApiError({
        code: String(body.code || "REPORT_LIST_FAILED"),
        message: String(body.error || "历史报告读取失败"),
        status: response.status,
      })
    }
    return agentSuccess(body, auth.traceId)
  } catch (error) {
    return agentError(error, traceId)
  }
}
