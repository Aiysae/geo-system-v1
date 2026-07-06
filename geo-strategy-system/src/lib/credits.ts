import "server-only"

import { kv } from "@/lib/kv"
import {
  writeCreditLedgerEntry,
  type CreditLedgerContext,
} from "@/lib/credit-ledger"

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  if (!Number.isFinite(raw) || raw <= 0) return fallback
  return Math.floor(raw)
}

const INITIAL_CREDITS = readPositiveIntEnv("CREDITS_INITIAL", 50)
const BOOTSTRAP_MIN_CREDITS = readPositiveIntEnv("CREDITS_BOOTSTRAP_MIN", INITIAL_CREDITS)

const key = (userId: string) => `user_credits:${userId}`
const bootstrapKey = (userId: string) => `user_credits_bootstrap:${BOOTSTRAP_MIN_CREDITS}:${userId}`

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
 * 首次访问时给体验积分。可通过 CREDITS_BOOTSTRAP_MIN 给历史低余额账号做一次性补足。
 */
async function ensureInitialized(userId: string): Promise<void> {
  const creditsKey = key(userId)
  const current = await kv.get<number | string>(creditsKey)
  const seededCredits = Math.max(INITIAL_CREDITS, BOOTSTRAP_MIN_CREDITS)

  if (current === null || current === undefined) {
    const created = await kv.set(creditsKey, seededCredits, { nx: true })
    if (created) {
      await writeCreditLedgerEntry({
        userId,
        delta: seededCredits,
        balanceAfter: seededCredits,
        context: {
          type: "trial_grant",
          source: "system",
          description: "新用户试用积分",
          metadata: { initialCredits: INITIAL_CREDITS },
        },
      })
      if (BOOTSTRAP_MIN_CREDITS > INITIAL_CREDITS) {
        await kv.set(bootstrapKey(userId), "1", { nx: true })
      }
    }
    return
  }

  const currentCredits = Number(current)
  if (!Number.isFinite(currentCredits) || currentCredits >= BOOTSTRAP_MIN_CREDITS) return

  const markerKey = bootstrapKey(userId)
  const alreadyBootstrapped = await kv.get<string>(markerKey)
  if (alreadyBootstrapped) return

  await kv.set(creditsKey, BOOTSTRAP_MIN_CREDITS)
  await kv.set(markerKey, "1", { nx: true })
  await writeCreditLedgerEntry({
    userId,
    delta: BOOTSTRAP_MIN_CREDITS - currentCredits,
    balanceAfter: BOOTSTRAP_MIN_CREDITS,
    context: {
      type: "bootstrap_grant",
      source: "system",
      description: "历史账号低余额一次性补足",
      metadata: {
        before: currentCredits,
        bootstrapMinCredits: BOOTSTRAP_MIN_CREDITS,
      },
    },
  })
}

/** 当前剩余积分。无记录则初始化为 INITIAL_CREDITS 后返回。 */
export async function getCredits(userId: string): Promise<number> {
  await ensureInitialized(userId)
  const v = await kv.get<number>(key(userId))
  return typeof v === "number" ? v : Number(v ?? 0)
}

/** 扣 n 积分，返回扣后的值。n <= 0 时不操作，返回当前余额。 */
export async function decrCreditsBy(
  userId: string,
  n: number,
  context?: CreditLedgerContext,
): Promise<number> {
  if (!Number.isFinite(n) || n <= 0) return await getCredits(userId)
  await ensureInitialized(userId)
  const amount = Math.floor(n)
  const next = await kv.decrby(key(userId), amount)
  await writeCreditLedgerEntry({
    userId,
    delta: -amount,
    balanceAfter: next,
    context,
  })
  return next
}

/** 原子预扣积分。并发请求不会同时透支同一份余额。 */
export async function reserveCreditsBy(
  userId: string,
  n: number,
  context?: CreditLedgerContext,
): Promise<CreditReserveResult> {
  const amount = normalizeAmount(n)
  await ensureInitialized(userId)
  const result = await kv.eval<[number, number], unknown>(
    RESERVE_CREDITS_SCRIPT,
    [key(userId)],
    [INITIAL_CREDITS, amount],
  )
  const tuple = Array.isArray(result) ? result : []
  const ok = Number(tuple[0]) === 1
  const balance = Number(tuple[1] ?? 0)

  if (!ok) return { ok: false, required: amount, balance }
  await writeCreditLedgerEntry({
    userId,
    delta: -amount,
    balanceAfter: balance,
    context: {
      ...context,
      type: "usage_reserved",
    },
  })
  return { ok: true, balance }
}

/** 加 n 积分，返回加后的值。n <= 0 时不操作，返回当前余额。 */
export async function addCreditsBy(
  userId: string,
  n: number,
  context?: CreditLedgerContext,
): Promise<number> {
  if (!Number.isFinite(n) || n <= 0) return await getCredits(userId)
  await ensureInitialized(userId)
  const amount = Math.floor(n)
  const next = await kv.incrby(key(userId), amount)
  await writeCreditLedgerEntry({
    userId,
    delta: amount,
    balanceAfter: next,
    context,
  })
  return next
}

export const CREDITS_INITIAL = INITIAL_CREDITS
