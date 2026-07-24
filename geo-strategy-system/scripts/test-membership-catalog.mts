import assert from "node:assert/strict"

const { MEMBERSHIP_LEVELS, membershipLevelForTier, membershipTierLabel } = await import(
  "../src/lib/membership-catalog"
)
const { membershipClientAccountLimit, membershipTierForPaidCents } = await import(
  "../src/lib/membership"
)

assert.deepEqual(
  MEMBERSHIP_LEVELS.map(level => level.minPaidCents),
  [1, 10_000, 60_000, 150_000, 300_000, 1_000_000],
)
assert.deepEqual(
  MEMBERSHIP_LEVELS.map(level => level.clientAccountLimit),
  [0, 1, 3, 10, 30, 100],
)
assert.equal(membershipTierForPaidCents(0), "free")
assert.equal(membershipTierForPaidCents(1), "vip1")
assert.equal(membershipTierForPaidCents(9_999), "vip1")
assert.equal(membershipTierForPaidCents(10_000), "vip2")
assert.equal(membershipTierForPaidCents(1_000_000), "vip6")
assert.equal(membershipClientAccountLimit("vip4"), 10)
assert.equal(membershipLevelForTier("vip2")?.benefits.some(item => item.includes("1 个客户专属账号")), true)
assert.equal(membershipTierLabel("free"), "普通用户")
assert.equal(membershipTierLabel("vip6"), "VIP6")

console.log("Membership catalog tests passed.")
