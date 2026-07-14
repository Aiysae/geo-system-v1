import type { PaymentOrder } from "@/lib/payment-types"

export const ONLINE_PAYMENT_ORDER_TTL_MS = 15 * 60 * 1000

export function paymentOrderBlocksFirstPurchase(
  order: PaymentOrder,
  packageKey: string,
  at = Date.now(),
): boolean {
  if (order.packageKey !== packageKey) return false
  if (["canceled", "failed", "refunded"].includes(order.status)) return false

  if (order.status === "pending" && ["wechat", "alipay"].includes(order.provider)) {
    if (!Number.isFinite(order.createdAt)) return true
    return order.createdAt + ONLINE_PAYMENT_ORDER_TTL_MS > at
  }

  return true
}

export function hasBlockingFirstPurchaseOrder(
  orders: readonly PaymentOrder[],
  packageKey: string,
  at = Date.now(),
): boolean {
  return orders.some(order => paymentOrderBlocksFirstPurchase(order, packageKey, at))
}
