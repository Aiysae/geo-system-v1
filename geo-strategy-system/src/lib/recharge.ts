import { kv } from "@vercel/kv"
import { addCreditsBy } from "./credits"

export type RechargeStatus = "pending" | "approved" | "rejected"

export type RechargeRequest = {
  id: string
  userId: string
  username: string
  email: string
  amount: number
  status: RechargeStatus
  createdAt: number
  processedAt?: number
  processedBy?: string
}

const KEY_REQ = (id: string) => `recharge_requests:${id}`
const KEY_PENDING_SET = "recharge_requests:pending"
const KEY_USER_INDEX = (userId: string) => `recharge_requests:user:${userId}`

export const MIN_AMOUNT = 1
export const MAX_AMOUNT = 100000

function newId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export async function createRequest(input: {
  userId: string
  username: string
  email: string
  amount: number
}): Promise<RechargeRequest> {
  const amount = Math.floor(input.amount)
  if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    throw new Error(`积分数值需在 ${MIN_AMOUNT} ~ ${MAX_AMOUNT} 之间`)
  }
  const record: RechargeRequest = {
    id: newId(),
    userId: input.userId,
    username: input.username,
    email: input.email,
    amount,
    status: "pending",
    createdAt: Date.now(),
  }
  await kv.set(KEY_REQ(record.id), record)
  await kv.sadd(KEY_PENDING_SET, record.id)
  await kv.sadd(KEY_USER_INDEX(record.userId), record.id)
  return record
}

export async function listPending(): Promise<RechargeRequest[]> {
  const ids = await kv.smembers(KEY_PENDING_SET)
  if (!ids || ids.length === 0) return []
  const records = await Promise.all(
    ids.map(id => kv.get<RechargeRequest>(KEY_REQ(id)))
  )
  return records
    .filter((r): r is RechargeRequest => !!r && r.status === "pending")
    .sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * 同意：用 SREM 当作原子锁，只有第一个把 id 从 pending 集合移除的调用方能继续；
 * 然后更新状态并给目标用户加积分。
 */
export async function approveRequest(
  requestId: string,
  adminUserId: string
): Promise<{ ok: true; record: RechargeRequest } | { ok: false; reason: string }> {
  const removed = await kv.srem(KEY_PENDING_SET, requestId)
  if (!removed) return { ok: false, reason: "该申请已被处理或不存在" }

  const record = await kv.get<RechargeRequest>(KEY_REQ(requestId))
  if (!record) return { ok: false, reason: "申请记录已丢失" }

  const updated: RechargeRequest = {
    ...record,
    status: "approved",
    processedAt: Date.now(),
    processedBy: adminUserId,
  }
  await kv.set(KEY_REQ(requestId), updated)
  await addCreditsBy(record.userId, record.amount)
  return { ok: true, record: updated }
}

export async function rejectRequest(
  requestId: string,
  adminUserId: string
): Promise<{ ok: true; record: RechargeRequest } | { ok: false; reason: string }> {
  const removed = await kv.srem(KEY_PENDING_SET, requestId)
  if (!removed) return { ok: false, reason: "该申请已被处理或不存在" }

  const record = await kv.get<RechargeRequest>(KEY_REQ(requestId))
  if (!record) return { ok: false, reason: "申请记录已丢失" }

  const updated: RechargeRequest = {
    ...record,
    status: "rejected",
    processedAt: Date.now(),
    processedBy: adminUserId,
  }
  await kv.set(KEY_REQ(requestId), updated)
  return { ok: true, record: updated }
}
