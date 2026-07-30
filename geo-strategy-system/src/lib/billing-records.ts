import type { PaymentOrder } from "@/lib/payment-types"
import type { RechargePaymentMethod, RechargeRequest } from "@/lib/recharge"
import type { AdminPaymentRequest } from "@/lib/admin-payment-request-types"

export type BillingRechargeStatus =
  | "pending_review"
  | "pending_payment"
  | "processing"
  | "credited"
  | "rejected"
  | "canceled"
  | "failed"
  | "refunding"
  | "refunded"

export type BillingRechargeRecord = {
  id: string
  packageName: string
  paymentOutTradeNo?: string
  priceCents?: number
  credits: number
  paymentMethod?: RechargePaymentMethod
  payerName?: string
  paymentReference?: string
  contact?: string
  status: BillingRechargeStatus
  createdAt: number
  processedAt?: number
  actionUrl?: string
}

function requestStatus(status: RechargeRequest["status"]): BillingRechargeStatus {
  if (status === "approved") return "credited"
  if (status === "rejected") return "rejected"
  return "pending_review"
}

function orderStatus(status: PaymentOrder["status"]): BillingRechargeStatus {
  if (status === "pending") return "pending_payment"
  if (status === "paid") return "processing"
  return status
}

function requestRecord(request: RechargeRequest): BillingRechargeRecord {
  return {
    id: request.id,
    packageName: request.packageName || "历史充值申请",
    paymentOutTradeNo: request.paymentOutTradeNo || request.paymentOrderId,
    priceCents: request.priceCents,
    credits: request.credits ?? request.amount,
    paymentMethod: request.paymentMethod,
    payerName: request.payerName,
    paymentReference: request.paymentReference,
    contact: request.contact,
    status: requestStatus(request.status),
    createdAt: request.createdAt,
    processedAt: request.processedAt,
  }
}

function paymentRecord(order: PaymentOrder): BillingRechargeRecord {
  const processedAt = order.creditedAt
    || order.refundedAt
    || order.canceledAt
    || order.paidAt
    || (order.status === "pending" ? undefined : order.updatedAt)
  return {
    id: order.id,
    packageName: order.packageName,
    paymentOutTradeNo: order.outTradeNo,
    priceCents: order.priceCents,
    credits: order.credits,
    paymentMethod: order.provider,
    payerName: order.payerName,
    paymentReference: order.paymentReference,
    contact: order.contact,
    status: orderStatus(order.status),
    createdAt: order.createdAt,
    processedAt,
  }
}

function adminRequestStatus(
  status: AdminPaymentRequest["status"],
  transferSubmittedAt?: number,
): BillingRechargeStatus {
  if (status === "credited") return "credited"
  if (status === "paid") return "processing"
  if (status === "canceled" || status === "expired") return "canceled"
  return transferSubmittedAt ? "pending_review" : "pending_payment"
}

function adminRequestRecord(request: AdminPaymentRequest): BillingRechargeRecord {
  return {
    id: request.id,
    packageName: request.title,
    paymentOutTradeNo: request.activePaymentOrderId || request.id,
    priceCents: request.priceCents,
    credits: request.credits,
    paymentMethod: request.selectedProvider,
    payerName: request.payerName,
    paymentReference: request.paymentReference,
    contact: request.contact,
    status: adminRequestStatus(request.status, request.transferSubmittedAt),
    createdAt: request.createdAt,
    processedAt: request.creditedAt || request.canceledAt || request.paidAt,
    actionUrl: `/account/payment-requests/${encodeURIComponent(request.id)}`,
  }
}

export function mergeBillingRechargeRecords(
  requests: readonly RechargeRequest[],
  paymentOrders: readonly PaymentOrder[],
  limit = 80,
  adminPaymentRequests: readonly AdminPaymentRequest[] = [],
): BillingRechargeRecord[] {
  const requestOrderIds = new Set(
    requests.flatMap(request => request.paymentOrderId ? [request.paymentOrderId] : []),
  )
  const officialOrders = paymentOrders.filter(order => (
    order.productType !== "managed_service"
    && order.origin !== "admin_request"
    && !order.adminPaymentRequestId
    && (order.provider === "wechat" || order.provider === "alipay")
    && !requestOrderIds.has(order.id)
  ))
  const safeLimit = Math.max(1, Math.floor(limit))
  return [
    ...requests.filter(request => !request.id.startsWith("req_payreq_")).map(requestRecord),
    ...officialOrders.map(paymentRecord),
    ...adminPaymentRequests.map(adminRequestRecord),
  ]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, safeLimit)
}
