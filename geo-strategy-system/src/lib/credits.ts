import "server-only"

import { kv } from "@/lib/kv"

const INITIAL_CREDITS = 20

const key = (userId: string) => `user_credits:${userId}`

export type CreditReserveResult =
  | { ok: true; balance: number }
  | { ok: false; required: number; balance: number }

const RESERVE_CREDITS_SCRIPT = `
local current = redis.call("GET", KEYS[1])
local initial = tonumber(ARGV[1])
local amount = tonumber(ARGV[2])

if not current then
  current = initial
  redis.call("SET", KEYS[1], current)
else
  current = tonumber(current) or 0
end

if amount <= 0 then
  return {1, current}
end

if current < amount then
  return {0, current}
end

local next_balance = current - amount
redis.call("SET", KEYS[1], next_balance)
return {1, next_balance}
`

function normalizeAmount(value: number, fallback = 1): number {
  return Math.max(1, Math.floor(Number.isFinite(value) ? value : fallback))
}

/**
 * 首次访问时给 INITIAL_CREDITS 个体验积分。NX 保证只在 key 不存在时写入。
 */
async function ensureInitialized(userId: string): Promise<void> {
  await kv.set(key(userId), INITIAL_CREDITS, { nx: true })
}

/** 当前剩余积分。无记录则初始化为 INITIAL_CREDITS 后返回。 */
export async function getCredits(userId: string): Promise<number> {
  await ensureInitialized(userId)
  const v = await kv.get<number>(key(userId))
  return typeof v === "number" ? v : Number(v ?? 0)
}

/** 扣 n 积分，返回扣后的值。n <= 0 时不操作，返回当前余额。 */
export async function decrCreditsBy(userId: string, n: number): Promise<number> {
  if (!Number.isFinite(n) || n <= 0) return await getCredits(userId)
  return await kv.decrby(key(userId), Math.floor(n))
}

/** 原子预扣积分。并发请求不会同时透支同一份余额。 */
export async function reserveCreditsBy(userId: string, n: number): Promise<CreditReserveResult> {
  const amount = normalizeAmount(n)
  const result = await kv.eval<[number, number], unknown>(
    RESERVE_CREDITS_SCRIPT,
    [key(userId)],
    [INITIAL_CREDITS, amount],
  )
  const tuple = Array.isArray(result) ? result : []
  const ok = Number(tuple[0]) === 1
  const balance = Number(tuple[1] ?? 0)

  if (!ok) return { ok: false, required: amount, balance }
  return { ok: true, balance }
}

/** 加 n 积分，返回加后的值。n <= 0 时不操作，返回当前余额。 */
export async function addCreditsBy(userId: string, n: number): Promise<number> {
  if (!Number.isFinite(n) || n <= 0) return await getCredits(userId)
  await ensureInitialized(userId)
  return await kv.incrby(key(userId), Math.floor(n))
}

export const CREDITS_INITIAL = INITIAL_CREDITS
