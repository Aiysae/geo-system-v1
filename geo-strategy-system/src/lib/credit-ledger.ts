import "server-only"

import { randomUUID } from "crypto"
import { kv } from "@/lib/kv"
import { PRICING_VERSION, type FeaturePriceKey } from "@/lib/pricing"

export type CreditLedgerType =
  | "trial_grant"
  | "bootstrap_grant"
  | "recharge_requested"
  | "recharge_approved"
  | "recharge_rejected"
  | "admin_adjust"
  | "usage_reserved"
  | "usage_refund"
  | "usage_extra"

export type CreditLedgerContext = {
  type?: CreditLedgerType
  source?: string
  sourceId?: string
  featureKey?: FeaturePriceKey
  description?: string
  operatorUserId?: string
  metadata?: Record<string, string | number | boolean | null | undefined>
}

export type CreditLedgerEntry = {
  id: string
  userId: string
  type: CreditLedgerType
  delta: number
  balanceAfter?: number
  source?: string
  sourceId?: string
  featureKey?: FeaturePriceKey
  description?: string
  operatorUserId?: string
  metadata?: Record<string, string | number | boolean | null>
  pricingVersion: string
  createdAt: number
}

const KEY_ENTRY = (id: string) => `credit_ledger:${id}`
const KEY_USER_INDEX = (userId: string) => `credit_ledger:user:${userId}`
const KEY_ALL = "credit_ledger:all"

function cleanMetadata(
  metadata: CreditLedgerContext["metadata"],
): CreditLedgerEntry["metadata"] | undefined {
  if (!metadata) return undefined
  const cleaned: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) continue
    cleaned[key] = value
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined
}

export async function writeCreditLedgerEntry(input: {
  userId: string
  delta: number
  balanceAfter?: number
  context?: CreditLedgerContext
}): Promise<CreditLedgerEntry> {
  const delta = Math.floor(input.delta)
  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error("积分流水 delta 不能为 0")
  }

  const id = `ledger_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 12)}`
  const context = input.context || {}
  const entry: CreditLedgerEntry = {
    id,
    userId: input.userId,
    type: context.type || (delta > 0 ? "admin_adjust" : "usage_reserved"),
    delta,
    balanceAfter: Number.isFinite(input.balanceAfter) ? Math.floor(input.balanceAfter as number) : undefined,
    source: context.source,
    sourceId: context.sourceId,
    featureKey: context.featureKey,
    description: context.description,
    operatorUserId: context.operatorUserId,
    metadata: cleanMetadata(context.metadata),
    pricingVersion: PRICING_VERSION,
    createdAt: Date.now(),
  }

  await kv.set(KEY_ENTRY(entry.id), entry)
  await kv.sadd(KEY_USER_INDEX(entry.userId), entry.id)
  await kv.sadd(KEY_ALL, entry.id)
  return entry
}

export async function listCreditLedgerForUser(
  userId: string,
  limit = 100,
): Promise<CreditLedgerEntry[]> {
  const ids = await kv.smembers<string[]>(KEY_USER_INDEX(userId))
  if (!ids || ids.length === 0) return []
  const entries = await Promise.all(ids.map(id => kv.get<CreditLedgerEntry>(KEY_ENTRY(id))))
  return entries
    .filter((entry): entry is CreditLedgerEntry => Boolean(entry))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(1, Math.floor(limit)))
}
