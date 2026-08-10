import {
  AgentApiError,
  agentError,
  agentSuccess,
  assertAgentClientGrant,
  requireAgentAuth,
} from "@/lib/agent/api"
import { agentTaskScope, hasAgentScope } from "@/lib/agent/scopes"
import { restoreTaskCenterResult } from "@/lib/task-center/restore"
import { getTaskCenterCancellationTarget, getTaskCenterTask } from "@/lib/task-center/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  let traceId: string | undefined
  try {
    const auth = await requireAgentAuth(request, ["tasks.view"])
    traceId = auth.traceId
    const { taskId } = await context.params
    const [target, task] = await Promise.all([
      getTaskCenterCancellationTarget(taskId, auth.userId),
      getTaskCenterTask(taskId, auth.userId),
    ])
    if (!target || !task) {
      throw new AgentApiError({ code: "NOT_FOUND", message: "任务不存在或无权恢复", status: 404 })
    }
    assertAgentClientGrant(auth, target.clientId, target.teamId)
    const scope = agentTaskScope({ kind: task.kind, module: target.module, action: "view" })
    if (!hasAgentScope(auth.token.scopes, scope)) {
      throw new AgentApiError({ code: "AGENT_SCOPE_DENIED", message: `Agent 密钥缺少 ${scope} 权限`, status: 403 })
    }
    const restored = await restoreTaskCenterResult(target.id, auth.userId)
    if (!restored) {
      throw new AgentApiError({
        code: "RESULT_NOT_AVAILABLE",
        message: "该任务没有可恢复的结果",
        status: 404,
      })
    }
    return agentSuccess({ taskId: target.id, restored: true }, auth.traceId)
  } catch (error) {
    return agentError(error, traceId)
  }
}
