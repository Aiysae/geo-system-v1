import "server-only"

import { lookup } from "dns/promises"
import { isIP } from "net"

export interface SafeWebFetchOptions {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  userAgent?: string
  accept?: string
  acceptLanguage?: string
  allowedContentTypes?: RegExp
  allowHttpErrors?: boolean
}

export interface SafeWebFetchResult {
  requestedUrl: string
  finalUrl: string
  status: number
  ok: boolean
  contentType: string
  headers: Record<string, string>
  text: string
  bytes: number
  redirects: string[]
  durationMs: number
}

const DEFAULT_MAX_BYTES = 2_500_000
const DEFAULT_MAX_REDIRECTS = 5
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return true
  if (parts.some(part => part < 0 || part > 255)) return true
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

function normalizeHostAddress(host: string): string {
  return host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1).toLowerCase()
    : host.toLowerCase()
}

function ipv4FromMappedIpv6(ip: string): string | null {
  const rest = ip.toLowerCase().match(/^::ffff:(.+)$/)?.[1]
  if (!rest) return null
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(rest)) return rest

  const groups = rest.split(":").filter(Boolean)
  if (groups.length < 2) return null
  const high = Number.parseInt(groups[groups.length - 2], 16)
  const low = Number.parseInt(groups[groups.length - 1], 16)
  if (![high, low].every(value => Number.isInteger(value) && value >= 0 && value <= 0xffff)) {
    return null
  }
  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ].join(".")
}

function isPrivateIpv6(ip: string): boolean {
  const lower = normalizeHostAddress(ip)
  const mappedIpv4 = ipv4FromMappedIpv6(lower)
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4)

  const firstSegment = Number.parseInt(lower.split(":")[0] || "", 16)
  const isLinkLocal = Number.isFinite(firstSegment) && firstSegment >= 0xfe80 && firstSegment <= 0xfebf
  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("ff") ||
    isLinkLocal
  )
}

function assertPublicIp(address: string): void {
  const version = isIP(address)
  if (version === 4 && isPrivateIpv4(address)) {
    throw new Error("该链接指向内网或保留地址，已拒绝读取。")
  }
  if (version === 6 && isPrivateIpv6(address)) {
    throw new Error("该链接指向内网或保留地址，已拒绝读取。")
  }
}

export async function validatePublicHttpUrl(rawUrl: string): Promise<URL> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error("请输入有效的网址。")
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("网址只支持 http 或 https。")
  }
  if (parsed.username || parsed.password) {
    throw new Error("网址不能包含用户名或密码。")
  }

  const host = normalizeHostAddress(parsed.hostname)
  if (!host || host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("网址不能指向 localhost。")
  }
  if (isIP(host)) {
    assertPublicIp(host)
    return parsed
  }

  const records = await lookup(host, { all: true, verbatim: false })
  if (records.length === 0) throw new Error("无法解析该网址的域名。")
  for (const record of records) assertPublicIp(record.address)
  return parsed
}

function headerRecord(headers: Headers): Record<string, string> {
  const keys = [
    "cache-control",
    "content-language",
    "content-length",
    "content-type",
    "etag",
    "last-modified",
    "server",
    "x-robots-tag",
  ]
  return Object.fromEntries(
    keys
      .map(key => [key, headers.get(key) || ""] as const)
      .filter(([, value]) => Boolean(value)),
  )
}

async function readLimitedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const lengthHeader = response.headers.get("content-length")
  const contentLength = lengthHeader ? Number(lengthHeader) : NaN
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`网页响应超过 ${(maxBytes / 1_000_000).toFixed(1)}MB，已停止读取。`)
  }
  if (!response.body) return new TextEncoder().encode(await response.text())

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    received += value.byteLength
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Error(`网页响应超过 ${(maxBytes / 1_000_000).toFixed(1)}MB，已停止读取。`)
    }
    chunks.push(value)
  }

  const merged = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

function decodeBytes(bytes: Uint8Array, contentType: string): string {
  const headerCharset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]
  const utf8Preview = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 4096))
  const metaCharset = utf8Preview.match(
    /<meta[^>]+charset\s*=\s*["']?\s*([^"'\s/>]+)/i,
  )?.[1]
  const charset = (headerCharset || metaCharset || "utf-8").trim().toLowerCase()
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes)
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes)
  }
}

export async function fetchSafeWebText(
  rawUrl: string,
  options: SafeWebFetchOptions = {},
): Promise<SafeWebFetchResult> {
  const startedAt = Date.now()
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const redirects: string[] = []
  let current = await validatePublicHttpUrl(rawUrl)

  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(current.toString(), {
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": options.userAgent || DEFAULT_USER_AGENT,
          "Accept": options.accept || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": options.acceptLanguage || "zh-CN,zh;q=0.9,en;q=0.8",
        },
      })
    } catch (error) {
      if (controller.signal.aborted) throw new Error("网页读取超时。")
      throw error
    } finally {
      clearTimeout(timer)
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location")
      if (!location) throw new Error("网页发生跳转但没有返回目标地址。")
      const next = await validatePublicHttpUrl(new URL(location, current).toString())
      redirects.push(next.toString())
      current = next
      continue
    }

    const contentType = response.headers.get("content-type") || ""
    if (options.allowedContentTypes && contentType && !options.allowedContentTypes.test(contentType)) {
      throw new Error(`该网址返回了不支持的内容类型：${contentType.split(";")[0]}`)
    }
    if (!response.ok && !options.allowHttpErrors) {
      throw new Error(`网页读取失败 HTTP ${response.status}`)
    }

    const bytes = await readLimitedBytes(response, maxBytes)
    return {
      requestedUrl: rawUrl,
      finalUrl: current.toString(),
      status: response.status,
      ok: response.ok,
      contentType,
      headers: headerRecord(response.headers),
      text: decodeBytes(bytes, contentType),
      bytes: bytes.byteLength,
      redirects,
      durationMs: Date.now() - startedAt,
    }
  }

  throw new Error("网页跳转次数过多，已停止读取。")
}
