import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { createShituGeoMcpServer } from "@/agent/mcp-server"
import { AgentApiError, agentError, readBoundedAgentBody, requireAgentAuth } from "@/lib/agent/api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60
const MAX_MCP_BODY_BYTES = 24 * 1024 * 1024

const CORS_BASE = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "MCP-Protocol-Version, MCP-Session-Id",
}

function bearer(request: Request): string {
  return String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim()
}

function assertAllowedOrigin(request: Request): void {
  const origin = String(request.headers.get("origin") || "").trim()
  if (!origin) return
  const configured = [
    process.env.PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    ...(process.env.AGENT_MCP_ALLOWED_ORIGINS || "").split(","),
  ].map(value => String(value || "").trim().replace(/\/+$/, "")).filter(Boolean)
  if (process.env.NODE_ENV !== "production") {
    configured.push("http://localhost:3000", "http://127.0.0.1:3000")
  }
  if (configured.includes(origin.replace(/\/+$/, ""))) return
  throw new AgentApiError({
    code: "MCP_ORIGIN_DENIED",
    message: "当前页面来源不允许连接 Agent",
    status: 403,
  })
}

function corsHeaders(request: Request, source?: HeadersInit): Headers {
  const headers = new Headers(source)
  for (const [key, value] of Object.entries(CORS_BASE)) headers.set(key, value)
  const origin = String(request.headers.get("origin") || "").trim()
  headers.set("Access-Control-Allow-Origin", origin || "*")
  if (origin) headers.append("Vary", "Origin")
  return headers
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
    assertAllowedOrigin(request)
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
    const headers = corsHeaders(request, response.headers)
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  } catch (error) {
    const response = agentError(error)
    const headers = corsHeaders(request, response.headers)
    return new Response(response.body, { status: response.status, headers })
  }
}

export async function OPTIONS(request: Request) {
  try {
    assertAllowedOrigin(request)
    return new Response(null, { status: 204, headers: corsHeaders(request) })
  } catch (error) {
    const response = agentError(error)
    return new Response(response.body, {
      status: response.status,
      headers: corsHeaders(request, response.headers),
    })
  }
}

export async function GET(request: Request) {
  return Response.json(
    { error: "MCP 远程端点仅接受 Streamable HTTP POST 请求" },
    { status: 405, headers: corsHeaders(request, { Allow: "POST, OPTIONS" }) },
  )
}
