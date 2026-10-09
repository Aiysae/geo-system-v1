import { toUserFacingError } from "@/lib/user-facing-errors"

// 模块级桥接器：让客户端组件中的 fetch wrapper 能回调 React Context。
// CreditsProvider 在 mount 时注册回调；apiFetch 在收到 403 时触发。

type Handlers = {
  onInsufficient: (info: { required?: number; balance?: number; message?: string }) => void
  onSuccess: () => void
}

let handlers: Handlers | null = null

export function registerCreditsHandlers(h: Handlers) {
  handlers = h
}

export function unregisterCreditsHandlers() {
  handlers = null
}

// 任务轮询每 2-3 秒发一次 GET；每次成功都刷新余额会让 /api/credits 请求量翻倍。
// GET 只按此间隔刷新（任务结算后余额仍能及时更新），写操作成功则立即刷新。
const READ_REFRESH_INTERVAL_MS = 10_000
let lastReadRefreshAt = 0

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const method = init?.method || (input instanceof Request ? input.method : "GET")
  return method.toUpperCase()
}

function shouldRefreshCredits(method: string): boolean {
  if (method !== "GET" && method !== "HEAD") return true
  const now = Date.now()
  if (now - lastReadRefreshAt < READ_REFRESH_INTERVAL_MS) return false
  lastReadRefreshAt = now
  return true
}

/**
 * 包裹 fetch：
 *  - 收到 403 Insufficient credits → 触发全局弹窗
 *  - 成功（2xx）→ 通知 provider 刷新余额（GET 按间隔节流）
 *  - 其它情况照常返回 Response 给调用者继续处理
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let res: Response

  try {
    res = await fetch(input, {
      cache: "no-store",
      ...init,
    })
  } catch (error) {
    throw new Error(toUserFacingError(error, {
      fallback: "请求未完成，请稍后重试。",
      subject: "请求",
    }))
  }

  if (res.status === 403) {
    try {
      const data = await res.clone().json()
      if (data?.error === "Insufficient credits") {
        handlers?.onInsufficient({
          required: typeof data.required === "number" ? data.required : undefined,
          balance: typeof data.balance === "number" ? data.balance : undefined,
        })
      }
    } catch {
      /* 非 JSON，忽略 */
    }
  } else if (res.ok && shouldRefreshCredits(requestMethod(input, init))) {
    handlers?.onSuccess()
  }

  return res
}

export async function readApiJson<T = Record<string, unknown>>(
  res: Response,
  label = "请求"
): Promise<T> {
  const text = await res.text()
  if (!text.trim()) {
    throw new Error(`${label}未返回数据（HTTP ${res.status}），请稍后重试。`)
  }

  try {
    const data = JSON.parse(text) as T
    if (data && typeof data === "object" && "error" in data) {
      const record = data as Record<string, unknown>
      if (typeof record.error === "string") {
        record.error = toUserFacingError(record.error, {
          fallback: `${label}未完成，请稍后重试。`,
          status: res.status,
          subject: label,
        })
      }
    }
    return data
  } catch {
    const looksLikeHtml = /^\s*</.test(text) || /<!doctype\s+html/i.test(text)
    if (looksLikeHtml) {
      const timedOut = [408, 502, 503, 504].includes(res.status) || /timeout|timed out/i.test(text)
      if (timedOut) {
        throw new Error(`${label}处理时间较长，请稍后查看结果或重新尝试。`)
      }
      throw new Error(`${label}暂时不可用，请刷新后重试。`)
    }
    throw new Error(`${label}结果生成不完整，请稍后重试。`)
  }
}
