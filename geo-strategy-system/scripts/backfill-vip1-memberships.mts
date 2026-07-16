const { backfillVip1Memberships } = await import("../src/lib/membership")

const apply = process.argv.includes("--apply")
const result = await backfillVip1Memberships(apply)

console.log(JSON.stringify(result, null, 2))
if (!apply && result.qualifyingUsers > result.alreadyVip1) {
  console.log("预览完成：加上 --apply 后才会正式补发 VIP1。")
}
