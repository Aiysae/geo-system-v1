import { agentOpenApiDocument } from "@/lib/agent/openapi"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return Response.json(agentOpenApiDocument(new URL(request.url).origin), {
    headers: { "Cache-Control": "public, max-age=300" },
  })
}
