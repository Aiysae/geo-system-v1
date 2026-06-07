import { NextResponse } from "next/server"
import { decrCreditsBy, getCredits } from "./credits"
import { getCurrentUser } from "./auth"

type UserIdGuard =
  | { ok: true; userId: string }
  | { ok: false; response: Response }

type CreditsGuard =
  | { ok: true; balance: number }
  | { ok: false; response: Response }

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

/** 业务成功路径调用。失败只 console.error，不抛。 */
export async function chargeCredits(userId: string, amount: number): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return
  try {
    await decrCreditsBy(userId, amount)
  } catch (err) {
    console.error("[credits] decrBy failed", userId, amount, err)
  }
}
