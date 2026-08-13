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

type RouteHandler = (request: NextRequest) => Promise<Response>

type DedicatedBackgroundAction =
  | "penetration.questions.generate"
  | "research.run"
  | "research.compare"
  | "diagnosis.run"
  | "keyword.extract"
  | "keyword.advantages"
  | "keyword.strategy.run"
  | "keyword.website-prompt.run"
  | "article.generate"
  | "article.rewrite"

const BACKGROUND_ACTION_KIND: Record<DedicatedBackgroundAction, string> = {
  "research.run": "research",
  "research.compare": "competitorCompare",
  "diagnosis.run": "diagnosis",
  "keyword.extract": "keywordExtract",
  "keyword.advantages": "keywordAdvantages",
  "keyword.strategy.run": "keywordStrategy",
  "keyword.website-prompt.run": "keywordWebsitePrompt",
  "article.generate": "articleGeneration",
  "article.rewrite": "articleGeneration",
  "penetration.questions.generate": "queryGeneration",
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
  handler: RouteHandler
  method?: "GET" | "POST" | "PATCH" | "DELETE"
  payload?: Record<string, unknown>
  body?: BodyInit
}> {
  if (action === "penetration.run") {
    const route = await import("@/app/api/penetration/jobs/route")
    return { path: "/api/penetration/jobs", handler: route.POST, payload }
  }
  if (action === "penetration.automation.get") {
    const route = await import("@/app/api/penetration/automations/route")
    const query = new URLSearchParams({ clientId: String(payload.clientId || "") })
    if (payload.teamId) query.set("teamId", String(payload.teamId))
    return {
      path: `/api/penetration/automations?${query}`,
      handler: route.GET,
      method: "GET",
    }
  }
  if (action === "penetration.automation.save") {
    const route = await import("@/app/api/penetration/automations/route")
    return { path: "/api/penetration/automations", handler: route.POST, payload }
  }
  if (action === "penetration.automation.set-status") {
    const route = await import("@/app/api/penetration/automations/[scheduleId]/route")
    const scheduleId = String(payload.scheduleId || "")
    return {
      path: `/api/penetration/automations/${encodeURIComponent(scheduleId)}`,
      handler: request => route.PATCH(request, { params: Promise.resolve({ scheduleId }) }),
      method: "PATCH",
      payload: {
        clientId: payload.clientId,
        teamId: payload.teamId,
        action: payload.status === "paused" ? "pause" : "resume",
      },
    }
  }
  if (action === "penetration.automation.run") {
    const route = await import("@/app/api/penetration/automations/[scheduleId]/run/route")
    const scheduleId = String(payload.scheduleId || "")
    return {
      path: `/api/penetration/automations/${encodeURIComponent(scheduleId)}/run`,
      handler: request => route.POST(request, { params: Promise.resolve({ scheduleId }) }),
      payload: { clientId: payload.clientId, teamId: payload.teamId },
    }
  }
  if (action === "penetration.automation.delete") {
    const route = await import("@/app/api/penetration/automations/[scheduleId]/route")
    const scheduleId = String(payload.scheduleId || "")
    const query = new URLSearchParams({ clientId: String(payload.clientId || "") })
    if (payload.teamId) query.set("teamId", String(payload.teamId))
    return {
      path: `/api/penetration/automations/${encodeURIComponent(scheduleId)}?${query}`,
      handler: request => route.DELETE(request, { params: Promise.resolve({ scheduleId }) }),
      method: "DELETE",
    }
  }
  if (action === "difficulty.run") {
    const route = await import("@/app/api/difficulty-assessment/jobs/route")
    return { path: "/api/difficulty-assessment/jobs", handler: route.POST, payload }
  }
  if (action === "background.run") {
    const route = await import("@/app/api/background-jobs/route")
    return { path: "/api/background-jobs", handler: route.POST, payload }
  }
  if (
    action === "penetration.questions.generate"
    || action === "research.run"
    || action === "research.compare"
    || action === "diagnosis.run"
    || action === "keyword.extract"
    || action === "keyword.advantages"
    || action === "keyword.strategy.run"
    || action === "keyword.website-prompt.run"
    || action === "article.generate"
    || action === "article.rewrite"
  ) {
    const backgroundKind = BACKGROUND_ACTION_KIND[action]
    const route = await import("@/app/api/background-jobs/route")
    return {
      path: "/api/background-jobs",
      handler: route.POST,
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
    return { path: "/api/geo-strategy/question-jobs", handler: route.POST, payload }
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
    return { path: "/api/knowledge-base/imports", handler: route.POST, body: form }
  }
  if (action === "knowledge.commit") {
    const route = await import("@/app/api/knowledge-base/imports/[importId]/commit/route")
    const importId = String(payload.importId || "")
    const query = new URLSearchParams({ clientId: String(payload.clientId || "") })
    if (payload.teamId) query.set("teamId", String(payload.teamId))
    return {
      path: `/api/knowledge-base/imports/${encodeURIComponent(importId)}/commit?${query}`,
      handler: request => route.POST(request, { params: Promise.resolve({ importId }) }),
      payload: { candidates: payload.candidates },
    }
  }
  if (action === "article.strategy.plan") {
    const route = await import("@/app/api/article-generation/strategy-plan/route")
    return { path: "/api/article-generation/strategy-plan", handler: route.POST, payload }
  }
  if (action === "article.source.extract") {
    const route = await import("@/app/api/article-generation/extract-url/route")
    return { path: "/api/article-generation/extract-url", handler: route.POST, payload }
  }
  if (action === "article.brands.analyze") {
    const route = await import("@/app/api/article-generation/analyze-brands/route")
    return { path: "/api/article-generation/analyze-brands", handler: route.POST, payload }
  }
  if (action === "article.materials.list") {
    const route = await import("@/app/api/article-generation/question-materials/route")
    const query = new URLSearchParams({ clientId: String(payload.clientId || "") })
    if (payload.teamId) query.set("teamId", String(payload.teamId))
    query.set("page", String(payload.page || 1))
    query.set("pageSize", String(payload.pageSize || 100))
    return {
      path: `/api/article-generation/question-materials?${query}`,
      handler: route.GET,
      method: "GET",
    }
  }
  if (action === "article.materials.import") {
    const route = await import("@/app/api/article-generation/question-materials/route")
    return {
      path: "/api/article-generation/question-materials",
      handler: route.POST,
      payload: {
        ...payload,
        importBatchId: payload.importBatchId || `aqi_${createHash("sha256")
          .update(String(payload.requestId || ""))
          .digest("hex")
          .slice(0, 32)}`,
      },
    }
  }
  if (action === "article.materials.delete") {
    const route = await import("@/app/api/article-generation/question-materials/route")
    return {
      path: "/api/article-generation/question-materials",
      handler: route.DELETE,
      method: "DELETE",
      payload,
    }
  }
  if (action === "article.media.upload") {
    const route = await import("@/app/api/article-generation/assets/route")
    const form = new FormData()
    form.set("clientId", String(payload.clientId || ""))
    form.set("batchId", String(payload.batchId || ""))
    for (const raw of Array.isArray(payload.files) ? payload.files : []) {
      const file = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}
      const buffer = Buffer.from(String(file.base64 || ""), "base64")
      form.append("files", new File([buffer], String(file.name || "image.bin"), {
        type: String(file.mimeType || "application/octet-stream"),
      }))
    }
    return { path: "/api/article-generation/assets", handler: route.POST, body: form }
  }
  if (action === "article.media.run") {
    const route = await import("@/app/api/article-generation/batches/[batchId]/media-jobs/route")
    const batchId = String(payload.batchId || "")
    return {
      path: `/api/article-generation/batches/${encodeURIComponent(batchId)}/media-jobs`,
      handler: request => route.POST(request, { params: Promise.resolve({ batchId }) }),
      payload: {
        clientId: payload.clientId,
        requestId: payload.requestId,
        itemIds: payload.itemIds,
        assetIds: payload.assetIds,
        itemAssetMap: payload.itemAssetMap,
        template: payload.template,
        mappingMode: payload.mappingMode,
      },
    }
  }
  if (action === "article.batch.run") {
    const route = await import("@/app/api/article-generation/batches/route")
    return { path: "/api/article-generation/batches", handler: route.POST, payload }
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
      handler: request => route.POST(request, { params: Promise.resolve({ clientId }) }),
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
      handler: request => route.POST(request, { params: Promise.resolve({ clientId }) }),
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
      handler: request => route.POST(request, { params: Promise.resolve({ clientId }) }),
      payload: {
        teamId: payload.teamId,
        type: payload.type,
        targetDate: payload.targetDate,
        baselineHistoryRecordId: payload.baselineHistoryRecordId,
        currentHistoryRecordId: payload.currentHistoryRecordId,
        publish: payload.publish,
        requestId: payload.requestId,
      },
    }
  }
  if (action === "feedback.report.options") {
    const route = await import("@/app/api/client-feedback/[clientId]/report-options/route")
    const clientId = String(payload.clientId || "")
    const query = new URLSearchParams({
      type: String(payload.type || "weekly"),
    })
    if (payload.targetDate) query.set("targetDate", String(payload.targetDate))
    if (payload.teamId) query.set("teamId", String(payload.teamId))
    return {
      path: `/api/client-feedback/${encodeURIComponent(clientId)}/report-options?${query}`,
      handler: request => route.GET(request, { params: Promise.resolve({ clientId }) }),
      method: "GET",
    }
  }
  if (action === "feedback.report.manage") {
    const route = await import("@/app/api/client-feedback/[clientId]/reports/[reportId]/route")
    const clientId = String(payload.clientId || "")
    const reportId = String(payload.reportId || "")
    const query = new URLSearchParams()
    if (payload.teamId) query.set("teamId", String(payload.teamId))
    const suffix = query.size ? `?${query}` : ""
    const path = `/api/client-feedback/${encodeURIComponent(clientId)}/reports/${encodeURIComponent(reportId)}${suffix}`
    if (payload.operation === "delete") {
      return {
        path,
        handler: request => route.DELETE(request, { params: Promise.resolve({ clientId, reportId }) }),
        method: "DELETE",
      }
    }
    return {
      path,
      handler: request => route.PATCH(request, { params: Promise.resolve({ clientId, reportId }) }),
      method: "PATCH",
      payload: {
        teamId: payload.teamId,
        action: payload.operation === "revoke-share" ? "revoke-share" : "publish",
      },
    }
  }
  if (action === "feedback.profile.update") {
    const route = await import("@/app/api/client-feedback/[clientId]/route")
    const clientId = String(payload.clientId || "")
    return {
      path: `/api/client-feedback/${encodeURIComponent(clientId)}`,
      handler: request => route.PATCH(request, { params: Promise.resolve({ clientId }) }),
      method: "PATCH",
      payload: { teamId: payload.teamId, patch: payload.patch },
    }
  }
  if (action === "feedback.visibility.update") {
    const route = await import("@/app/api/client-feedback/[clientId]/actions/publication/route")
    const clientId = String(payload.clientId || "")
    return {
      path: `/api/client-feedback/${encodeURIComponent(clientId)}/actions/publication`,
      handler: request => route.PATCH(request, { params: Promise.resolve({ clientId }) }),
      method: "PATCH",
      payload: {
        teamId: payload.teamId,
        action: payload.mode === "default-penetration" ? "set-default" : "set-actions",
        actionIds: payload.actionIds,
        publication: payload.publication,
      },
    }
  }
  if (action === "report.create") {
    const route = await import("@/app/api/reports/jobs/route")
    return { path: "/api/reports/jobs", handler: route.POST, payload }
  }
  const exhaustive: never = action
  throw new Error(`Agent 动作 ${exhaustive} 尚未配置业务路由`)
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
  const nestedJob = record.job && typeof record.job === "object"
    ? record.job as Record<string, unknown>
    : {}
  const sourceJobId = String(
    record.id || nestedImport.backgroundJobId || nestedJob.id || "",
  ).trim()
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
  const jsonBody = route.body === undefined && route.payload !== undefined
    ? JSON.stringify(route.payload)
    : undefined
  const body = route.body ?? jsonBody
  const bodyLength = typeof jsonBody === "string" ? Buffer.byteLength(jsonBody, "utf8") : undefined
  const request = new NextRequest(new URL(route.path, input.origin), {
    method: route.method || "POST",
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
  }, () => route.handler(request))
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
