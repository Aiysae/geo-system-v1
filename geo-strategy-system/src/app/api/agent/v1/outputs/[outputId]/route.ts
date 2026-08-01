import { NextRequest } from "next/server"
import { AgentApiError, agentError, agentSuccess, assertAgentClientGrant, requireAgentAuth } from "@/lib/agent/api"
import { hasAgentScope } from "@/lib/agent/scopes"
import { getSystemOutputRecord, getSystemOutputRecordScope } from "@/lib/system-output/store"
import { requireOperationAccess } from "@/lib/team-access"
import type { AgentScope } from "@/types/agent"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ outputId: string }> },
) {
  let traceId: string | undefined
  try {
    const auth = await requireAgentAuth(request, ["outputs.view"])
    traceId = auth.traceId
    const { outputId } = await context.params
    const teamId = String(request.nextUrl.searchParams.get("teamId") || "").trim() || undefined
    const scope = await getSystemOutputRecordScope(outputId)
    if (!scope) throw new AgentApiError({ code: "NOT_FOUND", message: "产出记录不存在", status: 404 })
    assertAgentClientGrant(auth, scope.clientId, teamId)
    const requiredScope = `${scope.module}.view` as AgentScope
    if (!hasAgentScope(auth.token.scopes, requiredScope)) {
      throw new AgentApiError({ code: "AGENT_SCOPE_DENIED", message: `Agent 密钥缺少 ${requiredScope} 权限`, status: 403 })
    }
    const access = await requireOperationAccess({
      userId: auth.userId,
      clientId: scope.clientId,
      module: scope.module,
      action: "view",
      teamId,
    })
    if (access.dataOwnerUserId !== scope.ownerUserId) {
      throw new AgentApiError({ code: "PERMISSION_DENIED", message: "无权查看该产出记录", status: 403 })
    }
    const record = await getSystemOutputRecord(scope.ownerUserId, outputId)
    if (!record) throw new AgentApiError({ code: "NOT_FOUND", message: "产出记录不存在", status: 404 })
    return agentSuccess(record, auth.traceId)
  } catch (error) {
    return agentError(error, traceId)
  }
}
