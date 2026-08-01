import { NextRequest } from "next/server"
import { AgentApiError, agentError, agentSuccess, assertAgentClientGrant, requireAgentAuth } from "@/lib/agent/api"
import { hasAgentScope } from "@/lib/agent/scopes"
import { listSystemOutputRecords } from "@/lib/system-output/store"
import { requireOperationAccess } from "@/lib/team-access"
import type { AgentScope, SystemOutputModule, SystemOutputStatus } from "@/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MODULES = new Set<SystemOutputModule>(["penetration", "research", "diagnosis", "difficulty"])
const STATUSES = new Set<SystemOutputStatus>(["succeeded", "partial", "failed", "cancelled"])

export async function GET(request: NextRequest) {
  let traceId: string | undefined
  try {
    const auth = await requireAgentAuth(request, ["outputs.view"])
    traceId = auth.traceId
    const clientId = String(request.nextUrl.searchParams.get("clientId") || "").trim()
    const teamId = String(request.nextUrl.searchParams.get("teamId") || "").trim() || undefined
    const outputModule = String(request.nextUrl.searchParams.get("module") || "").trim() as SystemOutputModule
    if (!clientId || !MODULES.has(outputModule)) {
      throw new AgentApiError({
        code: "INVALID_ARGUMENT",
        message: "clientId 和有效的 module 参数不能为空",
        status: 400,
      })
    }
    assertAgentClientGrant(auth, clientId, teamId)
    const scope = `${outputModule}.view` as AgentScope
    if (!hasAgentScope(auth.token.scopes, scope)) {
      throw new AgentApiError({ code: "AGENT_SCOPE_DENIED", message: `Agent 密钥缺少 ${scope} 权限`, status: 403 })
    }
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId,
      module: outputModule,
      action: "view",
      teamId,
    })
    const requestedStatus = String(request.nextUrl.searchParams.get("status") || "") as SystemOutputStatus
    const page = await listSystemOutputRecords(access.dataOwnerUserId, {
      clientId,
      module: outputModule,
      status: STATUSES.has(requestedStatus) ? requestedStatus : undefined,
      days: Number(request.nextUrl.searchParams.get("days") || 0),
      page: Number(request.nextUrl.searchParams.get("page") || 1),
      pageSize: Number(request.nextUrl.searchParams.get("pageSize") || 20),
    })
    return agentSuccess(page, auth.traceId)
  } catch (error) {
    return agentError(error, traceId)
  }
}
