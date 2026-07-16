import type { PaymentOrder } from "@/lib/payment-types"

export const ONLINE_PAYMENT_ORDER_TTL_MS = 15 * 60 * 1000

export type FirstPurchaseBlockReason = "completed_purchase" | "active_intro_order"

export function firstPurchaseBlockMessage(reason: FirstPurchaseBlockReason): string {
  return reason === "completed_purchase"
    ? "首购体验包仅限首次真实充值前购买，请选择其他套餐。"
    : "已有首购体验包待支付，请完成原订单或 15 分钟后重新发起。"
}

export function firstPurchaseBlockReasonForOrder(
  order: PaymentOrder,
  packageKey: string,
  at = Date.now(),
): FirstPurchaseBlockReason | null {
  if (["paid", "credited", "refunding", "refunded"].includes(order.status)) {
    return "completed_purchase"
  }
  if (order.packageKey !== packageKey || order.status !== "pending") return null

  if (["wechat", "alipay"].includes(order.provider)) {
    if (!Number.isFinite(order.createdAt)) return "active_intro_order"
    return order.createdAt + ONLINE_PAYMENT_ORDER_TTL_MS > at
      ? "active_intro_order"
      : null
  }

  return "active_intro_order"
}

export function paymentOrderBlocksFirstPurchase(
  order: PaymentOrder,
  packageKey: string,
  at = Date.now(),
): boolean {
  return firstPurchaseBlockReasonForOrder(order, packageKey, at) !== null
}

export function getFirstPurchaseBlockReason(
  orders: readonly PaymentOrder[],
  packageKey: string,
  at = Date.now(),
): FirstPurchaseBlockReason | null {
  let pendingReason: FirstPurchaseBlockReason | null = null
  for (const order of orders) {
    const reason = firstPurchaseBlockReasonForOrder(order, packageKey, at)
    if (reason === "completed_purchase") return reason
    if (reason) pendingReason = reason
  }
  return pendingReason
}

export function hasBlockingFirstPurchaseOrder(
  orders: readonly PaymentOrder[],
  packageKey: string,
  at = Date.now(),
): boolean {
  return getFirstPurchaseBlockReason(orders, packageKey, at) !== null
}
