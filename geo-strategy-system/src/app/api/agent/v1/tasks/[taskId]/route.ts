import { AgentApiError, agentError, agentSuccess, assertAgentClientGrant, requireAgentAuth } from "@/lib/agent/api"
import { agentTaskScope, hasAgentScope } from "@/lib/agent/scopes"
import { getTaskCenterCancellationTarget, getTaskCenterTask } from "@/lib/task-center/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  let traceId: string | undefined
  try {
    const auth = await requireAgentAuth(request, ["tasks.view"])
    traceId = auth.traceId
    const { taskId } = await context.params
    const [task, target] = await Promise.all([
      getTaskCenterTask(taskId, auth.userId),
      getTaskCenterCancellationTarget(taskId, auth.userId),
    ])
    if (!task || !target) {
      throw new AgentApiError({ code: "NOT_FOUND", message: "任务不存在或无权查看", status: 404 })
    }
    assertAgentClientGrant(auth, task.clientId, target.teamId)
    const scope = agentTaskScope({ kind: task.kind, module: task.module, action: "view" })
    if (!hasAgentScope(auth.token.scopes, scope)) {
      throw new AgentApiError({ code: "AGENT_SCOPE_DENIED", message: `Agent 密钥缺少 ${scope} 权限`, status: 403 })
    }
    return agentSuccess(task, auth.traceId)
  } catch (error) {
    return agentError(error, traceId)
  }
}
