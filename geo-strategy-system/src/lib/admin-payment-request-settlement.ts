import "server-only"

import {
  mutateAdminPaymentRequestRecord,
} from "@/lib/admin-payment-request-store"
import type { AdminPaymentRequest } from "@/lib/admin-payment-request-types"
import type { PaymentOrder } from "@/lib/payment-types"
import { notifyPaymentRequestCredited } from "@/lib/user-notifications"

export async function claimAdminPaymentRequestSettlement(
  order: PaymentOrder,
): Promise<{ ok: true; request?: AdminPaymentRequest } | { ok: false; reason: string }> {
  if (!order.adminPaymentRequestId) return { ok: true }
  try {
    const request = await mutateAdminPaymentRequestRecord(
      order.adminPaymentRequestId,
      current => {
        if (current.userId !== order.userId) throw new Error("付款订单账号不匹配")
        if (current.priceCents !== order.priceCents || current.credits !== order.credits) {
          throw new Error("付款订单金额或积分不匹配")
        }
        if (current.status === "canceled") throw new Error("付款请求已取消")
        if (
          current.settlementPaymentOrderId
          && current.settlementPaymentOrderId !== order.id
        ) {
          throw new Error("该付款请求已由另一笔支付完成，请联系管理员处理退款")
        }
        const paidAt = order.paidAt || Date.now()
        return {
          ...current,
          status: current.status === "credited" ? "credited" : "paid",
          settlementPaymentOrderId: order.id,
          paidAt: current.paidAt || paidAt,
          updatedAt: Date.now(),
        }
      },
    )
    return request
      ? { ok: true, request }
      : { ok: false, reason: "付款请求不存在" }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "付款请求结算失败",
    }
  }
}

export async function completeAdminPaymentRequestSettlement(
  order: PaymentOrder,
): Promise<void> {
  if (!order.adminPaymentRequestId) return
  const request = await mutateAdminPaymentRequestRecord(
    order.adminPaymentRequestId,
    current => {
      if (
        current.settlementPaymentOrderId
        && current.settlementPaymentOrderId !== order.id
      ) {
        return current
      }
      const creditedAt = order.creditedAt || Date.now()
      return {
        ...current,
        status: "credited",
        settlementPaymentOrderId: order.id,
        activePaymentOrderId: order.id,
        paidAt: current.paidAt || order.paidAt || creditedAt,
        creditedAt: current.creditedAt || creditedAt,
        updatedAt: Date.now(),
      }
    },
  )
  if (request?.status === "credited") {
    await notifyPaymentRequestCredited(request)
  }
}
