import type { RechargePackageKey } from "@/lib/pricing"

export type PaymentOrderStatus =
  | "pending"
  | "paid"
  | "credited"
  | "canceled"
  | "failed"
  | "refunding"
  | "refunded"

export type PaymentProvider = "manual_transfer" | "wechat" | "alipay" | "other"
export type PaymentProductType = "credits" | "managed_service"

export type PaymentOrder = {
  id: string
  outTradeNo: string
  userId: string
  username: string
  email: string
  rechargeRequestId?: string
  productType?: PaymentProductType
  managedServiceOrderId?: string
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
  refundedAt?: number
  creditedBy?: string
}

export type PaymentEventStatus = "received" | "processed" | "ignored" | "failed"

export type PaymentEvent = {
  id: string
  provider: Exclude<PaymentProvider, "manual_transfer" | "other">
  providerEventId: string
  eventType: string
  status: PaymentEventStatus
  signatureVerified: boolean
  outTradeNo?: string
  providerTradeId?: string
  payload: Record<string, unknown>
  error?: string
  receivedAt: number
  processedAt?: number
}
