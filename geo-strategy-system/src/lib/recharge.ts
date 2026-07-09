import { kv } from "@/lib/kv"
import { addCreditsBy } from "./credits"
import {
  getRechargePackage,
  type RechargePackageKey,
} from "@/lib/pricing"

export type RechargeStatus = "pending" | "approved" | "rejected"
export type RechargePaymentMethod = "manual_transfer" | "wechat" | "alipay" | "other"

export type RechargeRequest = {
  id: string
  userId: string
  username: string
  email: string
  packageKey?: RechargePackageKey
  packageName?: string
  priceCents?: number
  credits?: number
  amount: number
  paymentMethod?: RechargePaymentMethod
  payerName?: string
  paymentReference?: string
  contact?: string
  note?: string
  status: RechargeStatus
  createdAt: number
  processedAt?: number
  processedBy?: string
}

export type RechargeOrder = RechargeRequest

const KEY_REQ = (id: string) => `recharge_requests:${id}`
const KEY_PENDING_SET = "recharge_requests:pending"
const KEY_USER_INDEX = (userId: string) => `recharge_requests:user:${userId}`
const KEY_ALL = "recharge_requests:all"

export const MIN_AMOUNT = 1
export const MAX_AMOUNT = 100000

function newId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export async function createRequest(input: {
  userId: string
  username: string
  email: string
  packageKey: string
  paymentMethod?: string
  payerName?: string
  paymentReference?: string
  contact?: string
  note?: string
}): Promise<RechargeRequest> {
  const pkg = getRechargePackage(input.packageKey)
  if (!pkg) throw new Error("请选择有效的充值套餐")
  if ("firstPurchaseOnly" in pkg && pkg.firstPurchaseOnly) {
    const previousRequests = await listRequestsForUser(input.userId, 300)
    const hasUsedFirstPurchasePackage = previousRequests.some(
      request => request.packageKey === pkg.key && request.status !== "rejected"
    )
    if (hasUsedFirstPurchasePackage) {
      throw new Error("首购体验包每个账号仅限提交一次，请选择轻量包或标准包。")
    }
  }

  const paymentMethod = normalizePaymentMethod(input.paymentMethod)
  const record: RechargeRequest = {
    id: newId(),
    userId: input.userId,
    username: input.username,
    email: input.email,
    packageKey: pkg.key,
    packageName: pkg.name,
    priceCents: pkg.priceCents,
    credits: pkg.credits,
    amount: pkg.credits,
    paymentMethod,
    payerName: cleanOptionalText(input.payerName, 80),
    paymentReference: cleanOptionalText(input.paymentReference, 120),
    contact: cleanOptionalText(input.contact, 120),
    note: input.note?.trim().slice(0, 300) || undefined,
    status: "pending",
    createdAt: Date.now(),
  }
  await kv.set(KEY_REQ(record.id), record)
  await kv.sadd(KEY_PENDING_SET, record.id)
  await kv.sadd(KEY_USER_INDEX(record.userId), record.id)
  await kv.sadd(KEY_ALL, record.id)
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

export async function listRequestsForUser(
  userId: string,
  limit = 100,
): Promise<RechargeRequest[]> {
  const ids = await kv.smembers<string[]>(KEY_USER_INDEX(userId))
  if (!ids || ids.length === 0) return []
  const records = await Promise.all(ids.map(id => kv.get<RechargeRequest>(KEY_REQ(id))))
  return records
    .filter((record): record is RechargeRequest => Boolean(record))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(1, Math.floor(limit)))
}

export async function listAllRequests(limit = 300): Promise<RechargeRequest[]> {
  const [allIds, pendingIds] = await Promise.all([
    kv.smembers<string[]>(KEY_ALL),
    kv.smembers<string[]>(KEY_PENDING_SET),
  ])
  const ids = Array.from(new Set([...(allIds || []), ...(pendingIds || [])]))
  if (ids.length === 0) return []
  const records = await Promise.all(ids.map(id => kv.get<RechargeRequest>(KEY_REQ(id))))
  return records
    .filter((record): record is RechargeRequest => Boolean(record))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(1, Math.floor(limit)))
}

function normalizePaymentMethod(value: unknown): RechargePaymentMethod {
  const raw = String(value || "").trim()
  if (raw === "wechat" || raw === "alipay" || raw === "other") return raw
  return "manual_transfer"
}

function cleanOptionalText(value: unknown, maxLength: number): string | undefined {
  const text = String(value || "").trim()
  if (!text) return undefined
  return text.slice(0, maxLength)
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
  await kv.sadd(KEY_ALL, requestId)
  await addCreditsBy(record.userId, record.credits ?? record.amount, {
    type: "recharge_approved",
    source: "recharge",
    sourceId: record.id,
    description: `充值到账：${record.packageName || "历史充值申请"}`,
    operatorUserId: adminUserId,
    metadata: {
      packageKey: record.packageKey,
      packageName: record.packageName,
      priceCents: record.priceCents,
      paymentMethod: record.paymentMethod,
      payerName: record.payerName,
      paymentReference: record.paymentReference,
      contact: record.contact,
    },
  })
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
  await kv.sadd(KEY_ALL, requestId)
  return { ok: true, record: updated }
}
