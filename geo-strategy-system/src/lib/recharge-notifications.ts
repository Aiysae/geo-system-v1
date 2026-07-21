import "server-only"

import { kv } from "@/lib/kv"
import { listPending, type RechargePaymentMethod, type RechargeRequest } from "@/lib/recharge"

export type RechargeNotificationSummary = {
  id: string
  username: string
  email: string
  packageName: string
  priceCents?: number
  credits: number
  paymentMethod: RechargePaymentMethod
  createdAt: number
}

export type AdminRechargeNotificationSnapshot = {
  pendingCount: number
  unread: RechargeNotificationSummary[]
}

const KEY_SEEN = (adminUserId: string) => `admin_notifications:recharge:seen:${adminUserId}`

function summarize(request: RechargeRequest): RechargeNotificationSummary {
  return {
    id: request.id,
    username: request.username,
    email: request.email,
    packageName: request.packageName || "充值套餐",
    priceCents: request.priceCents,
    credits: request.credits ?? request.amount,
    paymentMethod: request.paymentMethod || "manual_transfer",
    createdAt: request.createdAt,
  }
}

export async function getAdminRechargeNotificationSnapshot(
  adminUserId: string,
): Promise<AdminRechargeNotificationSnapshot> {
  const [pending, seenIds] = await Promise.all([
    listPending(),
    kv.smembers<string[]>(KEY_SEEN(adminUserId)),
  ])
  const seen = new Set(seenIds || [])
  return {
    pendingCount: pending.length,
    unread: pending.filter(request => !seen.has(request.id)).map(summarize),
  }
}

export async function markRechargeNotificationsSeen(
  adminUserId: string,
  requestIds: readonly string[],
): Promise<void> {
  const safeIds = Array.from(new Set(requestIds))
    .map(id => String(id || "").trim())
    .filter(id => id.startsWith("req_") && id.length <= 128)
    .slice(0, 100)
  if (safeIds.length > 0) await kv.sadd(KEY_SEEN(adminUserId), ...safeIds)
}
