import { AGENT_ACTIONS } from "@/lib/agent/action-catalog"
import { agentError, agentSuccess, requireAgentAuth } from "@/lib/agent/api"
import { ALL_AGENT_SCOPES } from "@/lib/agent/scopes"
import { hasAgentScope } from "@/lib/agent/scopes"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  let traceId: string | undefined
  try {
    const auth = await requireAgentAuth(request)
    traceId = auth.traceId
    return agentSuccess({
      apiVersion: "v1.7",
      actions: AGENT_ACTIONS.filter(action => (
        action.requiredScope === "dynamic"
        || hasAgentScope(auth.token.scopes, action.requiredScope)
      )),
      scopes: ALL_AGENT_SCOPES,
      token: {
        id: auth.token.id,
        name: auth.token.name,
        scopes: auth.token.scopes,
        clientMode: auth.token.clientMode,
        rateLimitPerMinute: auth.token.rateLimitPerMinute,
        dailyCreditLimit: auth.token.dailyCreditLimit,
        maxTaskCredits: auth.token.maxTaskCredits,
        expiresAt: auth.token.expiresAt,
      },
      conventions: {
        authentication: "Authorization: Bearer <agent-token>",
        idempotency: "所有写操作必须携带稳定的 requestId",
        taskLifecycle: ["queued", "running", "retrying", "succeeded", "partial", "failed", "cancelled", "blocked"],
      },
    }, auth.traceId)
  } catch (error) {
    return agentError(error, traceId)
  }
}
