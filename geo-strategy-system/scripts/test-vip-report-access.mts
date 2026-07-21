import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const testFile = path.join(os.tmpdir(), `geo-vip-report-access-${process.pid}.json`)
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = testFile
process.env.PAYMENT_STORE = "kv"
process.env.CREDITS_INITIAL = "50"

const {
  adjustCreditsByAdmin,
  getCredits,
  refundCreditsOnce,
  reserveCreditsBy,
} = await import("../src/lib/credits")
const { listCreditLedgerForUser } = await import("../src/lib/credit-ledger")
const {
  createPaymentOrder,
  creditPaymentOrder,
} = await import("../src/lib/payment-orders")
const {
  getPaymentOrderRecord,
  savePaymentOrderRecord,
} = await import("../src/lib/payment-store")
const {
  backfillVip1Memberships,
  getMembership,
  membershipClientAccountLimit,
  membershipTierForPaidCents,
  recalculateMembershipForUser,
} = await import("../src/lib/membership")
const { getFeaturePrice } = await import("../src/lib/pricing")

try {
  assert.equal(getFeaturePrice("reportCustomBranding").credits, 9)
  assert.equal(membershipTierForPaidCents(0), "free")
  assert.equal(membershipTierForPaidCents(1), "vip1")
  assert.equal(membershipTierForPaidCents(9_999), "vip1")
  assert.equal(membershipTierForPaidCents(10_000), "vip2")
  assert.equal(membershipTierForPaidCents(60_000), "vip3")
  assert.equal(membershipTierForPaidCents(150_000), "vip4")
  assert.equal(membershipTierForPaidCents(300_000), "vip5")
  assert.equal(membershipTierForPaidCents(1_000_000), "vip6")
  assert.equal(membershipClientAccountLimit("vip2"), 1)
  assert.equal(membershipClientAccountLimit("vip6"), 100)

  const cumulativeUserId = "vip-cumulative-user"
  const cumulativeFirst = await createPaymentOrder({
    userId: cumulativeUserId,
    username: "累计充值用户",
    email: "vip-cumulative@example.com",
    packageName: "累计充值 A",
    priceCents: 4_000,
    credits: 200,
    provider: "alipay",
  })
  await creditPaymentOrder({
    orderId: cumulativeFirst.id,
    providerTradeId: "vip-cumulative-a",
    paidCents: 4_000,
    source: "payment_callback",
  })
  const cumulativeSecond = await createPaymentOrder({
    userId: cumulativeUserId,
    username: "累计充值用户",
    email: "vip-cumulative@example.com",
    packageName: "累计充值 B",
    priceCents: 6_000,
    credits: 300,
    provider: "wechat",
  })
  await creditPaymentOrder({
    orderId: cumulativeSecond.id,
    providerTradeId: "vip-cumulative-b",
    paidCents: 6_000,
    source: "payment_callback",
  })
  const cumulativeMembership = await getMembership(cumulativeUserId)
  assert.equal(cumulativeMembership.tier, "vip2")
  assert.equal(cumulativeMembership.paidCents, 10_000)
  assert.equal(cumulativeMembership.qualifyingOrderCount, 2)
  assert.equal(cumulativeMembership.clientAccountLimit, 1)

  const cumulativeSecondStored = await getPaymentOrderRecord(cumulativeSecond.id)
  if (!cumulativeSecondStored) throw new Error("cumulative payment order missing")
  await savePaymentOrderRecord({
    ...cumulativeSecondStored,
    status: "refunded",
    refundedAt: Date.now(),
    updatedAt: Date.now(),
  })
  const downgraded = await recalculateMembershipForUser(cumulativeUserId)
  assert.equal(downgraded.tier, "vip1")
  assert.equal(downgraded.paidCents, 4_000, "refunded orders must not count toward VIP level")

  const paidUserId = "vip-paid-user"
  const pendingOrder = await createPaymentOrder({
    userId: paidUserId,
    username: "VIP 支付用户",
    email: "vip-paid@example.com",
    packageKey: "trial_990",
    packageName: "首购体验包",
    priceCents: 990,
    credits: 100,
    provider: "wechat",
  })
  assert.equal((await getMembership(paidUserId)).active, false)

  await creditPaymentOrder({
    orderId: pendingOrder.id,
    providerTradeId: "vip-wechat-trade",
    paidCents: 990,
    source: "payment_callback",
  })
  const paidMembership = await getMembership(paidUserId)
  assert.equal(paidMembership.tier, "vip1")
  assert.equal(paidMembership.sourceOrderId, pendingOrder.id)

  const adminCreditUserId = "vip-admin-credit-user"
  await adjustCreditsByAdmin({
    operationId: "vip_admin_credit_operation_001",
    userId: adminCreditUserId,
    delta: 500,
    operatorUserId: "test-admin",
  })
  assert.equal(
    (await getMembership(adminCreditUserId)).active,
    false,
    "admin-granted credits must not unlock VIP1",
  )

  const historicalUserId = "vip-historical-user"
  const historicalOrder = await createPaymentOrder({
    userId: historicalUserId,
    username: "历史到账用户",
    email: "vip-history@example.com",
    packageName: "历史积分包",
    priceCents: 9900,
    credits: 1500,
    provider: "alipay",
  })
  const creditedAt = Date.now()
  await savePaymentOrderRecord({
    ...historicalOrder,
    status: "credited",
    paidCents: historicalOrder.priceCents,
    paidAt: creditedAt,
    creditedAt,
    updatedAt: creditedAt,
  })

  const preview = await backfillVip1Memberships(false)
  assert.equal(preview.apply, false)
  assert.ok(preview.qualifyingUsers >= 2)
  assert.equal((await getMembership(historicalUserId)).active, false, "dry-run must not mutate membership")

  const applied = await backfillVip1Memberships(true)
  assert.ok(applied.grantedVip1 >= 1)
  assert.equal((await getMembership(historicalUserId)).tier, "vip1")

  const reportUserId = "vip-report-refund-user"
  const reserved = await reserveCreditsBy(reportUserId, 9, {
    featureKey: "reportCustomBranding",
    source: "test:commercial-report",
    sourceId: "rjob_refund_contract",
    description: "专业报告 · 白标交付版",
  })
  assert.equal(reserved.ok, true)
  assert.equal(await getCredits(reportUserId), 41)

  const refunds = await Promise.all(
    Array.from({ length: 12 }, () => refundCreditsOnce({
      operationId: "rrefund_report_contract_001",
      userId: reportUserId,
      credits: 9,
      context: {
        featureKey: "reportCustomBranding",
        source: "test:commercial-report",
        sourceId: "rjob_refund_contract",
        description: "专业报告 · 白标交付版 · 失败退回",
      },
    })),
  )
  assert.equal(refunds.filter(result => !result.alreadySettled).length, 1)
  assert.equal(await getCredits(reportUserId), 50, "retries must refund the report charge exactly once")

  const refundLedgers = (await listCreditLedgerForUser(reportUserId, 50))
    .filter(entry => entry.id === "ledger_refund_rrefund_report_contract_001")
  assert.equal(refundLedgers.length, 1)
  assert.equal(refundLedgers[0]?.delta, 9)

  console.log("VIP1 membership and white-label report billing contract passed")
} finally {
  await fs.rm(testFile, { force: true })
}
