import { chooseDefaultArticleModel, listArticleModelCatalog } from "@/lib/article-models"
import { ARTICLE_PROMPT_OPTIONS } from "@/lib/article-prompt-meta"
import {
  AgentApiError,
  agentError,
  agentSuccess,
  requireAgentAuth,
} from "@/lib/agent/api"
import { hasAgentScope } from "@/lib/agent/scopes"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  let traceId: string | undefined
  try {
    const auth = await requireAgentAuth(request)
    traceId = auth.traceId
    if (!hasAgentScope(auth.token.scopes, "article.view")) {
      throw new AgentApiError({
        code: "AGENT_SCOPE_DENIED",
        message: "Agent 密钥缺少 article.view 权限",
        status: 403,
      })
    }
    const catalog = await listArticleModelCatalog()
    return agentSuccess({
      prompts: ARTICLE_PROMPT_OPTIONS,
      providers: catalog.providers,
      gateways: catalog.gateways,
      defaultModel: chooseDefaultArticleModel(catalog),
    }, auth.traceId)
  } catch (error) {
    return agentError(error, traceId)
  }
}
