import "server-only"

import { NextRequest } from "next/server"
import { AgentApiError } from "@/lib/agent/api"
import { runWithAgentActor } from "@/lib/agent/actor-context"
import type { AgentActionName, AgentAuthContext } from "@/types/agent"

export type AgentActionDispatchResult = {
  status: number
  data: unknown
}

type RoutePost = (request: NextRequest) => Promise<Response>

async function routeForAction(action: AgentActionName): Promise<{
  path: string
  post: RoutePost
}> {
  if (action === "penetration.run") {
    const route = await import("@/app/api/penetration/jobs/route")
    return { path: "/api/penetration/jobs", post: route.POST }
  }
  if (action === "difficulty.run") {
    const route = await import("@/app/api/difficulty-assessment/jobs/route")
    return { path: "/api/difficulty-assessment/jobs", post: route.POST }
  }
  if (action === "background.run") {
    const route = await import("@/app/api/background-jobs/route")
    return { path: "/api/background-jobs", post: route.POST }
  }
  if (action === "article.batch.run") {
    const route = await import("@/app/api/article-generation/batches/route")
    return { path: "/api/article-generation/batches", post: route.POST }
  }
  const route = await import("@/app/api/reports/jobs/route")
  return { path: "/api/reports/jobs", post: route.POST }
}

function businessErrorCode(status: number, body: unknown): string {
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
  const supplied = String(record.code || "").trim()
  if (supplied) return supplied
  const message = String(record.error || "")
  if (/Insufficient credits|积分不足/.test(message)) return "INSUFFICIENT_CREDITS"
  if (status === 400) return "INVALID_ARGUMENT"
  if (status === 401) return "AUTHENTICATION_REQUIRED"
  if (status === 403) return "PERMISSION_DENIED"
  if (status === 404) return "NOT_FOUND"
  if (status === 409) return "CONFLICT"
  if (status === 413) return "PAYLOAD_TOO_LARGE"
  if (status === 429) return "RATE_LIMITED"
  return "UPSTREAM_ACTION_FAILED"
}

async function responseBody(response: Response): Promise<unknown> {
  const contentType = String(response.headers.get("content-type") || "")
  if (contentType.includes("application/json")) {
    return response.json().catch(() => ({}))
  }
  const value = await response.text().catch(() => "")
  return value ? { message: value.slice(0, 2_000) } : {}
}

export async function dispatchAgentAction(input: {
  action: AgentActionName
  payload: Record<string, unknown>
  auth: AgentAuthContext
  origin: string
}): Promise<AgentActionDispatchResult> {
  const route = await routeForAction(input.action)
  const body = JSON.stringify(input.payload)
  const request = new NextRequest(new URL(route.path, input.origin), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body, "utf8")),
      "X-Request-Id": input.auth.traceId,
      "X-Agent-Token-Id": input.auth.token.id,
    },
    body,
  })

  const response = await runWithAgentActor({
    userId: input.auth.userId,
    tokenId: input.auth.token.id,
    traceId: input.auth.traceId,
  }, () => route.post(request))
  const data = await responseBody(response)
  if (!response.ok) {
    const record = data && typeof data === "object" && !Array.isArray(data)
      ? data as Record<string, unknown>
      : {}
    const message = String(record.error || record.message || "Agent 业务任务提交失败")
    throw new AgentApiError({
      code: businessErrorCode(response.status, data),
      message,
      status: response.status,
      retryable: response.status >= 500 || response.status === 409 || response.status === 429,
      details: {
        businessStatus: response.status,
        ...(Array.isArray(record.skipped) ? { skipped: record.skipped } : {}),
      },
    })
  }
  return { status: response.status, data }
}
