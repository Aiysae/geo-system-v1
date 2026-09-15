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
const { approveRequest, createRequest } = await import("../src/lib/recharge")
const { getMembership } = await import("../src/lib/membership")
const { listCreditLedgerForUser } = await import("../src/lib/credit-ledger")
const { centsFromYuan, yuanFromCents } = await import("../src/lib/alipay-payment")
const {
  getFirstPurchaseBlockReason,
  hasBlockingFirstPurchaseOrder,
  ONLINE_PAYMENT_ORDER_TTL_MS,
  paymentOrderBlocksFirstPurchase,
} = await import("../src/lib/payment-lifecycle")
const { mergeBillingRechargeRecords } = await import("../src/lib/billing-records")
const {
  getRechargePackage,
  rechargeSavingsPercent,
  rechargeUnitPrice,
  RECHARGE_PACKAGES,
} = await import("../src/lib/pricing")
const { PAYMENT_SCHEMA_SQL } = await import("../src/lib/payment-schema")

try {
  assert.match(
    PAYMENT_SCHEMA_SQL,
    /product_type TEXT NOT NULL DEFAULT 'credits'/,
    "payment schema must use a PostgreSQL string literal for the product type default",
  )
  assert.equal(yuanFromCents(990), "9.90")
  assert.equal(centsFromYuan("9.9"), 990)
  assert.equal(centsFromYuan("9.90"), 990)
  assert.equal(centsFromYuan("9.901"), null)
  assert.deepEqual(
    RECHARGE_PACKAGES.map(({ key, priceCents, credits }) => ({ key, priceCents, credits })),
    [
      { key: "trial_990", priceCents: 990, credits: 40 },
      { key: "standard_128", priceCents: 12_800, credits: 580 },
      { key: "team_598", priceCents: 59_800, credits: 2_800 },
      { key: "enterprise_1298", priceCents: 129_800, credits: 6_300 },
      { key: "full_cycle_3666", priceCents: 366_600, credits: 18_000 },
    ],
  )
  assert.equal(getRechargePackage("light_66"), null, "retired packages must not be sold again")
  assert.equal(getRechargePackage("growth_298"), null, "retired packages must not be sold again")
  assert.equal(getRechargePackage("light_49"), null, "legacy packages must not be sold again")
  assert.equal(rechargeSavingsPercent(RECHARGE_PACKAGES[0]), 0)
  for (let index = 1; index < RECHARGE_PACKAGES.length; index += 1) {
    assert.ok(
      rechargeUnitPrice(RECHARGE_PACKAGES[index]) < rechargeUnitPrice(RECHARGE_PACKAGES[index - 1]),
      "package unit prices must decrease as package value increases",
    )
  }
  for (const packageItem of RECHARGE_PACKAGES.slice(1)) {
    assert.ok(
      rechargeUnitPrice(packageItem) * 9 <= 2,
      "a white-label report must cost no more than two yuan on regular packages",
    )
  }

  for (const pkg of RECHARGE_PACKAGES) {
    assert.ok(
      rechargeUnitPrice(pkg) >= 0.20,
      "every package must retain the agreed minimum revenue of 0.20 yuan per credit",
    )
    for (const provider of ["wechat", "alipay", "manual_transfer"] as const) {
      const packageUserId = `new-package-${pkg.key}-${provider}`
      const request = provider === "manual_transfer"
        ? await createRequest({
          userId: packageUserId,
          username: "新套餐测试用户",
          email: "new-package@example.com",
          packageKey: pkg.key,
          paymentMethod: provider,
        })
        : null
      const packageOrder = request
        ? await getPaymentOrder(request.paymentOrderId!)
        : await createPaymentOrder({
          userId: packageUserId,
          username: "新套餐测试用户",
          email: "new-package@example.com",
          packageKey: pkg.key,
          packageName: pkg.name,
          priceCents: pkg.priceCents,
          credits: pkg.credits,
          provider,
        })
      assert.ok(packageOrder)
      assert.equal(packageOrder.priceCents, pkg.priceCents)
      assert.equal(packageOrder.credits, pkg.credits)
      assert.equal(await getCredits(packageUserId), 50, "creating an order must not credit")
      if (request) {
        assert.equal(request.credits, pkg.credits)
        assert.equal(request.amount, pkg.credits)
        assert.equal((await approveRequest(request.id, "test-admin")).ok, true)
      } else {
        assert.equal((await creditPaymentOrder({
          orderId: packageOrder.id,
          providerTradeId: `trade-${packageOrder.id}`,
          paidCents: pkg.priceCents,
          source: "payment_callback",
        })).ok, true)
      }
      assert.equal(await getCredits(packageUserId), 50 + pkg.credits)
      assert.equal((await getPaymentOrder(packageOrder.id))?.status, "credited")
    }
  }

  // Orders created before this price change keep their original credit snapshot.
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
  assert.equal((await getMembership(userId)).active, false, "an unpaid order must not grant VIP1")

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
  assert.equal(
    getFirstPurchaseBlockReason([
      { ...order, packageKey: "light_66", status: "pending" },
    ], "trial_990", beforeExpiry),
    null,
    "an unpaid regular package must not consume the first-purchase offer",
  )
  assert.equal(
    getFirstPurchaseBlockReason([
      { ...order, packageKey: "light_66", status: "credited" },
    ], "trial_990", beforeExpiry),
    "completed_purchase",
    "any credited package must consume the first-purchase offer",
  )
  assert.equal(
    getFirstPurchaseBlockReason([
      { ...order, packageKey: "light_66", status: "refunded" },
    ], "trial_990", beforeExpiry),
    "completed_purchase",
    "a refunded completed purchase must not restore the introductory offer",
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
  assert.equal(await getCredits(userId), 150, "concurrent callbacks must credit the original 100 credits exactly once")
  assert.equal((await getPaymentOrder(order.id))?.status, "credited")
  assert.equal((await getMembership(userId)).tier, "vip1", "a credited payment must grant VIP1")

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
  assert.equal((await getMembership(mismatchUserId)).active, false, "a failed payment must not grant VIP1")

  console.log("Payment order settlement contract passed")
} finally {
  await fs.rm(testFile, { force: true })
}
