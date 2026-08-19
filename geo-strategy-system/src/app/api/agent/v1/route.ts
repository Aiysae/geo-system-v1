import { agentPublicOrigin } from "@/lib/agent/public-origin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const origin = agentPublicOrigin(request)
  return Response.json({
    name: "势途 GEO Agent API",
    version: "v1.10",
    openapi: `${origin}/api/agent/v1/openapi.json`,
    capabilities: `${origin}/api/agent/v1/capabilities`,
    planner: `${origin}/api/agent/v1/plan`,
  }, { headers: { "Cache-Control": "public, max-age=300" } })
}
