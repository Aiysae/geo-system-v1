import { kv } from "@vercel/kv"

const INITIAL_CREDITS = 20

const key = (userId: string) => `user_credits:${userId}`

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

/** 加 n 积分，返回加后的值。n <= 0 时不操作，返回当前余额。 */
export async function addCreditsBy(userId: string, n: number): Promise<number> {
  if (!Number.isFinite(n) || n <= 0) return await getCredits(userId)
  await ensureInitialized(userId)
  return await kv.incrby(key(userId), Math.floor(n))
}

export const CREDITS_INITIAL = INITIAL_CREDITS
