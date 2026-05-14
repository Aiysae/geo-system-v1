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

/**
 * 包裹 fetch：
 *  - 收到 403 Insufficient credits → 触发全局弹窗
 *  - 成功（2xx）→ 通知 provider 刷新余额
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
    const message = error instanceof Error ? error.message : "网络连接失败"
    throw new Error(`请求失败：${message}`)
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
  } else if (res.ok) {
    handlers?.onSuccess()
  }

  return res
}
