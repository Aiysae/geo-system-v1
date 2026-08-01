import { NextRequest } from "next/server"
import { agentError, agentSuccess, assertAgentClientGrant, requireAgentAuth } from "@/lib/agent/api"
import { agentTokenAllowsClient } from "@/lib/agent/store"
import { hasAgentScope } from "@/lib/agent/scopes"
import { listTaskCenterTasks } from "@/lib/task-center/store"
import type { AgentScope } from "@/types/agent"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  let traceId: string | undefined
  try {
    const auth = await requireAgentAuth(request, ["tasks.view"])
    traceId = auth.traceId
    const requestedLimit = Number(request.nextUrl.searchParams.get("limit") || 50)
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(100, Math.floor(requestedLimit)))
      : 50
    const clientId = String(request.nextUrl.searchParams.get("clientId") || "").trim()
    const teamId = String(request.nextUrl.searchParams.get("teamId") || "").trim() || undefined
    const status = String(request.nextUrl.searchParams.get("status") || "").trim()
    if (clientId) assertAgentClientGrant(auth, clientId, teamId)

    const result = await listTaskCenterTasks(auth.userId, limit)
    const tasks = result.tasks.filter(task => {
      if (!agentTokenAllowsClient(auth.token, task.clientId, task.teamId)) return false
      if (!hasAgentScope(auth.token.scopes, `${task.module}.view` as AgentScope)) return false
      if (clientId && task.clientId !== clientId) return false
      return !status || task.status === status
    })
    return agentSuccess({
      tasks,
      activeCount: tasks.filter(task => !["succeeded", "partial", "failed", "cancelled", "blocked"].includes(task.status)).length,
      unreadCount: tasks.filter(task => task.unread).length,
      serverTime: result.serverTime,
    }, auth.traceId)
  } catch (error) {
    return agentError(error, traceId)
  }
}
