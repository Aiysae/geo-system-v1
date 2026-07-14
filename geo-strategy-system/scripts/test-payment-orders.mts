import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const testFile = path.join(os.tmpdir(), `geo-payment-orders-${process.pid}.json`)
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = testFile
process.env.PAYMENT_STORE = "kv"
process.env.CREDITS_INITIAL = "50"

const {
  createPaymentOrder,
  creditPaymentOrder,
  getPaymentOrder,
} = await import("../src/lib/payment-orders")
const { getCredits } = await import("../src/lib/credits")
const { listCreditLedgerForUser } = await import("../src/lib/credit-ledger")
const { centsFromYuan, yuanFromCents } = await import("../src/lib/alipay-payment")
const {
  hasBlockingFirstPurchaseOrder,
  ONLINE_PAYMENT_ORDER_TTL_MS,
  paymentOrderBlocksFirstPurchase,
} = await import("../src/lib/payment-lifecycle")
const { mergeBillingRechargeRecords } = await import("../src/lib/billing-records")

try {
  assert.equal(yuanFromCents(990), "9.90")
  assert.equal(centsFromYuan("9.9"), 990)
  assert.equal(centsFromYuan("9.90"), 990)
  assert.equal(centsFromYuan("9.901"), null)

  const userId = "payment-test-user"
  const order = await createPaymentOrder({
    userId,
    username: "支付测试用户",
    email: "payment-test@example.com",
    packageKey: "trial_990",
    packageName: "测试积分包",
    priceCents: 990,
    credits: 100,
    provider: "alipay",
  })

  const beforeExpiry = order.createdAt + ONLINE_PAYMENT_ORDER_TTL_MS - 1
  const atExpiry = order.createdAt + ONLINE_PAYMENT_ORDER_TTL_MS
  assert.equal(
    hasBlockingFirstPurchaseOrder([order], "trial_990", beforeExpiry),
    true,
    "an active online checkout must reserve the first-purchase package",
  )
  assert.equal(
    hasBlockingFirstPurchaseOrder([order], "trial_990", atExpiry),
    false,
    "an expired unpaid online checkout must release the first-purchase package",
  )
  assert.equal(
    paymentOrderBlocksFirstPurchase(
      { ...order, provider: "manual_transfer" },
      "trial_990",
      atExpiry,
    ),
    true,
    "manual transfer requests keep their existing first-purchase reservation",
  )
  assert.equal(
    paymentOrderBlocksFirstPurchase(
      { ...order, status: "paid" },
      "trial_990",
      atExpiry,
    ),
    true,
    "a paid order must keep the first-purchase package reserved",
  )
  assert.equal(
    paymentOrderBlocksFirstPurchase(
      { ...order, status: "failed" },
      "trial_990",
      beforeExpiry,
    ),
    false,
    "a failed order must release the first-purchase package",
  )

  const results = await Promise.all(
    Array.from({ length: 12 }, () => creditPaymentOrder({
      orderId: order.id,
      providerTradeId: "alipay-test-trade-1",
      paidCents: 990,
      source: "payment_callback",
    })),
  )
  assert.equal(results.filter(result => result.ok && result.credited).length, 1)
  assert.equal(await getCredits(userId), 150, "concurrent callbacks must credit exactly once")
  assert.equal((await getPaymentOrder(order.id))?.status, "credited")

  const creditedOrder = await getPaymentOrder(order.id)
  assert.ok(creditedOrder)
  const officialBillingRecords = mergeBillingRechargeRecords([], [creditedOrder])
  assert.equal(officialBillingRecords.length, 1)
  assert.equal(officialBillingRecords[0]?.status, "credited")
  assert.equal(officialBillingRecords[0]?.credits, 100)

  const linkedRequest = {
    id: "request-linked-to-payment",
    userId,
    username: "支付测试用户",
    email: "payment-test@example.com",
    packageKey: "trial_990" as const,
    packageName: "测试积分包",
    priceCents: 990,
    credits: 100,
    amount: 100,
    paymentOrderId: creditedOrder.id,
    paymentOutTradeNo: creditedOrder.outTradeNo,
    paymentMethod: "wechat" as const,
    status: "approved" as const,
    createdAt: creditedOrder.createdAt,
    processedAt: creditedOrder.creditedAt,
  }
  const deduplicatedBillingRecords = mergeBillingRechargeRecords(
    [linkedRequest],
    [creditedOrder],
  )
  assert.equal(deduplicatedBillingRecords.length, 1)
  assert.equal(deduplicatedBillingRecords[0]?.id, linkedRequest.id)

  const paymentLedgers = (await listCreditLedgerForUser(userId, 100))
    .filter(entry => entry.id === `ledger_payment_${order.id}`)
  assert.equal(paymentLedgers.length, 1, "payment ledger must be idempotent")
  assert.equal(paymentLedgers[0]?.delta, 100)

  const mismatchUserId = "payment-mismatch-user"
  const mismatch = await createPaymentOrder({
    userId: mismatchUserId,
    username: "金额校验用户",
    email: "mismatch@example.com",
    packageName: "金额校验包",
    priceCents: 1990,
    credits: 300,
    provider: "wechat",
  })
  const mismatchResult = await creditPaymentOrder({
    orderId: mismatch.id,
    providerTradeId: "wechat-test-trade-1",
    paidCents: 1,
    source: "payment_callback",
  })
  assert.equal(mismatchResult.ok, false)
  assert.equal(await getCredits(mismatchUserId), 50, "wrong amount must not credit")
  assert.equal((await getPaymentOrder(mismatch.id))?.status, "failed")

  console.log("Payment order settlement contract passed")
} finally {
  await fs.rm(testFile, { force: true })
}
