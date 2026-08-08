import type { PaymentProvider } from "@/lib/payment-types"

export type AdminPaymentRequestStatus =
  | "pending"
  | "paid"
  | "credited"
  | "canceled"
  | "expired"

export type AdminPaymentRequestEmailStatus =
  | "queued"
  | "sent"
  | "failed"

export type PaymentCheckoutKind =
  | "wechat_native"
  | "wechat_h5"
  | "alipay_page"
  | "alipay_wap"

export type AdminPaymentRequest = {
  id: string
  userId: string
  username: string
  email: string
  title: string
  note?: string
  priceCents: number
  credits: number
  status: AdminPaymentRequestStatus
  createdBy: string
  createdAt: number
  updatedAt: number
  expiresAt: number
  idempotencyKey: string
  selectedProvider?: Exclude<PaymentProvider, "other">
  activePaymentOrderId?: string
  settlementPaymentOrderId?: string
  checkoutKind?: PaymentCheckoutKind
  checkoutUrl?: string
  checkoutExpiresAt?: number
  payerName?: string
  paymentReference?: string
  contact?: string
  transferSubmittedAt?: number
  paidAt?: number
  creditedAt?: number
  canceledAt?: number
  canceledBy?: string
  cancelReason?: string
  emailStatus: AdminPaymentRequestEmailStatus
  emailAttempts: number
  emailUpdatedAt: number
  emailSentAt?: number
  emailError?: string
}

export type UserNotificationType =
  | "payment_request"
  | "payment_request_credited"
  | "payment_request_canceled"
  | "feedback_action_reminder"

export type UserNotification = {
  id: string
  userId: string
  type: UserNotificationType
  title: string
  body: string
  actionUrl?: string
  entityType?: "admin_payment_request" | "client_feedback_reminder"
  entityId?: string
  createdAt: number
  readAt?: number
  expiresAt?: number
  metadata?: Record<string, unknown>
}

export type UserNotificationSnapshot = {
  unreadCount: number
  notifications: UserNotification[]
}
