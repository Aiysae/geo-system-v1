import "server-only"

import { kv } from "@/lib/kv"

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

const RESERVE_SCRIPT = `
-- reserve_rate_limit_v1
local amount = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local window = tonumber(ARGV[3])
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
local ttl = redis.call("TTL", KEYS[1])
if current + amount > limit then
  return {0, current, ttl}
end
local next = redis.call("INCRBY", KEYS[1], amount)
if current == 0 then
  redis.call("EXPIRE", KEYS[1], window)
  ttl = window
else
  ttl = redis.call("TTL", KEYS[1])
end
return {1, next, ttl}
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

function memoryReserve(
  key: string,
  amount: number,
  limit: number,
  windowSec: number,
): RateLimitResult {
  const now = Date.now()
  const current = memoryBuckets.get(key)
  const bucket = current && current.resetAt > now
    ? current
    : { count: 0, resetAt: now + windowSec * 1000 }
  if (bucket.count + amount > limit) {
    return { ok: false, remaining: 0, resetAt: bucket.resetAt }
  }
  bucket.count += amount
  memoryBuckets.set(key, bucket)
  return {
    ok: true,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
  }
}

function memoryRelease(key: string, amount: number): void {
  const current = memoryBuckets.get(key)
  if (!current || current.resetAt <= Date.now()) return
  current.count = Math.max(0, current.count - Math.max(1, Math.floor(amount)))
  memoryBuckets.set(key, current)
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

export async function reserveRateLimit(
  namespace: string,
  identifier: string,
  amount: number,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const safeAmount = Math.max(1, Math.floor(amount))
  const safeLimit = Math.max(1, Math.floor(limit))
  const safeWindow = Math.max(1, Math.floor(windowSec))
  const key = `rate:${cleanKey(namespace)}:${cleanKey(identifier || "unknown")}`

  try {
    const result = await kv.eval<[number, number, number], unknown>(
      RESERVE_SCRIPT,
      [key],
      [safeAmount, safeLimit, safeWindow],
    )
    const tuple = Array.isArray(result) ? result : []
    const allowed = Number(tuple[0] ?? 0) === 1
    const count = Number(tuple[1] ?? 0)
    const ttl = Number(tuple[2] ?? safeWindow)
    const resetAt = Date.now() + Math.max(1, ttl) * 1000
    if (!allowed) return { ok: false, remaining: 0, resetAt }
    return {
      ok: true,
      remaining: Math.max(0, safeLimit - count),
      resetAt,
    }
  } catch (error) {
    console.warn("[rate-limit] KV unavailable, using memory fallback", error)
    return memoryReserve(key, safeAmount, safeLimit, safeWindow)
  }
}

export async function releaseRateLimitReservation(
  namespace: string,
  identifier: string,
  amount: number,
): Promise<void> {
  const safeAmount = Math.max(1, Math.floor(amount))
  const key = `rate:${cleanKey(namespace)}:${cleanKey(identifier || "unknown")}`
  try {
    const current = Number(await kv.get<number | string>(key))
    if (!Number.isFinite(current) || current <= 0) return
    await kv.decrby(key, Math.min(current, safeAmount))
  } catch (error) {
    console.warn("[rate-limit] KV release unavailable, using memory fallback", error)
    memoryRelease(key, safeAmount)
  }
}
