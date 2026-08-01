import { agentOpenApiDocument } from "@/lib/agent/openapi"
import { agentPublicOrigin } from "@/lib/agent/public-origin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return Response.json(agentOpenApiDocument(agentPublicOrigin(request)), {
    headers: { "Cache-Control": "public, max-age=300" },
  })
}
