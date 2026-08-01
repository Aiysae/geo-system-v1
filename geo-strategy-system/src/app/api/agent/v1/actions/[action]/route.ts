import { NextRequest } from "next/server"
import { estimateAgentAction, isAgentActionName } from "@/lib/agent/action-catalog"
import { dispatchAgentAction } from "@/lib/agent/action-dispatch"
import {
  AgentApiError,
  agentError,
  agentSuccess,
  assertAgentClientGrant,
  readAgentJson,
  requireAgentAuth,
  reserveAgentCreditBudget,
} from "@/lib/agent/api"
import { hasAgentScope } from "@/lib/agent/scopes"
import { appendAgentAudit } from "@/lib/agent/store"
import { listAgentClientCatalog } from "@/lib/agent/client-catalog"
import { requireOperationAccess } from "@/lib/team-access"
import type { TeamModuleKey } from "@/lib/team-permissions"
import type { AgentAuthContext } from "@/types/agent"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

async function audit(input: {
  auth: AgentAuthContext
  action: string
  path: string
  requestId?: string
  clientId?: string
  teamId?: string
  status: "accepted" | "succeeded" | "failed" | "denied"
  httpStatus: number
  estimatedCredits?: number
  metadata?: Record<string, unknown>
}): Promise<void> {
  await appendAgentAudit({
    tokenId: input.auth.token.id,
    ownerUserId: input.auth.userId,
    action: input.action,
    method: "POST",
    path: input.path,
    traceId: input.auth.traceId,
    requestId: input.requestId,
    clientId: input.clientId,
    teamId: input.teamId,
    status: input.status,
    httpStatus: input.httpStatus,
    estimatedCredits: input.estimatedCredits || 0,
    metadata: input.metadata,
  }).catch(error => {
    console.error("[agent-audit] write failed", error instanceof Error ? error.message : error)
  })
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ action: string }> },
) {
  let auth: AgentAuthContext | undefined
  let requestId: string | undefined
  let clientId: string | undefined
  let teamId: string | undefined
  let estimatedCredits = 0
  let releaseBudget: (() => Promise<void>) | undefined
  const path = request.nextUrl.pathname
  let actionName = "unknown"
  try {
    const params = await context.params
    actionName = params.action
    if (!isAgentActionName(actionName)) {
      throw new AgentApiError({ code: "NOT_FOUND", message: "Agent 动作不存在", status: 404 })
    }
    auth = await requireAgentAuth(request)
    const body = await readAgentJson(request)
    const dryRun = body.dryRun === true
    const payload = { ...body }
    delete payload.dryRun
    const estimate = estimateAgentAction(actionName, payload)
    requestId = estimate.requestId
    clientId = estimate.clientId
    teamId = estimate.teamId
    estimatedCredits = estimate.credits

    if (!hasAgentScope(auth.token.scopes, estimate.scope)) {
      throw new AgentApiError({
        code: "AGENT_SCOPE_DENIED",
        message: `Agent 密钥缺少 ${estimate.scope} 权限`,
        status: 403,
        details: { requiredScope: estimate.scope },
      })
    }
    assertAgentClientGrant(auth, estimate.clientId, estimate.teamId)
    const clientExists = (await listAgentClientCatalog(auth.userId)).some(client => (
      client.id === estimate.clientId
      && (client.teamId || undefined) === (estimate.teamId || undefined)
    ))
    if (!clientExists) {
      throw new AgentApiError({
        code: "NOT_FOUND",
        message: "当前客户不存在、未共享或已被删除",
        status: 404,
      })
    }
    await requireOperationAccess({
      userId: auth.userId,
      clientId: estimate.clientId,
      teamId: estimate.teamId,
      module: estimate.scope.split(".")[0] as TeamModuleKey,
      action: "execute",
    })

    if (dryRun) {
      await audit({
        auth,
        action: actionName,
        path,
        requestId,
        clientId,
        teamId,
        status: "succeeded",
        httpStatus: 200,
        estimatedCredits,
        metadata: { dryRun: true, units: estimate.units, label: estimate.label },
      })
      return agentSuccess({ action: actionName, dryRun: true, estimate }, auth.traceId, requestId)
    }

    const budget = await reserveAgentCreditBudget(
      auth,
      estimate.credits,
      `${actionName}:${estimate.requestId}`,
    )
    releaseBudget = budget.release
    await audit({
      auth,
      action: actionName,
      path,
      requestId,
      clientId,
      teamId,
      status: "accepted",
      httpStatus: 202,
      estimatedCredits,
      metadata: { units: estimate.units, label: estimate.label, budgetReused: budget.reused },
    })
    const dispatched = await dispatchAgentAction({
      action: actionName,
      payload,
      auth,
      origin: request.url,
    })
    await budget.commit()
    releaseBudget = undefined
    await audit({
      auth,
      action: actionName,
      path,
      requestId,
      clientId,
      teamId,
      status: "succeeded",
      httpStatus: dispatched.status,
      estimatedCredits,
      metadata: { units: estimate.units, label: estimate.label },
    })
    return agentSuccess({
      action: actionName,
      estimate,
      result: dispatched.data,
    }, auth.traceId, requestId, dispatched.status)
  } catch (error) {
    if (releaseBudget) await releaseBudget().catch(() => undefined)
    const response = agentError(error, auth?.traceId, requestId)
    if (auth) {
      await audit({
        auth,
        action: actionName,
        path,
        requestId,
        clientId,
        teamId,
        status: response.status >= 500 ? "failed" : "denied",
        httpStatus: response.status,
        estimatedCredits,
      })
    }
    return response
  }
}
