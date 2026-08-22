import { AGENT_ACTIONS } from "@/lib/agent/action-catalog"
import { agentError, agentSuccess, requireAgentAuth } from "@/lib/agent/api"
import { ALL_AGENT_SCOPES } from "@/lib/agent/scopes"
import { hasAgentScope } from "@/lib/agent/scopes"
import { AGENT_WORKFLOW_SUMMARIES } from "@/lib/agent/intent-planner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  let traceId: string | undefined
  try {
    const auth = await requireAgentAuth(request)
    traceId = auth.traceId
    const actions = AGENT_ACTIONS.filter(action => (
        action.requiredScope === "dynamic"
        || hasAgentScope(auth.token.scopes, action.requiredScope)
      ))
    const availableActionNames = new Set(actions.map(action => action.name))
    return agentSuccess({
      apiVersion: "v1.11",
      planner: {
        endpoint: "/api/agent/v1/plan",
        mcpTool: "shitu_plan_request",
        description: "先将模糊业务需求解释为客户、模块和安全动作顺序，规划本身不扣积分、不执行写操作。",
      },
      workflows: AGENT_WORKFLOW_SUMMARIES.map(workflow => ({
        ...workflow,
        available: workflow.actions.every(action => availableActionNames.has(action)),
        unavailableActions: workflow.actions.filter(action => !availableActionNames.has(action)),
      })),
      modules: Object.fromEntries(Array.from(new Set(actions.map(action => action.module))).map(module => [
        module,
        actions.filter(action => action.module === module).map(action => action.name),
      ])),
      actions,
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
        fuzzyRequests: "需求模糊或包含多步时先调用 plan；不确定客户时不得猜测 clientId",
        writes: "先 dry-run；删除类动作始终需要人工确认",
        taskLifecycle: ["queued", "running", "retrying", "succeeded", "partial", "failed", "cancelled", "blocked"],
      },
    }, auth.traceId)
  } catch (error) {
    return agentError(error, traceId)
  }
}
