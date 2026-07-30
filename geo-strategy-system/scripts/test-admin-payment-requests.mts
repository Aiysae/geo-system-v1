import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const testFile = path.join(os.tmpdir(), `geo-admin-payment-requests-${process.pid}.json`)
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = testFile
process.env.PAYMENT_STORE = "kv"
process.env.CREDITS_INITIAL = "50"

const { createUser } = await import("../src/lib/auth")
const {
  cancelAdminPaymentRequest,
  createAdminPaymentRequest,
  getAdminPaymentRequest,
  prepareAdminPaymentRequestOrder,
  submitAdminPaymentBankTransfer,
} = await import("../src/lib/admin-payment-requests")
const {
  getUserNotificationSnapshot,
  markNotificationsRead,
} = await import("../src/lib/user-notifications")
const { creditPaymentOrder } = await import("../src/lib/payment-orders")
const { getCredits } = await import("../src/lib/credits")
const { getMembership } = await import("../src/lib/membership")
const { approveRequest } = await import("../src/lib/recharge")
const { mergeBillingRechargeRecords } = await import("../src/lib/billing-records")
const { PAYMENT_SCHEMA_SQL } = await import("../src/lib/payment-schema")

try {
  assert.match(PAYMENT_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS geo_admin_payment_requests/)
  assert.match(PAYMENT_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS geo_user_notifications/)
  assert.match(PAYMENT_SCHEMA_SQL, /admin_payment_request_id TEXT/)

  const user = await createUser({
    email: "custom-order@example.com",
    password: "Payment1234",
    name: "自定义订单用户",
  })
  const input = {
    targetAccount: user.email,
    title: "专属 1000 积分订单",
    note: "测试订单",
    priceCents: 19900,
    credits: 1000,
    expiryDays: 7,
    createdBy: "admin-test",
    idempotencyKey: "adminpay_test_idempotency_001",
  }
  await assert.rejects(
    () => createAdminPaymentRequest({
      ...input,
      priceCents: Number.NaN,
      idempotencyKey: "adminpay_test_invalid_amount",
    }),
    /订单金额/,
  )
  await assert.rejects(
    () => createAdminPaymentRequest({
      ...input,
      credits: Number.NaN,
      idempotencyKey: "adminpay_test_invalid_credits",
    }),
    /订单积分/,
  )
  await assert.rejects(
    () => createAdminPaymentRequest({
      ...input,
      expiryDays: Number.NaN,
      idempotencyKey: "adminpay_test_invalid_expiry",
    }),
    /有效期/,
  )
  const request = await createAdminPaymentRequest(input)
  const duplicate = await createAdminPaymentRequest(input)
  assert.equal(duplicate.id, request.id, "the same idempotency key must return the same request")

  const initialNotifications = await getUserNotificationSnapshot(user.id)
  assert.equal(initialNotifications.unreadCount, 1)
  assert.equal(initialNotifications.notifications[0]?.entityId, request.id)
  await markNotificationsRead(user.id, [initialNotifications.notifications[0]!.id])
  assert.equal((await getUserNotificationSnapshot(user.id)).unreadCount, 0)

  const checkout = await prepareAdminPaymentRequestOrder({
    requestId: request.id,
    userId: user.id,
    provider: "alipay",
  })
  assert.equal(checkout.order.origin, "admin_request")
  assert.equal(checkout.order.adminPaymentRequestId, request.id)
  await assert.rejects(
    () => prepareAdminPaymentRequestOrder({
      requestId: request.id,
      userId: user.id,
      provider: "wechat",
    }),
    /付款方式已确认/,
  )

  const results = await Promise.all(Array.from({ length: 8 }, () => creditPaymentOrder({
    orderId: checkout.order.id,
    providerTradeId: "custom-alipay-trade",
    paidCents: request.priceCents,
    source: "payment_callback",
  })))
  assert.equal(results.filter(result => result.ok && result.credited).length, 1)
  assert.equal(await getCredits(user.id), 1050)
  assert.equal((await getMembership(user.id)).tier, "vip2")
  assert.equal((await getAdminPaymentRequest(request.id))?.status, "credited")
  assert.equal((await getUserNotificationSnapshot(user.id)).unreadCount, 1)

  const billing = mergeBillingRechargeRecords([], [checkout.order], 80, [
    (await getAdminPaymentRequest(request.id))!,
  ])
  assert.equal(billing.length, 1)
  assert.equal(billing[0]?.actionUrl, `/account/payment-requests/${request.id}`)
  assert.equal(billing[0]?.status, "credited")

  const canceled = await createAdminPaymentRequest({
    ...input,
    title: "待取消订单",
    idempotencyKey: "adminpay_test_idempotency_002",
  })
  const canceledOrder = await prepareAdminPaymentRequestOrder({
    requestId: canceled.id,
    userId: user.id,
    provider: "wechat",
  })
  await cancelAdminPaymentRequest({
    requestId: canceled.id,
    adminUserId: "admin-test",
  })
  const canceledSettlement = await creditPaymentOrder({
    orderId: canceledOrder.order.id,
    providerTradeId: "late-wechat-trade",
    paidCents: canceled.priceCents,
    source: "payment_callback",
  })
  assert.equal(canceledSettlement.ok, false, "a canceled request must never grant credits")
  assert.equal(await getCredits(user.id), 1050)

  const bankRequest = await createAdminPaymentRequest({
    ...input,
    title: "银行转账订单",
    credits: 200,
    priceCents: 6600,
    idempotencyKey: "adminpay_test_idempotency_003",
  })
  const bankSubmission = await submitAdminPaymentBankTransfer({
    requestId: bankRequest.id,
    userId: user.id,
    payerName: "测试企业",
    paymentReference: "BANK-20260730-001",
    contact: "13800000000",
  })
  assert.ok(bankSubmission.request.transferSubmittedAt)
  const approval = await approveRequest(`req_payreq_${bankRequest.id}`, "admin-test")
  assert.equal(approval.ok, true)
  assert.equal(await getCredits(user.id), 1250)
  assert.equal((await getAdminPaymentRequest(bankRequest.id))?.status, "credited")

  console.log("Admin payment request contract passed")
} finally {
  await fs.rm(testFile, { force: true })
}
