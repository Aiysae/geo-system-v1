import "server-only"

import { randomUUID } from "crypto"
import {
  claimAdminPaymentRequestSettlement,
  completeAdminPaymentRequestSettlement,
} from "@/lib/admin-payment-request-settlement"
import { getCredits, settlePaymentCreditsOnce } from "@/lib/credits"
import { fulfillManagedServicePaymentOrder } from "@/lib/managed-services"
import { grantVip1FromPaymentOrder } from "@/lib/membership"
import {
  getPaymentOrderRecord,
  getPaymentOrderRecordByOutTradeNo,
  listAllPaymentOrderRecords,
  listPaymentOrderRecordsForUser,
  savePaymentOrderRecord,
} from "@/lib/payment-store"
import type { RechargePackageKey } from "@/lib/pricing"
import type {
  PaymentOrder,
  PaymentOrderOrigin,
  PaymentProductType,
  PaymentProvider,
} from "@/lib/payment-types"

export type { PaymentOrder, PaymentOrderStatus, PaymentProvider } from "@/lib/payment-types"

export type CreditPaymentOrderResult =
  | { ok: true; credited: true; order: PaymentOrder; balance: number }
  | { ok: true; credited: false; order: PaymentOrder; reason: "already_credited" }
  | { ok: false; reason: string }

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

export async function createPaymentOrder(input: {
  userId: string
  username: string
  email: string
  rechargeRequestId?: string
  origin?: PaymentOrderOrigin
  adminPaymentRequestId?: string
  productType?: PaymentProductType
  managedServiceOrderId?: string
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
    origin: input.origin || "self_checkout",
    adminPaymentRequestId: input.adminPaymentRequestId,
    productType: input.productType || "credits",
    managedServiceOrderId: input.managedServiceOrderId,
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

  await savePaymentOrderRecord(order)
  return order
}

export async function getPaymentOrder(id: string): Promise<PaymentOrder | null> {
  if (!id) return null
  return await getPaymentOrderRecord(id)
}

export async function getPaymentOrderByOutTradeNo(outTradeNo: string): Promise<PaymentOrder | null> {
  if (!outTradeNo) return null
  return await getPaymentOrderRecordByOutTradeNo(outTradeNo)
}

export async function listPaymentOrdersForUser(
  userId: string,
  limit = 100,
): Promise<PaymentOrder[]> {
  return await listPaymentOrderRecordsForUser(userId, limit)
}

export async function listAllPaymentOrders(limit = 500): Promise<PaymentOrder[]> {
  return await listAllPaymentOrderRecords(limit)
}

export async function cancelPaymentOrder(
  orderId: string,
  reason: string,
): Promise<PaymentOrder | null> {
  const order = await getPaymentOrder(orderId)
  if (!order) return null
  if (["paid", "credited", "refunding", "refunded"].includes(order.status)) return order
  const updated: PaymentOrder = {
    ...order,
    status: "canceled",
    failureReason: reason,
    canceledAt: now(),
    updatedAt: now(),
  }
  await savePaymentOrderRecord(updated)
  return updated
}

export async function failPaymentOrder(
  orderId: string,
  reason: string,
): Promise<PaymentOrder | null> {
  const order = await getPaymentOrder(orderId)
  if (!order) return null
  if (["paid", "credited", "refunding", "refunded"].includes(order.status)) return order
  const updated: PaymentOrder = {
    ...order,
    status: "failed",
    failureReason: cleanOptionalText(reason, 300) || "支付订单处理失败",
    updatedAt: now(),
  }
  await savePaymentOrderRecord(updated)
  return updated
}

export async function updatePaymentOrderPayerDetails(
  orderId: string,
  input: {
    payerName?: string
    paymentReference?: string
    contact?: string
  },
): Promise<PaymentOrder> {
  const order = await getPaymentOrder(orderId)
  if (!order) throw new Error("支付订单不存在")
  if (["credited", "refunding", "refunded", "canceled"].includes(order.status)) {
    throw new Error("当前支付订单不能再更新付款信息")
  }
  const updated: PaymentOrder = {
    ...order,
    payerName: cleanOptionalText(input.payerName, 80),
    paymentReference: cleanOptionalText(input.paymentReference, 120),
    contact: cleanOptionalText(input.contact, 120),
    updatedAt: now(),
  }
  await savePaymentOrderRecord(updated)
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
    if (order.productType === "managed_service") await fulfillManagedServicePaymentOrder(order)
    else {
      await grantVip1FromPaymentOrder(order)
      await completeAdminPaymentRequestSettlement(order)
    }
    return { ok: true, credited: false, order, reason: "already_credited" }
  }
  if (order.status === "canceled") return { ok: false, reason: "支付订单已取消，不能到账" }
  if (order.status === "refunding" || order.status === "refunded") {
    return { ok: false, reason: "支付订单正在退款或已退款，不能到账" }
  }

  const paidCents = typeof input.paidCents === "number" ? Math.floor(input.paidCents) : order.priceCents
  if (paidCents !== order.priceCents) {
    const failed: PaymentOrder = {
      ...order,
      status: "failed",
      paidCents,
      failureReason: `支付金额不匹配：应付 ${order.priceCents} 分，实付 ${paidCents} 分`,
      updatedAt: now(),
    }
    await savePaymentOrderRecord(failed)
    return { ok: false, reason: failed.failureReason || "支付金额不匹配" }
  }

  const latest = await getPaymentOrder(order.id)
  if (!latest) return { ok: false, reason: "支付订单不存在" }
  if (latest.status === "credited" && latest.creditedAt) {
    if (latest.productType === "managed_service") await fulfillManagedServicePaymentOrder(latest)
    else {
      await grantVip1FromPaymentOrder(latest)
      await completeAdminPaymentRequestSettlement(latest)
    }
    return { ok: true, credited: false, order: latest, reason: "already_credited" }
  }

  const settledAt = now()
  const paidOrder: PaymentOrder = {
    ...latest,
    status: "paid",
    providerTradeId: input.providerTradeId || latest.providerTradeId,
    paidCents,
    paidAt: input.paidAt || latest.paidAt || settledAt,
    failureReason: undefined,
    updatedAt: settledAt,
  }
  const requestClaim = await claimAdminPaymentRequestSettlement(paidOrder)
  if (!requestClaim.ok) return { ok: false, reason: requestClaim.reason }
  await savePaymentOrderRecord(paidOrder)

  if (paidOrder.productType === "managed_service") {
    const updated: PaymentOrder = {
      ...paidOrder,
      status: "credited",
      creditedAt: settledAt,
      creditedBy: input.operatorUserId || paidOrder.creditedBy,
      updatedAt: settledAt,
    }
    await savePaymentOrderRecord(updated)
    const fulfillment = await fulfillManagedServicePaymentOrder(updated)
    const balance = await getCredits(updated.userId)
    return fulfillment.fulfilledNow
      ? { ok: true, credited: true, order: updated, balance }
      : { ok: true, credited: false, order: updated, reason: "already_credited" }
  }

  const settlement = await settlePaymentCreditsOnce({
    orderId: paidOrder.id,
    userId: paidOrder.userId,
    credits: paidOrder.credits,
    operatorUserId: input.operatorUserId,
    context: {
      type: "recharge_approved",
      source: "payment_order",
      sourceId: paidOrder.id,
      description: `充值到账：${paidOrder.packageName}`,
      operatorUserId: input.operatorUserId,
      metadata: {
        paymentOrderId: paidOrder.id,
        outTradeNo: paidOrder.outTradeNo,
        rechargeRequestId: paidOrder.rechargeRequestId,
        packageKey: paidOrder.packageKey,
        packageName: paidOrder.packageName,
        priceCents: paidOrder.priceCents,
        paymentMethod: paidOrder.provider,
        providerTradeId: paidOrder.providerTradeId,
        settlementSource: input.source || "manual_approval",
      },
    },
  })
  const updated: PaymentOrder = {
    ...paidOrder,
    status: "credited",
    creditedAt: settledAt,
    creditedBy: input.operatorUserId || paidOrder.creditedBy,
    updatedAt: settledAt,
  }
  await savePaymentOrderRecord(updated)
  await grantVip1FromPaymentOrder(updated)
  await completeAdminPaymentRequestSettlement(updated)
  return settlement.alreadySettled
    ? { ok: true, credited: false, order: updated, reason: "already_credited" }
    : { ok: true, credited: true, order: updated, balance: settlement.balance }
}
