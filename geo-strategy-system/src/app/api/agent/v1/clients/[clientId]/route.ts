import { NextRequest } from "next/server"
import { AgentApiError, agentError, agentSuccess, assertAgentClientGrant, requireAgentAuth } from "@/lib/agent/api"
import { runWithAgentActor } from "@/lib/agent/actor-context"
import { hasAgentScope } from "@/lib/agent/scopes"
import type { AgentScope } from "@/types/agent"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SECTION_SCOPE: Record<string, AgentScope> = {
  core: "client.view",
  penetration: "penetration.view",
  research: "research.view",
  diagnosis: "diagnosis.view",
  difficulty: "difficulty.view",
  knowledgeBase: "knowledge.view",
  keywordStrategy: "keyword.view",
  articleGeneration: "article.view",
  jobs: "tasks.view",
}

function requestedSections(request: NextRequest): string[] {
  const raw = String(request.nextUrl.searchParams.get("sections") || "core")
  return Array.from(new Set(raw.split(",").map(value => value.trim()).filter(Boolean)))
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  let traceId: string | undefined
  try {
    const auth = await requireAgentAuth(request, ["client.view"])
    traceId = auth.traceId
    const { clientId } = await context.params
    const teamId = String(request.nextUrl.searchParams.get("teamId") || "").trim() || undefined
    assertAgentClientGrant(auth, clientId, teamId)

    const sections = requestedSections(request)
    if (sections.length === 0 || sections.some(section => !SECTION_SCOPE[section])) {
      throw new AgentApiError({
        code: "INVALID_ARGUMENT",
        message: "sections 包含不支持的客户数据区段",
        status: 400,
      })
    }
    for (const section of sections) {
      const scope = SECTION_SCOPE[section]
      if (!hasAgentScope(auth.token.scopes, scope)) {
        throw new AgentApiError({
          code: "AGENT_SCOPE_DENIED",
          message: `Agent 密钥缺少 ${scope} 权限`,
          status: 403,
        })
      }
    }

    const route = await import("@/app/api/workspace/clients/[clientId]/route")
    const target = new URL(`/api/workspace/clients/${encodeURIComponent(clientId)}`, request.url)
    target.searchParams.set("sections", sections.join(","))
    if (teamId) target.searchParams.set("teamId", teamId)
    const response = await runWithAgentActor({
      userId: auth.userId,
      tokenId: auth.token.id,
      traceId: auth.traceId,
    }, () => route.GET(new NextRequest(target), { params: Promise.resolve({ clientId }) }))
    const body = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) {
      throw new AgentApiError({
        code: String(body.code || (response.status === 404 ? "NOT_FOUND" : "PERMISSION_DENIED")),
        message: String(body.error || "客户资料读取失败"),
        status: response.status,
      })
    }
    return agentSuccess(body.snapshot, auth.traceId)
  } catch (error) {
    return agentError(error, traceId)
  }
}
