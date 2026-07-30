import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { getAdminPaymentRequestForUser } from "@/lib/admin-payment-requests"
import { getPaymentOrder } from "@/lib/payment-orders"
import { publicPaymentOptions } from "@/lib/payment-config"
import { RECHARGE_PAYMENT_INFO } from "@/lib/recharge-payment"
import { PaymentRequestCheckout } from "@/components/payments/payment-request-checkout"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "付款订单 · 势途 GEO",
  description: "查看并支付势途 GEO 专属积分订单",
}

export default async function PaymentRequestPage({
  params,
}: {
  params: Promise<{ requestId: string }>
}) {
  const { requestId } = await params
  const user = await getCurrentUser()
  if (!user) {
    redirect(`/sign-in?redirect_url=${encodeURIComponent(`/account/payment-requests/${requestId}`)}`)
  }
  const paymentRequest = await getAdminPaymentRequestForUser(requestId, user.id)
  if (!paymentRequest) notFound()
  const [paymentOptions, activeOrder] = await Promise.all([
    Promise.resolve(publicPaymentOptions()),
    paymentRequest.activePaymentOrderId
      ? getPaymentOrder(paymentRequest.activePaymentOrderId)
      : Promise.resolve(null),
  ])

  return (
    <PaymentRequestCheckout
      initialRequest={paymentRequest}
      initialOrder={activeOrder ? {
        id: activeOrder.id,
        provider: activeOrder.provider,
        status: activeOrder.status,
        creditedAt: activeOrder.creditedAt,
      } : null}
      paymentOptions={paymentOptions}
      bankInfo={{
        accountName: RECHARGE_PAYMENT_INFO.accountName,
        creditCode: RECHARGE_PAYMENT_INFO.creditCode,
        accountNo: RECHARGE_PAYMENT_INFO.accountNo,
        bankName: RECHARGE_PAYMENT_INFO.bankName,
        bankCode: RECHARGE_PAYMENT_INFO.bankCode,
        serviceWechatId: RECHARGE_PAYMENT_INFO.serviceWechatId,
      }}
    />
  )
}
