import { NextRequest } from "next/server"
import { agentError, agentSuccess, assertAgentClientGrant, requireAgentAuth } from "@/lib/agent/api"
import { agentTokenAllowsClient } from "@/lib/agent/store"
import { agentTaskScope, hasAgentScope } from "@/lib/agent/scopes"
import { listTaskCenterTasks } from "@/lib/task-center/store"
import type { AgentScope } from "@/types/agent"
import type { TaskCenterModule, TaskCenterStatus } from "@/types/task-center"

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
    const cursor = String(request.nextUrl.searchParams.get("cursor") || "").trim() || undefined
    const statuses: TaskCenterStatus[] = ["queued", "running", "retrying", "succeeded", "partial", "failed", "cancelled", "blocked"]
    if (status && !statuses.includes(status as TaskCenterStatus)) {
      throw new Error("任务状态筛选值无效")
    }
    if (clientId) assertAgentClientGrant(auth, clientId, teamId)

    const allowedModules = ["penetration", "research", "diagnosis", "difficulty", "keyword", "article", "report"]
      .filter(module => hasAgentScope(auth.token.scopes, `${module}.view` as AgentScope)) as TaskCenterModule[]
    if (hasAgentScope(auth.token.scopes, "knowledge.view") && !allowedModules.includes("keyword")) {
      allowedModules.push("keyword")
    }
    const result = await listTaskCenterTasks(auth.userId, {
      limit,
      cursor,
      clientId: clientId || undefined,
      teamId,
      status: status as TaskCenterStatus || undefined,
      modules: allowedModules,
      clientFilters: auth.token.clientMode === "selected" ? auth.token.clientGrants : undefined,
    })
    const tasks = result.tasks.filter(task => {
      if (!agentTokenAllowsClient(auth.token, task.clientId, task.teamId)) return false
      if (!hasAgentScope(auth.token.scopes, agentTaskScope({
        kind: task.kind,
        module: task.module,
        action: "view",
      }))) return false
      if (clientId && task.clientId !== clientId) return false
      return !status || task.status === status
    })
    return agentSuccess({
      tasks,
      activeCount: tasks.filter(task => !["succeeded", "partial", "failed", "cancelled", "blocked"].includes(task.status)).length,
      unreadCount: tasks.filter(task => task.unread).length,
      serverTime: result.serverTime,
      nextCursor: result.nextCursor,
    }, auth.traceId)
  } catch (error) {
    return agentError(error, traceId)
  }
}
