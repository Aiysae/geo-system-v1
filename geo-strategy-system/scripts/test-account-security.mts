import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { AuthEmailPurpose } from "../src/lib/auth-email"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-account-security-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(tempDir, "kv.json")
process.env.AUTH_SECRET = "test-account-security-secret-with-enough-entropy"
process.env.ADMIN_EMAILS = "admin@example.com"

const {
  authenticateUser,
  changeUserEmail,
  changeUserPassword,
  createUser,
  updateUserProfileName,
  validateAccountEmailChangeTarget,
} = await import("../src/lib/auth")
const { issueEmailVerificationCode } = await import("../src/lib/email-verification")

const deliveries: Array<{ email: string; code: string; purpose: AuthEmailPurpose }> = []
const deliver = async (input: {
  email: string
  code: string
  purpose: AuthEmailPurpose
  expiresInMinutes: number
}) => {
  deliveries.push({ email: input.email, code: input.code, purpose: input.purpose })
}

try {
  const user = await createUser({
    email: "owner@example.com",
    password: "OwnerPassword123",
    name: "旧名称",
  })
  const renamed = await updateUserProfileName(user.id, "新账号名称")
  assert.equal(renamed.name, "新账号名称")
  await assert.rejects(updateUserProfileName(user.id, "A"), /至少需要 2 个字符/)
  await assert.rejects(
    validateAccountEmailChangeTarget(user.id, "owner@example.com"),
    /不能与当前邮箱相同/,
  )
  await assert.rejects(
    validateAccountEmailChangeTarget(user.id, "admin@example.com"),
    /不能用于普通账号/,
  )

  const newEmail = "owner-new@example.com"
  await issueEmailVerificationCode(
    { email: newEmail, purpose: "email-change" },
    { code: "135790", deliver },
  )
  await assert.rejects(
    changeUserEmail({
      userId: user.id,
      currentPassword: "WrongPassword123",
      newEmail,
      verificationCode: "135790",
    }),
    /当前密码不正确/,
  )
  const changed = await changeUserEmail({
    userId: user.id,
    currentPassword: "OwnerPassword123",
    newEmail,
    verificationCode: "135790",
  })
  assert.equal(changed.email, newEmail)
  await assert.rejects(authenticateUser("owner@example.com", "OwnerPassword123"), /邮箱或密码不正确/)
  assert.equal((await authenticateUser(newEmail, "OwnerPassword123")).id, user.id)

  await assert.rejects(
    changeUserPassword({
      userId: user.id,
      currentPassword: "OwnerPassword123",
      newPassword: "OwnerPassword123",
    }),
    /不能与当前密码相同/,
  )
  await changeUserPassword({
    userId: user.id,
    currentPassword: "OwnerPassword123",
    newPassword: "ChangedPassword456",
  })
  await assert.rejects(authenticateUser(newEmail, "OwnerPassword123"), /邮箱或密码不正确/)
  assert.equal((await authenticateUser(newEmail, "ChangedPassword456")).id, user.id)

  const admin = await createUser({
    email: "admin@example.com",
    password: "AdminPassword123",
    name: "管理员",
  })
  await assert.rejects(
    validateAccountEmailChangeTarget(admin.id, "admin-new@example.com"),
    /管理员登录邮箱请在服务端配置中变更/,
  )
  assert.deepEqual(deliveries.map(item => item.purpose), ["email-change"])
  console.log("Account security tests passed.")
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true })
}
