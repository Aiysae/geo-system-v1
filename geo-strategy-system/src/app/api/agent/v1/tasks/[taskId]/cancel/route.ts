import { AgentApiError, agentError, agentSuccess, assertAgentClientGrant, requireAgentAuth } from "@/lib/agent/api"
import { agentTaskScope, hasAgentScope } from "@/lib/agent/scopes"
import { cancelTaskCenterTask } from "@/lib/task-center/cancel"
import { getTaskCenterCancellationTarget, getTaskCenterTask } from "@/lib/task-center/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  let traceId: string | undefined
  try {
    const auth = await requireAgentAuth(request, ["tasks.cancel"])
    traceId = auth.traceId
    const { taskId } = await context.params
    const [target, task] = await Promise.all([
      getTaskCenterCancellationTarget(taskId, auth.userId),
      getTaskCenterTask(taskId, auth.userId),
    ])
    if (!target || !task) {
      throw new AgentApiError({ code: "NOT_FOUND", message: "任务不存在或无权停止", status: 404 })
    }
    assertAgentClientGrant(auth, target.clientId, target.teamId)
    const scope = agentTaskScope({ kind: task.kind, module: target.module, action: "execute" })
    if (!hasAgentScope(auth.token.scopes, scope)) {
      throw new AgentApiError({ code: "AGENT_SCOPE_DENIED", message: `Agent 密钥缺少 ${scope} 权限`, status: 403 })
    }
    const result = await cancelTaskCenterTask(taskId, auth.userId)
    return agentSuccess(result, auth.traceId)
  } catch (error) {
    return agentError(error, traceId)
  }
}
