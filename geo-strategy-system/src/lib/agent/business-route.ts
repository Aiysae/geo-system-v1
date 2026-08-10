import "server-only"

import { NextRequest } from "next/server"
import { AgentApiError } from "@/lib/agent/api"
import { runWithAgentActor } from "@/lib/agent/actor-context"
import type { AgentAuthContext } from "@/types/agent"

type BusinessHandler = (request: NextRequest) => Promise<Response>

async function businessBody(response: Response): Promise<unknown> {
  const contentType = String(response.headers.get("content-type") || "")
  if (contentType.includes("application/json")) return response.json().catch(() => ({}))
  return { message: (await response.text().catch(() => "")).slice(0, 2_000) }
}

function codeForStatus(status: number): string {
  if (status === 400) return "INVALID_ARGUMENT"
  if (status === 401) return "AUTHENTICATION_REQUIRED"
  if (status === 403) return "PERMISSION_DENIED"
  if (status === 404) return "NOT_FOUND"
  if (status === 409) return "CONFLICT"
  if (status === 413) return "PAYLOAD_TOO_LARGE"
  if (status === 429) return "RATE_LIMITED"
  return "UPSTREAM_ACTION_FAILED"
}

export async function invokeAgentBusinessRoute(input: {
  auth: AgentAuthContext
  origin: string
  path: string
  handler: BusinessHandler
  method?: "GET" | "POST" | "PATCH" | "DELETE"
  body?: Record<string, unknown>
}): Promise<{ response: Response; data?: unknown }> {
  const body = input.body === undefined ? undefined : JSON.stringify(input.body)
  const request = new NextRequest(new URL(input.path, input.origin), {
    method: input.method || "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      "X-Request-Id": input.auth.traceId,
      "X-Agent-Token-Id": input.auth.token.id,
    },
    body,
  })
  const response = await runWithAgentActor({
    userId: input.auth.userId,
    tokenId: input.auth.token.id,
    traceId: input.auth.traceId,
  }, () => input.handler(request))
  if (response.ok && !String(response.headers.get("content-type") || "").includes("application/json")) {
    return { response }
  }
  const data = await businessBody(response)
  if (!response.ok) {
    const record = data && typeof data === "object" && !Array.isArray(data)
      ? data as Record<string, unknown>
      : {}
    throw new AgentApiError({
      code: String(record.code || codeForStatus(response.status)),
      message: String(record.error || record.message || "业务请求失败"),
      status: response.status,
      retryable: response.status >= 500 || response.status === 409 || response.status === 429,
    })
  }
  return { response, data }
}
