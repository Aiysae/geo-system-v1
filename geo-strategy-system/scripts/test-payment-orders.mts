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
