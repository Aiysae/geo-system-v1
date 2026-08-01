import "server-only"

import { createHash, randomUUID } from "node:crypto"
import { getAgentExecutionEligibility } from "@/lib/agent/eligibility"
import { hasAgentScope } from "@/lib/agent/scopes"
import {
  agentTokenAllowsClient,
  authenticateAgentToken,
} from "@/lib/agent/store"
import {
  getClientIp,
  hitRateLimit,
  releaseRateLimitReservation,
  reserveRateLimit,
} from "@/lib/rate-limit"
import { kv } from "@/lib/kv"
import type {
  AgentApiErrorBody,
  AgentApiSuccess,
  AgentAuthContext,
  AgentScope,
} from "@/types/agent"

export class AgentApiError extends Error {
  readonly code: string
  readonly status: number
  readonly retryable: boolean
  readonly details?: Record<string, unknown>

  constructor(input: {
    code: string
    message: string
    status: number
    retryable?: boolean
    details?: Record<string, unknown>
  }) {
    super(input.message)
    this.name = "AgentApiError"
    this.code = input.code
    this.status = input.status
    this.retryable = input.retryable === true
    this.details = input.details
  }
}

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name]
  if (value === undefined || value === "") return fallback
  return /^(1|true|yes|on)$/i.test(value)
}

export function agentApiEnabled(): boolean {
  return envFlag("AGENT_API_ENABLED", process.env.NODE_ENV !== "production")
}

export function agentTokenManagementEnabled(): boolean {
  return envFlag("AGENT_TOKEN_MANAGEMENT_ENABLED", process.env.NODE_ENV !== "production")
}

function traceId(request: Request): string {
  const supplied = String(request.headers.get("x-request-id") || "").trim()
  return /^[A-Za-z0-9_-]{8,160}$/.test(supplied)
    ? supplied
    : `trace_${randomUUID().replace(/-/g, "")}`
}

function bearerToken(request: Request): string {
  const header = String(request.headers.get("authorization") || "").trim()
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ""
}

function requestIp(request: Request): string {
  return request.headers.get("cf-connecting-ip")?.trim() || getClientIp(request)
}

export async function requireAgentAuth(
  request: Request,
  requiredScopes: readonly AgentScope[] = [],
  options: { consumeRateLimit?: boolean } = {},
): Promise<AgentAuthContext> {
  const currentTraceId = traceId(request)
  if (!agentApiEnabled()) {
    throw new AgentApiError({
      code: "AGENT_API_DISABLED",
      message: "Agent 接口当前未开放",
      status: 503,
      retryable: false,
    })
  }

  const raw = bearerToken(request)
  if (!raw) {
    throw new AgentApiError({
      code: "AUTHENTICATION_REQUIRED",
      message: "请在 Authorization 请求头中提供 Agent Bearer Token",
      status: 401,
    })
  }
  const token = await authenticateAgentToken(raw)
  if (!token) {
    throw new AgentApiError({
      code: "INVALID_AGENT_TOKEN",
      message: "Agent 密钥无效、已过期或已撤销",
      status: 401,
    })
  }

  const eligibility = await getAgentExecutionEligibility(token.ownerUserId)
  if (!eligibility.eligible) {
    throw new AgentApiError({
      code: "AGENT_ACCESS_SUSPENDED",
      message: eligibility.reason || "当前账号暂时不能使用 Agent",
      status: 403,
    })
  }

  const ip = requestIp(request)
  if (token.allowedIps.length > 0 && !token.allowedIps.includes(ip)) {
    throw new AgentApiError({
      code: "AGENT_IP_DENIED",
      message: "当前网络地址不在 Agent 密钥允许范围内",
      status: 403,
      details: { ip },
    })
  }

  for (const scope of requiredScopes) {
    if (!hasAgentScope(token.scopes, scope)) {
      throw new AgentApiError({
        code: "AGENT_SCOPE_DENIED",
        message: `Agent 密钥缺少 ${scope} 权限`,
        status: 403,
        details: { requiredScope: scope },
      })
    }
  }

  if (options.consumeRateLimit !== false) {
    const rate = await hitRateLimit(
      "agent-api",
      token.id,
      token.rateLimitPerMinute,
      60,
    )
    if (!rate.ok) {
      throw new AgentApiError({
        code: "RATE_LIMITED",
        message: "Agent 请求过于频繁，请稍后重试",
        status: 429,
        retryable: true,
        details: { retryAfterMs: Math.max(1_000, rate.resetAt - Date.now()) },
      })
    }
  }

  return {
    token,
    userId: token.ownerUserId,
    traceId: currentTraceId,
    ip,
  }
}

export function assertAgentClientGrant(
  auth: AgentAuthContext,
  clientId: string,
  teamId?: string,
): void {
  if (agentTokenAllowsClient(auth.token, clientId, teamId)) return
  throw new AgentApiError({
    code: "AGENT_CLIENT_DENIED",
    message: "该 Agent 密钥未被授权访问当前客户",
    status: 403,
    details: { clientId, teamId },
  })
}

function shanghaiDay(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

export async function reserveAgentCreditBudget(
  auth: AgentAuthContext,
  credits: number,
  dedupeKey?: string,
): Promise<{
  commit: () => Promise<void>
  release: () => Promise<void>
  reused: boolean
}> {
  const amount = Math.max(0, Math.floor(Number(credits) || 0))
  if (amount === 0) {
    return {
      commit: async () => undefined,
      release: async () => undefined,
      reused: false,
    }
  }
  if (auth.token.maxTaskCredits === 0 || amount > auth.token.maxTaskCredits) {
    throw new AgentApiError({
      code: "AGENT_TASK_BUDGET_EXCEEDED",
      message: `本次预计 ${amount} 积分，超过 Agent 单任务上限 ${auth.token.maxTaskCredits} 积分`,
      status: 403,
      details: { estimatedCredits: amount, maxTaskCredits: auth.token.maxTaskCredits },
    })
  }
  if (auth.token.dailyCreditLimit === 0) {
    throw new AgentApiError({
      code: "AGENT_DAILY_BUDGET_EXCEEDED",
      message: "该 Agent 密钥没有可用的每日执行预算",
      status: 403,
    })
  }

  const marker = dedupeKey
    ? `geo:agent-budget-request:${auth.token.id}:${createHash("sha256").update(dedupeKey).digest("hex").slice(0, 40)}`
    : ""
  if (marker) {
    try {
      const completed = await kv.get<string>(marker)
      if (completed !== null && completed !== undefined) {
        return {
          commit: async () => undefined,
          release: async () => undefined,
          reused: true,
        }
      }
    } catch (error) {
      console.warn("[agent-budget] idempotency lookup unavailable", error)
    }
  }

  const identifier = `${auth.token.id}:${shanghaiDay()}`
  const budget = await reserveRateLimit(
    "agent-daily-credits",
    identifier,
    amount,
    auth.token.dailyCreditLimit,
    36 * 60 * 60,
  )
  if (!budget.ok) {
    throw new AgentApiError({
      code: "AGENT_DAILY_BUDGET_EXCEEDED",
      message: `该 Agent 今日执行预算不足，本次预计需要 ${amount} 积分`,
      status: 403,
      details: {
        estimatedCredits: amount,
        dailyCreditLimit: auth.token.dailyCreditLimit,
      },
    })
  }
  let settled = false
  return {
    reused: false,
    commit: async () => {
      if (settled) return
      if (!marker) {
        settled = true
        return
      }
      try {
        const claimed = Boolean(await kv.set(marker, String(amount), { nx: true, ex: 36 * 60 * 60 }))
        if (!claimed) {
          settled = true
          await releaseRateLimitReservation("agent-daily-credits", identifier, amount)
          return
        }
      } catch (error) {
        console.warn("[agent-budget] idempotency commit unavailable", error)
      }
      settled = true
    },
    release: async () => {
      if (settled) return
      settled = true
      await releaseRateLimitReservation("agent-daily-credits", identifier, amount)
    },
  }
}

function headers(trace: string): HeadersInit {
  return {
    "Cache-Control": "private, no-store, no-cache, must-revalidate",
    "X-Trace-Id": trace,
  }
}

export function agentSuccess<T>(
  data: T,
  trace: string,
  requestId?: string,
  status = 200,
): Response {
  const body: AgentApiSuccess<T> = {
    ok: true,
    data,
    meta: {
      traceId: trace,
      requestId,
      serverTime: new Date().toISOString(),
    },
  }
  return Response.json(body, { status, headers: headers(trace) })
}

function inferredError(error: unknown): AgentApiError {
  if (error instanceof AgentApiError) return error
  if (error instanceof SyntaxError) {
    return new AgentApiError({ code: "INVALID_JSON", message: "请求正文不是有效的 JSON", status: 400 })
  }
  const message = error instanceof Error ? error.message : "Agent 请求处理失败"
  if (/权限|无权|只读|VIP/.test(message)) {
    return new AgentApiError({ code: "PERMISSION_DENIED", message, status: 403 })
  }
  if (/无效|缺失|不能为空|至少|最多|必须|不一致/.test(message)) {
    return new AgentApiError({ code: "INVALID_ARGUMENT", message, status: 400 })
  }
  console.error("[agent-api] internal error", error)
  return new AgentApiError({
    code: "INTERNAL_ERROR",
    message: process.env.NODE_ENV === "production" ? "Agent 服务暂时不可用，请稍后重试" : message,
    status: 500,
    retryable: true,
  })
}

export function agentError(
  error: unknown,
  trace = `trace_${randomUUID().replace(/-/g, "")}`,
  requestId?: string,
): Response {
  const normalized = inferredError(error)
  const body: AgentApiErrorBody = {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      retryable: normalized.retryable,
      details: normalized.details,
    },
    meta: { traceId: trace, requestId },
  }
  return Response.json(body, {
    status: normalized.status,
    headers: headers(trace),
  })
}

export async function readAgentJson(
  request: Request,
  maxBytes = 22 * 1024 * 1024,
): Promise<Record<string, unknown>> {
  const bytes = await readBoundedAgentBody(request, maxBytes)
  const value = JSON.parse(new TextDecoder().decode(bytes))
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentApiError({
      code: "INVALID_ARGUMENT",
      message: "请求正文必须是 JSON 对象",
      status: 400,
    })
  }
  return value as Record<string, unknown>
}

export async function readBoundedAgentBody(
  request: Request,
  maxBytes = 22 * 1024 * 1024,
): Promise<Uint8Array<ArrayBuffer>> {
  const contentLength = Number(request.headers.get("content-length") || 0)
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new AgentApiError({
      code: "PAYLOAD_TOO_LARGE",
      message: "Agent 请求数据超过允许大小",
      status: 413,
    })
  }
  if (!request.body) return new Uint8Array()

  const reader = request.body.getReader()
  const chunks: Uint8Array<ArrayBufferLike>[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel("payload too large").catch(() => undefined)
        throw new AgentApiError({
          code: "PAYLOAD_TOO_LARGE",
          message: "Agent 请求数据超过允许大小",
          status: 413,
        })
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}
