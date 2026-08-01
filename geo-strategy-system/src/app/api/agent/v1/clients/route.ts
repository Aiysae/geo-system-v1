import { agentError, agentSuccess, requireAgentAuth } from "@/lib/agent/api"
import { agentTokenAllowsClient } from "@/lib/agent/store"
import { listClientCatalog } from "@/lib/client-access-catalog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  let traceId: string | undefined
  try {
    const auth = await requireAgentAuth(request, ["client.view"])
    traceId = auth.traceId
    const catalog = await listClientCatalog(auth.userId)
    const clients = catalog
      .filter(client => agentTokenAllowsClient(auth.token, client.id, client.teamId))
      .map(client => ({
        id: client.id,
        name: client.name,
        ourBrand: client.ourBrand,
        subjectType: client.subjectType,
        industry: client.industry,
        website: client.website,
        teamId: client.teamId,
        teamName: client.teamName,
        sourceType: client.sourceType,
        canEdit: client.canEdit,
        updatedAt: client.updatedAt,
      }))
    return agentSuccess({ clients, total: clients.length }, auth.traceId)
  } catch (error) {
    return agentError(error, traceId)
  }
}
