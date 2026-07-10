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

const key = (userId: string) => `user_credits:${userId}`
const adminAdjustmentKey = (operationId: string) => `credit_admin_adjustment:${operationId}`

const ADMIN_ADJUSTMENT_TTL_SECONDS = 60 * 60 * 24 * 30

const ADMIN_ADJUSTMENT_SCRIPT = `
-- admin_adjustment_v1
local completed = redis.call("GET", KEYS[2])
if completed then
  return {2, completed}
end

local current = redis.call("GET", KEYS[1])
local initial = tonumber(ARGV[1])
local delta = tonumber(ARGV[2])

if not current then
  current = initial
else
  current = tonumber(current) or 0
end

if not delta or delta == 0 or current + delta < 0 then
  return {0, current}
end

local next_balance = current + delta
local result = cjson.decode(ARGV[3])
result.balance = next_balance
local encoded = cjson.encode(result)
redis.call("SET", KEYS[1], next_balance)
redis.call("SET", KEYS[2], encoded, "EX", tonumber(ARGV[4]))
return {1, encoded}
`

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

/** 只在余额记录不存在时发放试用积分；读取现有余额绝不再自动补足。 */
async function ensureInitialized(userId: string): Promise<void> {
  const creditsKey = key(userId)
  const current = await kv.get<number | string>(creditsKey)

  if (current === null || current === undefined) {
    const created = await kv.set(creditsKey, INITIAL_CREDITS, { nx: true })
    if (created) {
      await writeCreditLedgerEntry({
        userId,
        delta: INITIAL_CREDITS,
        balanceAfter: INITIAL_CREDITS,
        context: {
          type: "trial_grant",
          source: "system",
          description: "新用户试用积分",
          metadata: { initialCredits: INITIAL_CREDITS },
        },
      })
    }
  }
}

export type AdminCreditAdjustmentResult = {
  operationId: string
  userId: string
  delta: number
  balance: number
  ledgerEntryId: string
}

type StoredAdminCreditAdjustment = AdminCreditAdjustmentResult & {
  operatorUserId: string
  createdAt: string
}

function parseStoredAdminAdjustment(value: unknown): StoredAdminCreditAdjustment | null {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as StoredAdminCreditAdjustment
    } catch {
      return null
    }
  }
  if (value && typeof value === "object") return value as StoredAdminCreditAdjustment
  return null
}

async function ensureAdminAdjustmentLedger(
  result: StoredAdminCreditAdjustment,
  description?: string,
): Promise<void> {
  await writeCreditLedgerEntry({
    id: result.ledgerEntryId,
    userId: result.userId,
    delta: result.delta,
    balanceAfter: result.balance,
    context: {
      type: "admin_adjust",
      source: "admin_api",
      sourceId: result.operationId,
      operatorUserId: result.operatorUserId,
      description: description || (result.delta > 0 ? "管理员手动增加积分" : "管理员手动扣除积分"),
      metadata: { operationId: result.operationId },
    },
  })
}

export async function adjustCreditsByAdmin(input: {
  operationId: string
  userId: string
  delta: number
  operatorUserId: string
  description?: string
}): Promise<AdminCreditAdjustmentResult> {
  const operationId = input.operationId.trim()
  if (!/^[a-zA-Z0-9_-]{16,160}$/.test(operationId)) throw new Error("积分操作号无效")
  if (!input.userId.trim()) throw new Error("用户 ID 缺失")
  if (!Number.isFinite(input.delta) || Math.trunc(input.delta) === 0) throw new Error("积分变动必须为非零整数")

  const delta = Math.trunc(input.delta)
  const existing = await kv.get<StoredAdminCreditAdjustment>(adminAdjustmentKey(operationId))
  if (existing) {
    if (existing.userId !== input.userId || existing.delta !== delta) throw new Error("积分操作号已被其他调整使用")
    await ensureAdminAdjustmentLedger(existing, input.description)
    return existing
  }

  await ensureInitialized(input.userId)
  const pendingResult: StoredAdminCreditAdjustment = {
    operationId,
    userId: input.userId,
    delta,
    balance: 0,
    ledgerEntryId: `ledger_admin_${operationId}`,
    operatorUserId: input.operatorUserId,
    createdAt: new Date().toISOString(),
  }
  const tuple = await kv.eval<[number, string | number], unknown>(
    ADMIN_ADJUSTMENT_SCRIPT,
    [key(input.userId), adminAdjustmentKey(operationId)],
    [INITIAL_CREDITS, delta, JSON.stringify(pendingResult), ADMIN_ADJUSTMENT_TTL_SECONDS],
  )
  const status = Number(tuple?.[0])
  if (status === 0) {
    const balance = Number(tuple?.[1] ?? 0)
    if (delta < 0) throw new Error(`当前余额仅 ${balance}，不能扣除 ${Math.abs(delta)} 积分`)
    throw new Error("积分调整失败")
  }

  const result = parseStoredAdminAdjustment(tuple?.[1])
  if (!result) throw new Error("积分调整结果无效")
  if (result.userId !== input.userId || result.delta !== delta) throw new Error("积分操作号已被其他调整使用")
  await ensureAdminAdjustmentLedger(result, input.description)
  return result
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
