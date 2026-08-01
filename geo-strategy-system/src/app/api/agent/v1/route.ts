export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const origin = new URL(request.url).origin
  return Response.json({
    name: "势途 GEO Agent API",
    version: "v1",
    openapi: `${origin}/api/agent/v1/openapi.json`,
    capabilities: `${origin}/api/agent/v1/capabilities`,
  }, { headers: { "Cache-Control": "public, max-age=300" } })
}
