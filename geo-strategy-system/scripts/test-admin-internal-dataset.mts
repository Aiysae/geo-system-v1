import assert from "node:assert/strict"

const { getAdminInternalDataset, getAdminInternalUser, isAdminInternalUserId } = await import(
  "../src/lib/admin-internal-dataset"
)
const { MEMBERSHIP_LEVELS } = await import("../src/lib/membership-catalog")
const { getRechargePackage } = await import("../src/lib/pricing")

const anchor = new Date("2026-09-01T12:00:00+08:00").getTime()
const dataset = getAdminInternalDataset(anchor)

assert.equal(dataset.users.length, 50)
assert.equal(new Set(dataset.users.map(record => record.user.id)).size, 50)
assert.equal(new Set(dataset.users.map(record => record.user.email)).size, 50)
assert.equal(dataset.recharges.length, 69)
assert.equal(dataset.totals.paidCents, 3_232_240)
assert.equal(dataset.totals.purchasedCredits, 268_000)
assert.equal(dataset.totals.issuedCredits, 270_500)
assert.equal(
  dataset.totals.currentCredits,
  dataset.users.reduce((sum, record) => sum + record.credits, 0),
)

for (const record of dataset.users) {
  assert.equal(isAdminInternalUserId(record.user.id), true)
  assert.match(record.user.email, /^member\d{3}@users\.shitugeo\.test$/)
  assert.equal("passwordHash" in record.user, false)
  assert.equal("authVersion" in record.user, false)
  assert.equal(record.user.status, "active")
  assert.equal(record.user.role, "user")
  assert.ok(record.credits >= 0)
  assert.equal(getAdminInternalUser(record.user.id, anchor)?.user.id, record.user.id)

  const paidCents = record.recharges.reduce((sum, recharge) => sum + (recharge.priceCents || 0), 0)
  const expectedTier = [...MEMBERSHIP_LEVELS]
    .reverse()
    .find(level => paidCents >= level.minPaidCents)?.tier || "free"
  assert.equal(record.membership.tier, expectedTier)
  assert.equal(record.membership.paidCents, paidCents)
  assert.equal(record.membership.qualifyingOrderCount, record.recharges.length)

  for (const recharge of record.recharges) {
    const pkg = getRechargePackage(recharge.packageKey || "")
    assert.ok(pkg)
    assert.equal(recharge.status, "approved")
    assert.equal(recharge.priceCents, pkg?.priceCents)
    assert.equal(recharge.credits, pkg?.credits)
    assert.equal(recharge.userId, record.user.id)
  }

  const chronological = [...record.ledger].sort((left, right) => left.createdAt - right.createdAt)
  let balance = 0
  for (const entry of chronological) {
    balance += entry.delta
    assert.equal(entry.balanceAfter, balance)
    assert.equal(entry.userId, record.user.id)
    assert.equal(entry.source, "internal-dataset")
    assert.equal(entry.metadata?.internalDataset, true)
  }
  assert.equal(balance, record.credits)
}

assert.equal(getAdminInternalUser("not-an-internal-user", anchor), null)
console.log("Admin internal dataset tests passed.")
