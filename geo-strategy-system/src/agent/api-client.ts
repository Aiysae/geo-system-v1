export class ShituAgentClientError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly traceId?: string
  readonly status: number

  constructor(input: {
    code: string
    message: string
    retryable?: boolean
    traceId?: string
    status: number
  }) {
    super(input.message)
    this.name = "ShituAgentClientError"
    this.code = input.code
    this.retryable = input.retryable === true
    this.traceId = input.traceId
    this.status = input.status
  }
}

export class ShituAgentApiClient {
  readonly baseUrl: string
  private readonly token: string
  private readonly forwardedIp?: string

  constructor(input: { baseUrl: string; token: string; forwardedIp?: string }) {
    this.baseUrl = String(input.baseUrl || "").trim().replace(/\/+$/, "")
    this.token = String(input.token || "").trim()
    this.forwardedIp = String(input.forwardedIp || "").trim() || undefined
    if (!this.baseUrl || !this.token) throw new Error("Agent API 地址和 Token 不能为空")
  }

  async request<T = unknown>(
    path: string,
    options: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {},
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api/agent/v1${path}`, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        ...(this.forwardedIp ? { "X-Forwarded-For": this.forwardedIp } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    })
    const value = await response.json().catch(() => null) as {
      ok?: boolean
      data?: T
      error?: { code?: string; message?: string; retryable?: boolean }
      meta?: { traceId?: string }
    } | null
    if (!response.ok || value?.ok === false) {
      throw new ShituAgentClientError({
        code: value?.error?.code || `HTTP_${response.status}`,
        message: value?.error?.message || `Agent API 请求失败（HTTP ${response.status}）`,
        retryable: value?.error?.retryable,
        traceId: value?.meta?.traceId,
        status: response.status,
      })
    }
    return (value?.data ?? value) as T
  }
}

export function agentQuery(input: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue
    params.set(key, String(value))
  }
  const value = params.toString()
  return value ? `?${value}` : ""
}
