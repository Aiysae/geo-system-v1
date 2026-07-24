import "server-only"

import { kv } from "@/lib/kv"
import {
  listAllPaymentOrderRecords,
  listPaymentOrderRecordsForUser,
} from "@/lib/payment-store"
import type { PaymentOrder } from "@/lib/payment-types"
import type { MembershipSnapshot, MembershipSource, MembershipTier } from "@/types"
import {
  MEMBERSHIP_LEVELS,
  membershipLevelForTier,
  type ActiveMembershipTier,
  type MembershipLevelDefinition,
} from "@/lib/membership-catalog"

export type { MembershipSnapshot, MembershipSource, MembershipTier } from "@/types"
export {
  MEMBERSHIP_LEVELS,
  membershipTierLabel,
  type ActiveMembershipTier,
  type MembershipLevelDefinition,
} from "@/lib/membership-catalog"

type StoredMembership = {
  version?: 1 | 2
  userId: string
  tier: ActiveMembershipTier
  status: "active" | "revoked"
  source: MembershipSource
  sourceOrderId?: string
  activatedAt: number
  updatedAt: number
  revokedAt?: number
  paidCents?: number
  qualifyingOrderCount?: number
}

export type Vip1BackfillResult = {
  apply: boolean
  scannedOrders: number
  qualifyingOrders: number
  qualifyingUsers: number
  alreadyVip1: number
  grantedVip1: number
  upgradedUsers: number
}

const membershipKey = (userId: string) => `geo:membership:${userId}`
const paymentGrantKey = (orderId: string) => `geo:membership-grants:payment:${orderId}`
const userQualifyingOrderKey = (userId: string) => `geo:membership:qualifying-orders:${userId}`
const repairCheckedKey = (userId: string) => `geo:membership:repair-checked:${userId}`
const MEMBERS_SET_KEY = "geo:membership:vip1-users"
const REPAIR_CHECK_TTL_SECONDS = 5 * 60

const TIER_RANK: Record<MembershipTier, number> = {
  free: 0,
  vip1: 1,
  vip2: 2,
  vip3: 3,
  vip4: 4,
  vip5: 5,
  vip6: 6,
}

function levelForTier(tier: MembershipTier): MembershipLevelDefinition | undefined {
  return membershipLevelForTier(tier)
}

export function membershipTierRank(tier: MembershipTier): number {
  return TIER_RANK[tier] || 0
}

export function membershipTierForPaidCents(paidCents: number): MembershipTier {
  const normalized = Math.max(0, Math.floor(Number(paidCents) || 0))
  let tier: MembershipTier = "free"
  for (const level of MEMBERSHIP_LEVELS) {
    if (normalized < level.minPaidCents) break
    tier = level.tier
  }
  return tier
}

export function membershipClientAccountLimit(tier: MembershipTier): number {
  return levelForTier(tier)?.clientAccountLimit || 0
}

export function hasMembershipTier(
  membership: Pick<MembershipSnapshot, "tier">,
  required: ActiveMembershipTier,
): boolean {
  return membershipTierRank(membership.tier) >= membershipTierRank(required)
}

function nextLevel(tier: MembershipTier): MembershipLevelDefinition | undefined {
  const rank = membershipTierRank(tier)
  return MEMBERSHIP_LEVELS.find(level => membershipTierRank(level.tier) > rank)
}

function freeMembership(paidCents = 0, qualifyingOrderCount = 0): MembershipSnapshot {
  const next = MEMBERSHIP_LEVELS[0]
  return {
    tier: "free",
    active: false,
    paidCents,
    qualifyingOrderCount,
    nextTier: next.tier,
    nextTierPaidCents: next.minPaidCents,
    amountToNextTierCents: Math.max(0, next.minPaidCents - paidCents),
    clientAccountLimit: 0,
  }
}

function toSnapshot(record: StoredMembership | null): MembershipSnapshot {
  if (!record || record.status !== "active" || !levelForTier(record.tier)) {
    return freeMembership()
  }
  const paidCents = Math.max(0, Math.floor(Number(record.paidCents) || 0))
  const qualifyingOrderCount = Math.max(0, Math.floor(Number(record.qualifyingOrderCount) || 0))
  const next = nextLevel(record.tier)
  return {
    tier: record.tier,
    active: true,
    source: record.source,
    sourceOrderId: record.sourceOrderId,
    activatedAt: record.activatedAt,
    paidCents,
    qualifyingOrderCount,
    nextTier: next?.tier,
    nextTierPaidCents: next?.minPaidCents,
    amountToNextTierCents: next ? Math.max(0, next.minPaidCents - paidCents) : 0,
    clientAccountLimit: membershipClientAccountLimit(record.tier),
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

export const isQualifyingMembershipPayment = isQualifyingVip1Payment

function orderPaidCents(order: PaymentOrder): number {
  return Math.max(0, Math.floor(Number(order.paidCents ?? order.priceCents) || 0))
}

function effectiveTier(paymentTier: MembershipTier, current: StoredMembership | null): MembershipTier {
  const adminFloor = current?.status === "active" && current.source === "admin"
    ? current.tier
    : "free"
  return membershipTierRank(adminFloor) > membershipTierRank(paymentTier)
    ? adminFloor
    : paymentTier
}

export async function getMembership(userId: string): Promise<MembershipSnapshot> {
  if (!userId) return freeMembership()
  return toSnapshot(await kv.get<StoredMembership>(membershipKey(userId)))
}

export async function recalculateMembershipForUser(
  userId: string,
  suppliedOrders?: readonly PaymentOrder[],
): Promise<MembershipSnapshot> {
  if (!userId) return freeMembership()
  const [current, orders] = await Promise.all([
    kv.get<StoredMembership>(membershipKey(userId)),
    suppliedOrders
      ? Promise.resolve([...suppliedOrders])
      : listPaymentOrderRecordsForUser(userId, 2_000),
  ])
  const qualifying = orders
    .filter(order => order.userId === userId && isQualifyingMembershipPayment(order))
    .sort((left, right) => (
      (left.creditedAt || left.paidAt || left.createdAt)
      - (right.creditedAt || right.paidAt || right.createdAt)
    ))
  const paidCents = qualifying.reduce((sum, order) => sum + orderPaidCents(order), 0)
  const paymentTier = membershipTierForPaidCents(paidCents)
  const tier = effectiveTier(paymentTier, current)

  if (tier === "free") {
    if (current) await kv.del(membershipKey(userId))
    await kv.del(repairCheckedKey(userId))
    return freeMembership(paidCents, qualifying.length)
  }

  const firstOrder = qualifying[0]
  const now = Date.now()
  const adminWins = current?.status === "active"
    && current.source === "admin"
    && membershipTierRank(current.tier) > membershipTierRank(paymentTier)
  const record: StoredMembership = {
    version: 2,
    userId,
    tier,
    status: "active",
    source: adminWins ? "admin" : "payment",
    sourceOrderId: adminWins ? current?.sourceOrderId : firstOrder?.id,
    activatedAt: Math.min(
      current?.activatedAt || Number.MAX_SAFE_INTEGER,
      firstOrder?.creditedAt || firstOrder?.paidAt || firstOrder?.createdAt || now,
    ),
    updatedAt: now,
    paidCents,
    qualifyingOrderCount: qualifying.length,
  }
  await kv.set(membershipKey(userId), record)
  await kv.sadd(MEMBERS_SET_KEY, userId)
  await kv.set(repairCheckedKey(userId), "checked", { ex: REPAIR_CHECK_TTL_SECONDS })
  return toSnapshot(record)
}

export async function grantVip1FromPaymentOrder(order: PaymentOrder): Promise<MembershipSnapshot> {
  if (!isQualifyingMembershipPayment(order)) {
    throw new Error("仅实际到账的充值订单可以激活 VIP1")
  }

  const activatedAt = order.creditedAt || order.paidAt || Date.now()
  await kv.set(paymentGrantKey(order.id), {
    userId: order.userId,
    orderId: order.id,
    activatedAt,
  }, { nx: true })
  await kv.sadd(userQualifyingOrderKey(order.userId), order.id)
  await kv.del(repairCheckedKey(order.userId))
  return recalculateMembershipForUser(order.userId)
}

/**
 * 会员记录缺失或仍是旧版结构时检查历史到账订单，用于支付回调中断后的自我修复。
 */
export async function getMembershipWithPaymentRepair(userId: string): Promise<MembershipSnapshot> {
  if (!userId) return freeMembership()
  const stored = await kv.get<StoredMembership>(membershipKey(userId))
  if (stored?.version === 2 && await kv.get(repairCheckedKey(userId))) {
    return toSnapshot(stored)
  }
  return recalculateMembershipForUser(userId)
}

export async function backfillVip1Memberships(apply = false): Promise<Vip1BackfillResult> {
  const orders = await listAllPaymentOrderRecords(2_000)
  const qualifyingOrders = orders.filter(isQualifyingMembershipPayment)
  const ordersByUser = new Map<string, PaymentOrder[]>()

  for (const order of qualifyingOrders) {
    const userOrders = ordersByUser.get(order.userId) || []
    userOrders.push(order)
    ordersByUser.set(order.userId, userOrders)
  }

  let alreadyVip1 = 0
  let grantedVip1 = 0
  let upgradedUsers = 0
  for (const [userId, userOrders] of ordersByUser) {
    const current = await getMembership(userId)
    if (current.active) alreadyVip1 += 1
    if (apply) {
      const next = await recalculateMembershipForUser(userId, userOrders)
      if (!current.active && next.active) grantedVip1 += 1
      if (membershipTierRank(next.tier) > membershipTierRank(current.tier)) upgradedUsers += 1
    }
  }

  return {
    apply,
    scannedOrders: orders.length,
    qualifyingOrders: qualifyingOrders.length,
    qualifyingUsers: ordersByUser.size,
    alreadyVip1,
    grantedVip1,
    upgradedUsers,
  }
}
