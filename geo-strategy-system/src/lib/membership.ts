import "server-only"

import { kv } from "@/lib/kv"
import {
  listAllPaymentOrderRecords,
  listPaymentOrderRecordsForUser,
} from "@/lib/payment-store"
import type { PaymentOrder } from "@/lib/payment-types"
import type { MembershipSnapshot, MembershipSource } from "@/types"

export type { MembershipSnapshot, MembershipSource, MembershipTier } from "@/types"

type StoredMembership = {
  userId: string
  tier: "vip1"
  status: "active" | "revoked"
  source: MembershipSource
  sourceOrderId?: string
  activatedAt: number
  updatedAt: number
  revokedAt?: number
}

export type Vip1BackfillResult = {
  apply: boolean
  scannedOrders: number
  qualifyingOrders: number
  qualifyingUsers: number
  alreadyVip1: number
  grantedVip1: number
}

const membershipKey = (userId: string) => `geo:membership:${userId}`
const paymentGrantKey = (orderId: string) => `geo:membership-grants:payment:${orderId}`
const userQualifyingOrderKey = (userId: string) => `geo:membership:qualifying-orders:${userId}`
const repairCheckedKey = (userId: string) => `geo:membership:repair-checked:${userId}`
const MEMBERS_SET_KEY = "geo:membership:vip1-users"
const REPAIR_CHECK_TTL_SECONDS = 5 * 60

function freeMembership(): MembershipSnapshot {
  return { tier: "free", active: false }
}

function toSnapshot(record: StoredMembership | null): MembershipSnapshot {
  if (!record || record.status !== "active" || record.tier !== "vip1") return freeMembership()
  return {
    tier: "vip1",
    active: true,
    source: record.source,
    sourceOrderId: record.sourceOrderId,
    activatedAt: record.activatedAt,
  }
}

export function isQualifyingVip1Payment(order: PaymentOrder): boolean {
  if (order.status !== "credited" || order.refundedAt) return false
  const paidCents = order.paidCents ?? order.priceCents
  return Number.isFinite(order.priceCents)
    && order.priceCents > 0
    && Number.isFinite(paidCents)
    && paidCents > 0
}

export async function getMembership(userId: string): Promise<MembershipSnapshot> {
  if (!userId) return freeMembership()
  return toSnapshot(await kv.get<StoredMembership>(membershipKey(userId)))
}

export async function grantVip1FromPaymentOrder(order: PaymentOrder): Promise<MembershipSnapshot> {
  if (!isQualifyingVip1Payment(order)) {
    throw new Error("仅实际到账的充值订单可以激活 VIP1")
  }

  const now = Date.now()
  const activatedAt = order.creditedAt || order.paidAt || now
  await kv.set(paymentGrantKey(order.id), {
    userId: order.userId,
    orderId: order.id,
    activatedAt,
  }, { nx: true })
  await kv.sadd(userQualifyingOrderKey(order.userId), order.id)

  const current = await kv.get<StoredMembership>(membershipKey(order.userId))
  const record: StoredMembership = current?.status === "active" && current.tier === "vip1"
    ? {
        ...current,
        activatedAt: Math.min(current.activatedAt, activatedAt),
        updatedAt: now,
      }
    : {
        userId: order.userId,
        tier: "vip1",
        status: "active",
        source: "payment",
        sourceOrderId: order.id,
        activatedAt,
        updatedAt: now,
      }

  await kv.set(membershipKey(order.userId), record)
  await kv.sadd(MEMBERS_SET_KEY, order.userId)
  await kv.del(repairCheckedKey(order.userId))
  return toSnapshot(record)
}

/**
 * 仅在会员记录缺失时检查历史到账订单，用于支付回调中断后的自我修复。
 */
export async function getMembershipWithPaymentRepair(userId: string): Promise<MembershipSnapshot> {
  const current = await getMembership(userId)
  if (current.active) return current
  if (await kv.get(repairCheckedKey(userId))) return current

  const orders = await listPaymentOrderRecordsForUser(userId, 500)
  const qualifying = orders
    .filter(isQualifyingVip1Payment)
    .sort((a, b) => (a.creditedAt || a.createdAt) - (b.creditedAt || b.createdAt))[0]
  if (qualifying) return await grantVip1FromPaymentOrder(qualifying)
  await kv.set(repairCheckedKey(userId), "checked", { ex: REPAIR_CHECK_TTL_SECONDS })
  return current
}

export async function backfillVip1Memberships(apply = false): Promise<Vip1BackfillResult> {
  const orders = await listAllPaymentOrderRecords(2_000)
  const qualifyingOrders = orders.filter(isQualifyingVip1Payment)
  const earliestByUser = new Map<string, PaymentOrder>()

  for (const order of qualifyingOrders) {
    const current = earliestByUser.get(order.userId)
    if (!current || (order.creditedAt || order.createdAt) < (current.creditedAt || current.createdAt)) {
      earliestByUser.set(order.userId, order)
    }
  }

  let alreadyVip1 = 0
  let grantedVip1 = 0
  for (const order of earliestByUser.values()) {
    const current = await getMembership(order.userId)
    if (current.active) {
      alreadyVip1 += 1
      continue
    }
    if (apply) {
      await grantVip1FromPaymentOrder(order)
      grantedVip1 += 1
    }
  }

  return {
    apply,
    scannedOrders: orders.length,
    qualifyingOrders: qualifyingOrders.length,
    qualifyingUsers: earliestByUser.size,
    alreadyVip1,
    grantedVip1,
  }
}
