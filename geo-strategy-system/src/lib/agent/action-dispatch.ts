import "server-only"

import { createHash } from "crypto"
import { NextRequest } from "next/server"
import { AGENT_ACTION_REGISTRY } from "@/lib/agent/action-catalog"
import { AgentApiError } from "@/lib/agent/api"
import { runWithAgentActor } from "@/lib/agent/actor-context"
import { taskCenterTaskId } from "@/lib/task-center/store"
import type { AgentActionName, AgentAuthContext } from "@/types/agent"
import type { TaskCenterSource } from "@/types/task-center"

export type AgentSubmittedTask = {
  taskId: string
  sourceJobId: string
  statusUrl: string
  resultUrl: string
}

export type AgentActionDispatchResult = {
  status: number
  data: unknown
  task?: AgentSubmittedTask
}

type RoutePost = (request: NextRequest) => Promise<Response>

const BACKGROUND_ACTION_KIND: Partial<Record<AgentActionName, string>> = {
  "research.run": "research",
  "research.compare": "competitorCompare",
  "diagnosis.run": "diagnosis",
  "keyword.extract": "keywordExtract",
  "keyword.advantages": "keywordAdvantages",
  "keyword.strategy.run": "keywordStrategy",
  "keyword.website-prompt.run": "keywordWebsitePrompt",
  "article.generate": "articleGeneration",
  "article.rewrite": "articleGeneration",
}

function businessPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const value = { ...payload }
  delete value.clientId
  delete value.teamId
  delete value.requestId
  delete value.dryRun
  return value
}

async function routeForAction(
  action: AgentActionName,
  payload: Record<string, unknown>,
  auth: AgentAuthContext,
): Promise<{
  path: string
  post: RoutePost
  payload?: Record<string, unknown>
  body?: BodyInit
}> {
  if (action === "penetration.run") {
    const route = await import("@/app/api/penetration/jobs/route")
    return { path: "/api/penetration/jobs", post: route.POST, payload }
  }
  if (action === "difficulty.run") {
    const route = await import("@/app/api/difficulty-assessment/jobs/route")
    return { path: "/api/difficulty-assessment/jobs", post: route.POST, payload }
  }
  if (action === "background.run") {
    const route = await import("@/app/api/background-jobs/route")
    return { path: "/api/background-jobs", post: route.POST, payload }
  }
  const backgroundKind = BACKGROUND_ACTION_KIND[action]
  if (backgroundKind) {
    const route = await import("@/app/api/background-jobs/route")
    return {
      path: "/api/background-jobs",
      post: route.POST,
      payload: {
        clientId: payload.clientId,
        teamId: payload.teamId,
        requestId: payload.requestId,
        kind: backgroundKind,
        payload: businessPayload(payload),
      },
    }
  }
  if (action === "keyword.questions.run") {
    const route = await import("@/app/api/geo-strategy/question-jobs/route")
    return { path: "/api/geo-strategy/question-jobs", post: route.POST, payload }
  }
  if (action === "knowledge.import") {
    const route = await import("@/app/api/knowledge-base/imports/route")
    const form = new FormData()
    form.set("clientId", String(payload.clientId || ""))
    if (payload.teamId) form.set("teamId", String(payload.teamId))
    form.set("requestId", String(payload.requestId || ""))
    for (const raw of Array.isArray(payload.files) ? payload.files : []) {
      const file = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}
      const encoded = String(file.base64 || "")
      const buffer = Buffer.from(encoded, "base64")
      form.append("files", new File([buffer], String(file.name || "upload.bin"), {
        type: String(file.mimeType || "application/octet-stream"),
      }))
    }
    return { path: "/api/knowledge-base/imports", post: route.POST, body: form }
  }
  if (action === "knowledge.commit") {
    const route = await import("@/app/api/knowledge-base/imports/[importId]/commit/route")
    const importId = String(payload.importId || "")
    const query = new URLSearchParams({ clientId: String(payload.clientId || "") })
    if (payload.teamId) query.set("teamId", String(payload.teamId))
    return {
      path: `/api/knowledge-base/imports/${encodeURIComponent(importId)}/commit?${query}`,
      post: request => route.POST(request, { params: Promise.resolve({ importId }) }),
      payload: { candidates: payload.candidates },
    }
  }
  if (action === "article.batch.run") {
    const route = await import("@/app/api/article-generation/batches/route")
    return { path: "/api/article-generation/batches", post: route.POST, payload }
  }
  if (action === "feedback.action.create") {
    const route = await import("@/app/api/client-feedback/[clientId]/actions/route")
    const clientId = String(payload.clientId || "")
    const actionId = `cact_agent_${createHash("sha256")
      .update(`${auth.token.id}:${payload.requestId}`)
      .digest("hex")
      .slice(0, 32)}`
    return {
      path: `/api/client-feedback/${encodeURIComponent(clientId)}/actions`,
      post: request => route.POST(request, { params: Promise.resolve({ clientId }) }),
      payload: {
        teamId: payload.teamId,
        action: { ...(payload.action as Record<string, unknown>), id: actionId },
      },
    }
  }
  if (action === "feedback.actions.import") {
    const route = await import("@/app/api/client-feedback/[clientId]/actions/batch/route")
    const clientId = String(payload.clientId || "")
    return {
      path: `/api/client-feedback/${encodeURIComponent(clientId)}/actions/batch`,
      post: request => route.POST(request, { params: Promise.resolve({ clientId }) }),
      payload: {
        teamId: payload.teamId,
        importId: payload.importId || payload.requestId,
        defaults: payload.defaults,
        rows: payload.rows,
      },
    }
  }
  if (action === "feedback.report.create") {
    const route = await import("@/app/api/client-feedback/[clientId]/reports/route")
    const clientId = String(payload.clientId || "")
    return {
      path: `/api/client-feedback/${encodeURIComponent(clientId)}/reports`,
      post: request => route.POST(request, { params: Promise.resolve({ clientId }) }),
      payload: {
        teamId: payload.teamId,
        type: payload.type,
        targetDate: payload.targetDate,
        requestId: payload.requestId,
      },
    }
  }
  const route = await import("@/app/api/reports/jobs/route")
  return { path: "/api/reports/jobs", post: route.POST, payload }
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

export function buildAgentSubmittedTask(
  action: AgentActionName,
  data: unknown,
  origin: string,
): AgentSubmittedTask | undefined {
  const record = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {}
  const nestedImport = record.import && typeof record.import === "object"
    ? record.import as Record<string, unknown>
    : {}
  const sourceJobId = String(record.id || nestedImport.backgroundJobId || "").trim()
  if (!sourceJobId) return undefined
  const definition = AGENT_ACTION_REGISTRY[action]
  const source = "taskSource" in definition
    ? definition.taskSource as TaskCenterSource
    : undefined
  if (!source) return undefined
  const taskId = taskCenterTaskId(source, sourceJobId)
  return {
    taskId,
    sourceJobId,
    statusUrl: new URL(`/api/agent/v1/tasks/${encodeURIComponent(taskId)}`, origin).toString(),
    resultUrl: new URL(`/api/agent/v1/tasks/${encodeURIComponent(taskId)}/result`, origin).toString(),
  }
}

export async function dispatchAgentAction(input: {
  action: AgentActionName
  payload: Record<string, unknown>
  auth: AgentAuthContext
  origin: string
}): Promise<AgentActionDispatchResult> {
  const route = await routeForAction(input.action, input.payload, input.auth)
  const jsonBody = route.body === undefined ? JSON.stringify(route.payload || {}) : undefined
  const body = route.body ?? jsonBody
  const bodyLength = typeof jsonBody === "string" ? Buffer.byteLength(jsonBody, "utf8") : undefined
  const request = new NextRequest(new URL(route.path, input.origin), {
    method: "POST",
    headers: {
      ...(jsonBody !== undefined ? {
        "Content-Type": "application/json",
        "Content-Length": String(bodyLength),
      } : {}),
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
  return {
    status: response.status,
    data,
    task: buildAgentSubmittedTask(input.action, data, input.origin),
  }
}
