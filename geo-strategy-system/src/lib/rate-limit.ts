import "server-only"

import { kv } from "@vercel/kv"

type RateLimitOk = {
  ok: true
  remaining: number
  resetAt: number
}

type RateLimitBlocked = {
  ok: false
  remaining: 0
  resetAt: number
}

export type RateLimitResult = RateLimitOk | RateLimitBlocked

type MemoryBucket = {
  count: number
  resetAt: number
}

const memoryBuckets = new Map<string, MemoryBucket>()

const HIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], tonumber(ARGV[2]))
end
local ttl = redis.call("TTL", KEYS[1])
return {current, ttl}
`

function cleanKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9:_@.-]/g, "_").slice(0, 220)
}

function memoryHit(key: string, limit: number, windowSec: number): RateLimitResult {
  const now = Date.now()
  const current = memoryBuckets.get(key)
  const bucket = current && current.resetAt > now
    ? current
    : { count: 0, resetAt: now + windowSec * 1000 }

  bucket.count += 1
  memoryBuckets.set(key, bucket)
  const remaining = Math.max(0, limit - bucket.count)
  if (bucket.count > limit) {
    return { ok: false, remaining: 0, resetAt: bucket.resetAt }
  }
  return { ok: true, remaining, resetAt: bucket.resetAt }
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown"
  return request.headers.get("x-real-ip")?.trim() || "unknown"
}

export async function hitRateLimit(
  namespace: string,
  identifier: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const safeLimit = Math.max(1, Math.floor(limit))
  const safeWindow = Math.max(1, Math.floor(windowSec))
  const key = `rate:${cleanKey(namespace)}:${cleanKey(identifier || "unknown")}`

  try {
    const result = await kv.eval<[number, number], unknown>(
      HIT_SCRIPT,
      [key],
      [safeLimit, safeWindow],
    )
    const tuple = Array.isArray(result) ? result : []
    const count = Number(tuple[0] ?? 0)
    const ttl = Number(tuple[1] ?? safeWindow)
    const resetAt = Date.now() + Math.max(1, ttl) * 1000
    const remaining = Math.max(0, safeLimit - count)

    if (count > safeLimit) return { ok: false, remaining: 0, resetAt }
    return { ok: true, remaining, resetAt }
  } catch (error) {
    console.warn("[rate-limit] KV unavailable, using memory fallback", error)
    return memoryHit(key, safeLimit, safeWindow)
  }
}
