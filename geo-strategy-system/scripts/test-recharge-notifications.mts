import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const testFile = path.join(
  os.tmpdir(),
  `geo-recharge-notifications-${process.pid}.json`,
)
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = testFile
process.env.PAYMENT_STORE = "kv"
process.env.ADMIN_NOTIFICATION_EMAILS = [
  "Owner@Example.com",
  "owner@example.com",
  "finance@example.com",
].join(",")

const { createRequest } = await import("../src/lib/recharge")
const {
  getAdminRechargeNotificationSnapshot,
  markRechargeNotificationsSeen,
} = await import("../src/lib/recharge-notifications")
const { getAdminNotificationEmails } = await import(
  "../src/lib/recharge-notification-email"
)

try {
  const request = await createRequest({
    userId: "notification-user",
    username: "充值提醒测试用户",
    email: "notification-user@example.com",
    packageKey: "light_66",
    paymentMethod: "manual_transfer",
  })
  const initial = await getAdminRechargeNotificationSnapshot("admin-a")
  assert.equal(initial.pendingCount, 1)
  assert.equal(initial.unread[0]?.id, request.id)

  await markRechargeNotificationsSeen("admin-a", [
    request.id,
    request.id,
    "invalid",
  ])
  const seen = await getAdminRechargeNotificationSnapshot("admin-a")
  assert.equal(
    seen.pendingCount,
    1,
    "reading a notification must not approve the recharge",
  )
  assert.equal(seen.unread.length, 0)

  const otherAdmin = await getAdminRechargeNotificationSnapshot("admin-b")
  assert.equal(
    otherAdmin.unread.length,
    1,
    "notification read state must be per admin",
  )
  assert.deepEqual(getAdminNotificationEmails(), [
    "owner@example.com",
    "finance@example.com",
  ])
  console.log("Recharge notification tests passed.")
} finally {
  await fs.rm(testFile, { force: true })
}
