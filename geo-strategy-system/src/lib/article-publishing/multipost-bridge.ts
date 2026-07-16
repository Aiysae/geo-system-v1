export const MULTIPOST_CHROME_STORE_URL = "https://chromewebstore.google.com/detail/multipost/dhohkaclnjgcikfoaacfgijgjgceofih"
export const MULTIPOST_PROJECT_URL = "https://github.com/leaperone/MultiPost-Extension"

export interface MultiPostAccountInfo {
  provider?: string
  accountId?: string
  username?: string
  description?: string
  profileUrl?: string
  avatarUrl?: string
}

export interface MultiPostPlatform {
  type: "DYNAMIC" | "VIDEO" | "ARTICLE" | "PODCAST"
  name: string
  homeUrl?: string
  platformName: string
  injectUrl?: string
  tags?: string[]
  accountKey?: string
  accountInfo?: MultiPostAccountInfo
  extraConfig?: unknown
}

export interface MultiPostFileData {
  name: string
  url: string
  type?: string
  size?: number
}

export interface MultiPostArticlePayload {
  platforms: Array<Pick<MultiPostPlatform, "name" | "injectUrl" | "extraConfig">>
  isAutoPublish: boolean
  data: {
    title: string
    digest: string
    htmlContent: string
    markdownContent: string
    cover?: MultiPostFileData
    images?: MultiPostFileData[]
    tags?: string[]
    original?: boolean
    allowComment?: boolean
  }
}

interface ExtensionResponse<T> {
  type: "response"
  traceId: string
  action: string
  code: number
  message: string
  data: T
}

export class MultiPostBridgeError extends Error {
  constructor(message: string, public readonly code: number | "TIMEOUT" | "UNAVAILABLE") {
    super(message)
    this.name = "MultiPostBridgeError"
  }
}

export async function checkMultiPostExtension() {
  return sendRequest<{ extensionId?: string }>("MULTIPOST_EXTENSION_CHECK_SERVICE_STATUS", {}, 5_000)
}

export async function requestMultiPostTrust() {
  return sendRequest<{ trusted?: boolean; status?: string; message?: string }>(
    "MULTIPOST_EXTENSION_REQUEST_TRUST_DOMAIN",
    {},
    130_000,
  )
}

export async function getMultiPostArticlePlatforms(): Promise<MultiPostPlatform[]> {
  const result = await sendRequest<{ platforms?: MultiPostPlatform[]; error?: string }>(
    "MULTIPOST_EXTENSION_PLATFORMS",
    {},
    90_000,
  )
  if (result.error) throw new MultiPostBridgeError(result.error, "UNAVAILABLE")
  return (result.platforms || []).filter(platform => platform.type === "ARTICLE")
}

export async function openMultiPostOptions() {
  return sendRequest("MULTIPOST_EXTENSION_OPEN_OPTIONS", {}, 8_000)
}

export async function refreshMultiPostAccounts() {
  return sendRequest("MULTIPOST_EXTENSION_REFRESH_ACCOUNT_INFOS", { isFocused: true }, 8_000)
}

export async function publishArticleWithMultiPost(payload: MultiPostArticlePayload) {
  return sendRequest<{ status?: string; extensionId?: string }>(
    "MULTIPOST_EXTENSION_PUBLISH",
    payload,
    15_000,
  )
}

function sendRequest<TResponse = unknown>(action: string, data: unknown, timeoutMs: number): Promise<TResponse> {
  if (typeof window === "undefined") {
    return Promise.reject(new MultiPostBridgeError("发布扩展只能在浏览器中使用。", "UNAVAILABLE"))
  }

  const traceId = createTraceId()

  return new Promise<TResponse>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new MultiPostBridgeError("未收到本机发布扩展响应。", "TIMEOUT"))
    }, timeoutMs)

    function cleanup() {
      window.clearTimeout(timer)
      window.removeEventListener("message", handleMessage)
    }

    function handleMessage(event: MessageEvent<ExtensionResponse<TResponse>>) {
      if (event.source !== window || event.origin !== window.location.origin) return
      const response = event.data
      if (
        !response
        || response.type !== "response"
        || response.traceId !== traceId
        || response.action !== action
      ) return

      cleanup()
      if (response.code !== 0) {
        reject(new MultiPostBridgeError(response.message || "发布扩展调用失败。", response.code))
        return
      }
      resolve(response.data)
    }

    window.addEventListener("message", handleMessage)
    window.postMessage({ type: "request", traceId, action, data }, window.location.origin)
  })
}

function createTraceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `multipost-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
