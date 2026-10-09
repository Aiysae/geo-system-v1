import { AGENT_ACTIONS } from "@/lib/agent/action-catalog"
import { agentError, AgentApiError, agentSuccess, requireAgentAuth } from "@/lib/agent/api"
import { listAgentClientCatalog } from "@/lib/agent/client-catalog"
import { planAgentRequest } from "@/lib/agent/intent-planner"
import { hasAgentScope } from "@/lib/agent/scopes"
import { agentTokenAllowsClient } from "@/lib/agent/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  let traceId: string | undefined
  try {
    const auth = await requireAgentAuth(request, ["client.view"])
    traceId = auth.traceId
    const body = await request.json().catch(() => null) as {
      request?: unknown
      clientHint?: unknown
    } | null
    const userRequest = String(body?.request || "").trim()
    if (!userRequest || userRequest.length > 4_000) {
      throw new AgentApiError({
        code: "INVALID_AGENT_PLAN_REQUEST",
        message: "请提供 1-4000 字的用户需求",
        status: 400,
      })
    }
    const catalog = await listAgentClientCatalog(auth.userId)
    const clients = catalog
      .filter(client => agentTokenAllowsClient(auth.token, client.id, client.teamId))
      .map(client => ({
        id: client.id,
        name: client.name,
        ourBrand: client.ourBrand,
        subjectType: client.subjectType,
        teamId: client.teamId,
      }))
    const availableActions = AGENT_ACTIONS.filter(action => (
      action.requiredScope === "dynamic"
      || hasAgentScope(auth.token.scopes, action.requiredScope)
    )).map(action => action.name)
    const plan = planAgentRequest({
      request: userRequest,
      clientHint: String(body?.clientHint || "").trim().slice(0, 300) || undefined,
      clients,
      availableActions,
    })
    return agentSuccess({ plan }, auth.traceId)
  } catch (error) {
    return agentError(error, traceId)
  }
}
