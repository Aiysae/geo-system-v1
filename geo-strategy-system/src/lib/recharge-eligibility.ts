import "server-only"

import { getMembershipWithPaymentRepair } from "@/lib/membership"
import {
  getFirstPurchaseBlockReason,
  type FirstPurchaseBlockReason,
} from "@/lib/payment-lifecycle"
import { listPaymentOrdersForUser } from "@/lib/payment-orders"

export async function getFirstPurchaseBlockReasonForUser(
  userId: string,
  packageKey: string,
): Promise<FirstPurchaseBlockReason | null> {
  const membership = await getMembershipWithPaymentRepair(userId)
  if (membership.active) return "completed_purchase"
  const orders = await listPaymentOrdersForUser(userId, 500)
  return getFirstPurchaseBlockReason(orders, packageKey)
}
