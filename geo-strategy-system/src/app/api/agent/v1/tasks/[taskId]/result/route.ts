import {
  AgentApiError,
  agentError,
  agentSuccess,
  assertAgentClientGrant,
  requireAgentAuth,
} from "@/lib/agent/api"
import { loadAgentTaskResult } from "@/lib/agent/task-result"
import { agentTaskScope, hasAgentScope } from "@/lib/agent/scopes"
import {
  getTaskCenterCancellationTarget,
  getTaskCenterTask,
} from "@/lib/task-center/store"

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
    assertAgentClientGrant(auth, target.clientId, target.teamId)
    const scope = agentTaskScope({ kind: task.kind, module: target.module, action: "view" })
    if (!hasAgentScope(auth.token.scopes, scope)) {
      throw new AgentApiError({
        code: "AGENT_SCOPE_DENIED",
        message: `Agent 密钥缺少 ${scope} 权限`,
        status: 403,
      })
    }
    const result = await loadAgentTaskResult(target)
    if (!result) {
      throw new AgentApiError({
        code: "RESULT_NOT_READY",
        message: "任务结果尚未生成或已超出保留期",
        status: task.status === "queued" || task.status === "running" || task.status === "retrying" ? 409 : 404,
        retryable: task.status === "queued" || task.status === "running" || task.status === "retrying",
        details: { taskStatus: task.status },
      })
    }
    return agentSuccess({ task, result }, auth.traceId)
  } catch (error) {
    return agentError(error, traceId)
  }
}
