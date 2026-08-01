import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { createShituGeoMcpServer } from "@/agent/mcp-server"
import { agentError, readBoundedAgentBody, requireAgentAuth } from "@/lib/agent/api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60
const MAX_MCP_BODY_BYTES = 24 * 1024 * 1024

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "MCP-Protocol-Version, MCP-Session-Id",
}

function bearer(request: Request): string {
  return String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim()
}

function internalAgentBaseUrl(): string {
  const configured = String(
    process.env.AGENT_INTERNAL_BASE_URL
      || process.env.GEO_INTERNAL_BASE_URL
      || `http://127.0.0.1:${process.env.PORT || "3000"}`,
  ).trim()
  const url = new URL(configured)
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error("AGENT_INTERNAL_BASE_URL 必须是不含账号信息的 HTTP(S) 地址")
  }
  return url.origin
}

export async function POST(request: Request) {
  try {
    const auth = await requireAgentAuth(request, [], { consumeRateLimit: false })
    const token = bearer(request)
    const server = createShituGeoMcpServer({
      baseUrl: internalAgentBaseUrl(),
      token,
      forwardedIp: auth.ip,
    })
    const body = await readBoundedAgentBody(request, MAX_MCP_BODY_BYTES)
    const boundedRequest = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: body.buffer,
    })
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    await server.connect(transport)
    const response = await transport.handleRequest(boundedRequest)
    const headers = new Headers(response.headers)
    for (const [key, value] of Object.entries(CORS)) headers.set(key, value)
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  } catch (error) {
    const response = agentError(error)
    const headers = new Headers(response.headers)
    for (const [key, value] of Object.entries(CORS)) headers.set(key, value)
    return new Response(response.body, { status: response.status, headers })
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET() {
  return Response.json(
    { error: "MCP 远程端点仅接受 Streamable HTTP POST 请求" },
    { status: 405, headers: { ...CORS, Allow: "POST, OPTIONS" } },
  )
}
