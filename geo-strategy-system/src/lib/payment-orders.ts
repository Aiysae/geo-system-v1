import "server-only"

import { randomUUID } from "crypto"
import { kv } from "@/lib/kv"
import { addCreditsBy } from "@/lib/credits"
import type { RechargePackageKey } from "@/lib/pricing"
import type { RechargePaymentMethod } from "@/lib/recharge"

export type PaymentOrderStatus =
  | "pending"
  | "credited"
  | "canceled"
  | "failed"

export type PaymentProvider = RechargePaymentMethod

export type PaymentOrder = {
  id: string
  outTradeNo: string
  userId: string
  username: string
  email: string
  rechargeRequestId?: string
  packageKey?: RechargePackageKey
  packageName: string
  priceCents: number
  credits: number
  provider: PaymentProvider
  status: PaymentOrderStatus
  payerName?: string
  paymentReference?: string
  contact?: string
  note?: string
  providerTradeId?: string
  paidCents?: number
  failureReason?: string
  createdAt: number
  updatedAt: number
  paidAt?: number
  creditedAt?: number
  canceledAt?: number
  creditedBy?: string
}

export type CreditPaymentOrderResult =
  | { ok: true; credited: true; order: PaymentOrder; balance: number }
  | { ok: true; credited: false; order: PaymentOrder; reason: "already_credited" }
  | { ok: false; reason: string }

const KEY_ORDER = (id: string) => `payment_orders:${id}`
const KEY_OUT_TRADE_NO = (outTradeNo: string) => `payment_orders:out_trade_no:${outTradeNo}`
const KEY_USER_INDEX = (userId: string) => `payment_orders:user:${userId}`
const KEY_ALL = "payment_orders:all"
const KEY_CREDIT_LOCK = (id: string) => `payment_orders:credit_lock:${id}`

function now(): number {
  return Date.now()
}

function newPaymentOrderId(): string {
  return `pay_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 12)}`
}

function newOutTradeNo(): string {
  return `ST${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

function cleanOptionalText(value: unknown, maxLength: number): string | undefined {
  const text = String(value || "").trim()
  if (!text) return undefined
  return text.slice(0, maxLength)
}

async function savePaymentOrder(order: PaymentOrder): Promise<void> {
  await kv.set(KEY_ORDER(order.id), order)
  await kv.set(KEY_OUT_TRADE_NO(order.outTradeNo), order.id)
  await kv.sadd(KEY_USER_INDEX(order.userId), order.id)
  await kv.sadd(KEY_ALL, order.id)
}

export async function createPaymentOrder(input: {
  userId: string
  username: string
  email: string
  rechargeRequestId?: string
  packageKey?: RechargePackageKey
  packageName: string
  priceCents: number
  credits: number
  provider: PaymentProvider
  payerName?: string
  paymentReference?: string
  contact?: string
  note?: string
}): Promise<PaymentOrder> {
  const createdAt = now()
  const order: PaymentOrder = {
    id: newPaymentOrderId(),
    outTradeNo: newOutTradeNo(),
    userId: input.userId,
    username: input.username,
    email: input.email,
    rechargeRequestId: input.rechargeRequestId,
    packageKey: input.packageKey,
    packageName: input.packageName,
    priceCents: Math.max(0, Math.floor(input.priceCents)),
    credits: Math.max(0, Math.floor(input.credits)),
    provider: input.provider,
    status: "pending",
    payerName: cleanOptionalText(input.payerName, 80),
    paymentReference: cleanOptionalText(input.paymentReference, 120),
    contact: cleanOptionalText(input.contact, 120),
    note: cleanOptionalText(input.note, 300),
    createdAt,
    updatedAt: createdAt,
  }

  await savePaymentOrder(order)
  return order
}

export async function getPaymentOrder(id: string): Promise<PaymentOrder | null> {
  if (!id) return null
  return await kv.get<PaymentOrder>(KEY_ORDER(id))
}

export async function getPaymentOrderByOutTradeNo(outTradeNo: string): Promise<PaymentOrder | null> {
  if (!outTradeNo) return null
  const id = await kv.get<string>(KEY_OUT_TRADE_NO(outTradeNo))
  return id ? await getPaymentOrder(id) : null
}

export async function listPaymentOrdersForUser(
  userId: string,
  limit = 100,
): Promise<PaymentOrder[]> {
  const ids = await kv.smembers<string[]>(KEY_USER_INDEX(userId))
  if (!ids || ids.length === 0) return []
  const orders = await Promise.all(ids.map(id => getPaymentOrder(id)))
  return orders
    .filter((order): order is PaymentOrder => Boolean(order))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(1, Math.floor(limit)))
}

export async function listAllPaymentOrders(limit = 500): Promise<PaymentOrder[]> {
  const ids = await kv.smembers<string[]>(KEY_ALL)
  if (!ids || ids.length === 0) return []
  const orders = await Promise.all(ids.map(id => getPaymentOrder(id)))
  return orders
    .filter((order): order is PaymentOrder => Boolean(order))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(1, Math.floor(limit)))
}

export async function cancelPaymentOrder(
  orderId: string,
  reason: string,
): Promise<PaymentOrder | null> {
  const order = await getPaymentOrder(orderId)
  if (!order) return null
  if (order.status === "credited") return order
  const updated: PaymentOrder = {
    ...order,
    status: "canceled",
    failureReason: reason,
    canceledAt: now(),
    updatedAt: now(),
  }
  await savePaymentOrder(updated)
  return updated
}

export async function creditPaymentOrder(input: {
  orderId: string
  operatorUserId?: string
  providerTradeId?: string
  paidCents?: number
  paidAt?: number
  source?: "manual_approval" | "payment_callback"
}): Promise<CreditPaymentOrderResult> {
  const order = await getPaymentOrder(input.orderId)
  if (!order) return { ok: false, reason: "支付订单不存在" }
  if (order.status === "credited" && order.creditedAt) {
    return { ok: true, credited: false, order, reason: "already_credited" }
  }
  if (order.status === "canceled") return { ok: false, reason: "支付订单已取消，不能到账" }

  const paidCents = typeof input.paidCents === "number" ? Math.floor(input.paidCents) : order.priceCents
  if (paidCents !== order.priceCents) {
    const failed: PaymentOrder = {
      ...order,
      status: "failed",
      paidCents,
      failureReason: `支付金额不匹配：应付 ${order.priceCents} 分，实付 ${paidCents} 分`,
      updatedAt: now(),
    }
    await savePaymentOrder(failed)
    return { ok: false, reason: failed.failureReason || "支付金额不匹配" }
  }

  const locked = await kv.set(KEY_CREDIT_LOCK(order.id), "1", { nx: true, ex: 3600 })
  if (!locked) {
    const latest = await getPaymentOrder(order.id)
    if (latest?.status === "credited" && latest.creditedAt) {
      return { ok: true, credited: false, order: latest, reason: "already_credited" }
    }
    return { ok: false, reason: "该支付订单正在结算，请稍后刷新" }
  }

  const latest = await getPaymentOrder(order.id)
  if (!latest) return { ok: false, reason: "支付订单不存在" }
  if (latest.status === "credited" && latest.creditedAt) {
    return { ok: true, credited: false, order: latest, reason: "already_credited" }
  }

  const balance = await addCreditsBy(latest.userId, latest.credits, {
    type: "recharge_approved",
    source: "payment_order",
    sourceId: latest.id,
    description: `充值到账：${latest.packageName}`,
    operatorUserId: input.operatorUserId,
    metadata: {
      paymentOrderId: latest.id,
      outTradeNo: latest.outTradeNo,
      rechargeRequestId: latest.rechargeRequestId,
      packageKey: latest.packageKey,
      packageName: latest.packageName,
      priceCents: latest.priceCents,
      paymentMethod: latest.provider,
      providerTradeId: input.providerTradeId,
      settlementSource: input.source || "manual_approval",
    },
  })
  const settledAt = now()
  const updated: PaymentOrder = {
    ...latest,
    status: "credited",
    providerTradeId: input.providerTradeId || latest.providerTradeId,
    paidCents,
    paidAt: input.paidAt || latest.paidAt || settledAt,
    creditedAt: settledAt,
    creditedBy: input.operatorUserId || latest.creditedBy,
    updatedAt: settledAt,
  }
  await savePaymentOrder(updated)
  return { ok: true, credited: true, order: updated, balance }
}
