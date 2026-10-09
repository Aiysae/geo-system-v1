import "server-only"

import { lookup } from "dns/promises"
import http from "http"
import https from "https"
import { isIP, type LookupFunction } from "net"
import { Readable } from "stream"
import zlib from "zlib"

export interface SafeWebFetchOptions {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  userAgent?: string
  accept?: string
  acceptLanguage?: string
  allowedContentTypes?: RegExp
  allowHttpErrors?: boolean
  signal?: AbortSignal
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

// 198.18.0.0/15 is intentionally allowed: fake-IP DNS proxies (Clash, Surge)
// answer public hostnames from that range, and blocking it breaks every fetch.
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return true
  if (parts.some(part => part < 0 || part > 255)) return true
  const [a, b, c] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  )
}

function normalizeHostAddress(host: string): string {
  return host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1).toLowerCase()
    : host.toLowerCase()
}

function embeddedIpv4(groups: string[]): string | null {
  const tail = groups[groups.length - 1] || ""
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(tail)) return tail
  if (groups.length < 2) return null
  const high = Number.parseInt(groups[groups.length - 2], 16)
  const low = Number.parseInt(tail, 16)
  if (![high, low].every(value => Number.isInteger(value) && value >= 0 && value <= 0xffff)) {
    return null
  }
  return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join(".")
}

function ipv4FromMappedIpv6(ip: string): string | null {
  const rest = ip.toLowerCase().match(/^::ffff:(.+)$/)?.[1]
  return rest ? embeddedIpv4(rest.split(":").filter(Boolean)) : null
}

function isPrivateIpv6(ip: string): boolean {
  const lower = normalizeHostAddress(ip)
  const mappedIpv4 = ipv4FromMappedIpv6(lower)
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4)

  // NAT64 (64:ff9b::/96) translates to the embedded IPv4 address, so it must
  // pass the same IPv4 checks; a gateway would otherwise reach 127.0.0.1.
  if (lower.startsWith("64:ff9b:")) {
    const nat64 = embeddedIpv4(lower.split(":").filter(Boolean))
    return !nat64 || isPrivateIpv4(nat64)
  }
  // 6to4 (2002:AABB:CCDD::/48) relays to the IPv4 address in groups two and three.
  if (lower.startsWith("2002:")) {
    const sixToFour = embeddedIpv4(lower.split(":").slice(1, 3))
    return !sixToFour || isPrivateIpv4(sixToFour)
  }

  const firstSegment = Number.parseInt(lower.split(":")[0] || "", 16)
  const isLinkLocal = Number.isFinite(firstSegment) && firstSegment >= 0xfe80 && firstSegment <= 0xfebf
  const isSiteLocal = Number.isFinite(firstSegment) && firstSegment >= 0xfec0 && firstSegment <= 0xfeff
  return (
    // ::/8 is reserved: unspecified, loopback and IPv4-compatible (::a.b.c.d).
    lower.startsWith("::") ||
    lower.startsWith("2001:db8:") ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("ff") ||
    isLinkLocal ||
    isSiteLocal
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

/**
 * DNS lookup used for the actual connection. Validating a hostname and then
 * letting fetch resolve it again allows DNS rebinding: the second answer can
 * point at 127.0.0.1 or the cloud metadata endpoint. Every address returned
 * here is checked, and the socket connects only to those checked addresses.
 */
const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true, verbatim: false })
    .then(records => {
      if (records.length === 0) throw new Error("无法解析该网址的域名。")
      for (const record of records) assertPublicIp(record.address)
      const family = typeof options === "object" ? options.family : options
      const matching = family === 4 || family === 6
        ? records.filter(record => record.family === family)
        : records
      if (matching.length === 0) throw new Error("无法解析该网址的域名。")
      if (typeof options === "object" && options.all) {
        callback(null, matching)
      } else {
        callback(null, matching[0].address, matching[0].family)
      }
    })
    .catch(error => callback(error as NodeJS.ErrnoException, "", 0))
}

function decodedBody(response: http.IncomingMessage): Readable {
  const encoding = String(response.headers["content-encoding"] || "").trim().toLowerCase()
  let decoder: zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | null = null
  if (encoding === "gzip" || encoding === "x-gzip") decoder = zlib.createGunzip()
  else if (encoding === "deflate") decoder = zlib.createInflate()
  else if (encoding === "br") decoder = zlib.createBrotliDecompress()
  if (!decoder) return response
  response.on("error", error => decoder.destroy(error))
  return response.pipe(decoder)
}

function requestPinned(
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http
    const request = transport.request(url, {
      method: "GET",
      headers: { ...headers, "Accept-Encoding": "gzip, deflate, br" },
      lookup: publicOnlyLookup,
      signal,
    }, response => {
      const status = response.statusCode || 0
      const responseHeaders = new Headers()
      for (const [key, value] of Object.entries(response.headers)) {
        if (value === undefined) continue
        if (Array.isArray(value)) value.forEach(item => responseHeaders.append(key, item))
        else responseHeaders.set(key, String(value))
      }
      const body = decodedBody(response)
      // Content-Length describes the encoded bytes; the size limit is applied
      // to decoded bytes while streaming instead.
      if (body !== response) responseHeaders.delete("content-length")
      try {
        const noBody = status === 204 || status === 205 || status === 304
        if (noBody) response.resume()
        resolve(new Response(
          noBody ? null : Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>,
          { status, headers: responseHeaders },
        ))
      } catch {
        response.destroy()
        reject(new Error(`网页读取失败 HTTP ${status}`))
      }
    })
    request.on("error", reject)
    request.end()
  })
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

function formatByteLimit(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1_000))}KB`
}

async function readLimitedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const lengthHeader = response.headers.get("content-length")
  const contentLength = lengthHeader ? Number(lengthHeader) : NaN
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`网页响应超过 ${formatByteLimit(maxBytes)}，已停止读取。`)
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
      throw new Error(`网页响应超过 ${formatByteLimit(maxBytes)}，已停止读取。`)
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
    const abortFromParent = () => controller.abort()
    if (options.signal?.aborted) controller.abort()
    else options.signal?.addEventListener("abort", abortFromParent, { once: true })
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS)
    try {
      const response = await requestPinned(current, {
        "User-Agent": options.userAgent || DEFAULT_USER_AGENT,
        "Accept": options.accept || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": options.acceptLanguage || "zh-CN,zh;q=0.9,en;q=0.8",
      }, controller.signal)

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location")
        await response.body?.cancel().catch(() => undefined)
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
    } catch (error) {
      if (controller.signal.aborted) {
        if (options.signal?.aborted) throw new Error("网页读取已停止。")
        throw new Error("网页读取超时。")
      }
      throw error
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", abortFromParent)
    }
  }

  throw new Error("网页跳转次数过多，已停止读取。")
}
