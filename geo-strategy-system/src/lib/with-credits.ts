import { NextResponse } from "next/server"
import { addCreditsBy, decrCreditsBy, getCredits, reserveCreditsBy } from "./credits"
import { getCurrentUser, getUserById, type PublicUser } from "./auth"
import { isAdminUser } from "./admin"
import type { CreditLedgerContext } from "./credit-ledger"
import { getInternalApiUserId } from "./internal-api"

type UserIdGuard =
  | { ok: true; userId: string }
  | { ok: false; response: Response }

type CreditsGuard =
  | { ok: true; balance: number }
  | { ok: false; response: Response }

export type CreditReservation = {
  userId: string
  amount: number
  balanceAfterReserve: number
  ledgerContext?: CreditLedgerContext
}

export const UNLIMITED_CREDITS_BALANCE = 999999

function envFlag(name: string, defaultValue = false): boolean {
  const value = process.env[name]
  if (value === undefined || value === "") return defaultValue
  return /^(1|true|yes|on)$/i.test(value)
}

export function hasUnlimitedCreditAccess(user: PublicUser | null | undefined): boolean {
  if (!user) return false

  const mode = String(process.env.CREDITS_MODE || "").trim().toLowerCase()
  if (["off", "free", "unlimited", "disabled"].includes(mode)) return true

  if (envFlag("ADMIN_CREDITS_UNLIMITED", true) && isAdminUser(user)) return true

  return false
}

async function hasUnlimitedCreditAccessByUserId(userId: string): Promise<boolean> {
  const user = await getUserById(userId)
  return hasUnlimitedCreditAccess(user)
}

/** 仅做登录鉴权。未登录返回 401 Response，不读积分。 */
export async function requireUserId(): Promise<UserIdGuard> {
  const user = await getCurrentUser()
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    }
  }
  return { ok: true, userId: user.id }
}

/** 校验余额 >= required；不足返回 403 + 余额信息。 */
export async function requireCredits(
  userId: string,
  required: number
): Promise<CreditsGuard> {
  if (await hasUnlimitedCreditAccessByUserId(userId)) {
    return { ok: true, balance: UNLIMITED_CREDITS_BALANCE }
  }

  const need = Math.max(1, Math.floor(Number.isFinite(required) ? required : 1))
  const balance = await getCredits(userId)
  if (balance < need) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Insufficient credits", required: need, balance },
        { status: 403 }
      ),
    }
  }
  return { ok: true, balance }
}

/**
 * 一步到位：鉴权 + 预检。多数 handler 用这个；先要做 body 校验再算 cost 的可拆开用上面两个。
 */
export async function authAndCheckCredits(
  required: number
): Promise<
  | { ok: true; userId: string; balance: number }
  | { ok: false; response: Response }
> {
  const a = await requireUserId()
  if (!a.ok) return a
  const c = await requireCredits(a.userId, required)
  if (!c.ok) return c
  return { ok: true, userId: a.userId, balance: c.balance }
}

export async function reserveCreditsForUser(
  userId: string,
  required: number,
  context?: CreditLedgerContext,
): Promise<
  | { ok: true; reservation: CreditReservation; balance: number }
  | { ok: false; response: Response }
> {
  const need = Math.max(1, Math.floor(Number.isFinite(required) ? required : 1))
  if (await hasUnlimitedCreditAccessByUserId(userId)) {
    return {
      ok: true,
      balance: UNLIMITED_CREDITS_BALANCE,
      reservation: {
        userId,
        amount: 0,
        balanceAfterReserve: UNLIMITED_CREDITS_BALANCE,
        ledgerContext: context,
      },
    }
  }

  const reserved = await reserveCreditsBy(userId, need, context)
  if (!reserved.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Insufficient credits", required: reserved.required, balance: reserved.balance },
        { status: 403 },
      ),
    }
  }

  return {
    ok: true,
    balance: reserved.balance,
    reservation: {
      userId,
      amount: need,
      balanceAfterReserve: reserved.balance,
      ledgerContext: context,
    },
  }
}

export async function authAndReserveCredits(
  required: number,
  context?: CreditLedgerContext,
): Promise<
  | { ok: true; userId: string; reservation: CreditReservation; balance: number }
  | { ok: false; response: Response }
> {
  const a = await requireUserId()
  if (!a.ok) return a
  const reserved = await reserveCreditsForUser(a.userId, required, context)
  if (!reserved.ok) return reserved
  return {
    ok: true,
    userId: a.userId,
    reservation: reserved.reservation,
    balance: reserved.balance,
  }
}

/**
 * Long-running background jobs reserve credits before dispatch. Their internal
 * API call therefore receives a zero-value reservation so the existing route
 * can run unchanged without charging the user a second time.
 */
export async function authAndReserveCreditsForRequest(
  request: Request,
  required: number,
  context?: CreditLedgerContext,
): Promise<
  | { ok: true; userId: string; reservation: CreditReservation; balance: number }
  | { ok: false; response: Response }
> {
  const internalUserId = getInternalApiUserId(request, "background-job")
  if (internalUserId) {
    return {
      ok: true,
      userId: internalUserId,
      balance: UNLIMITED_CREDITS_BALANCE,
      reservation: {
        userId: internalUserId,
        amount: 0,
        balanceAfterReserve: UNLIMITED_CREDITS_BALANCE,
        ledgerContext: context,
      },
    }
  }
  return authAndReserveCredits(required, context)
}

export async function refundReservedCredits(reservation: CreditReservation): Promise<void> {
  if (reservation.amount <= 0) return
  await addCreditsBy(reservation.userId, reservation.amount, {
    ...reservation.ledgerContext,
    type: "usage_refund",
    description: reservation.ledgerContext?.description
      ? `${reservation.ledgerContext.description} · 失败退回`
      : "任务失败退回预扣积分",
  })
}

export async function refundReservedCreditsQuietly(
  reservation: CreditReservation | null | undefined,
): Promise<void> {
  if (!reservation) return
  try {
    await refundReservedCredits(reservation)
  } catch (error) {
    console.error("[credits] refund reservation failed", reservation.userId, reservation.amount, error)
  }
}

export async function settleReservedCredits(
  reservation: CreditReservation | null | undefined,
  used: number,
): Promise<void> {
  if (!reservation) throw new Error("Credit reservation missing")
  if (reservation.amount <= 0) return

  const usedAmount = Math.max(0, Math.floor(Number.isFinite(used) ? used : 0))
  const refund = reservation.amount - Math.min(reservation.amount, usedAmount)
  if (refund > 0) {
    await addCreditsBy(reservation.userId, refund, {
      ...reservation.ledgerContext,
      type: "usage_refund",
      description: reservation.ledgerContext?.description
        ? `${reservation.ledgerContext.description} · 未使用退回`
        : "未使用预扣积分退回",
      metadata: {
        ...reservation.ledgerContext?.metadata,
        reserved: reservation.amount,
        used: usedAmount,
      },
    })
  }
  if (usedAmount > reservation.amount) {
    const extra = await reserveCreditsBy(
      reservation.userId,
      usedAmount - reservation.amount,
      {
        ...reservation.ledgerContext,
        type: "usage_extra",
        description: reservation.ledgerContext?.description
          ? `${reservation.ledgerContext.description} · 超额结算`
          : "任务超额结算",
        metadata: {
          ...reservation.ledgerContext?.metadata,
          reserved: reservation.amount,
          used: usedAmount,
        },
      },
    )
    if (!extra.ok) {
      console.error(
        "[credits] extra settlement failed",
        reservation.userId,
        usedAmount - reservation.amount,
        extra.balance,
      )
    }
  }
}

/** 业务成功路径调用。失败只 console.error，不抛。 */
export async function chargeCredits(userId: string, amount: number): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return
  try {
    if (await hasUnlimitedCreditAccessByUserId(userId)) return
    await decrCreditsBy(userId, amount, {
      type: "usage_reserved",
      source: "legacy-charge",
      description: "旧版直接扣费",
    })
  } catch (err) {
    console.error("[credits] decrBy failed", userId, amount, err)
  }
}
