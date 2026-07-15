import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-email-verification-"))
process.env.KV_BACKEND = "file"
process.env.LOCAL_KV_FILE = path.join(tempDir, "kv.json")
process.env.AUTH_SECRET = "test-auth-secret-with-enough-entropy"

const {
  consumeEmailVerificationCode,
  issueEmailVerificationCode,
} = await import("../src/lib/email-verification")
const {
  authenticateUser,
  authenticateUserWithEmailCode,
  createUser,
  resetPasswordWithEmailCode,
} = await import("../src/lib/auth")

const deliveries: Array<{ email: string; code: string; purpose: string }> = []
const deliver = async (input: {
  email: string
  code: string
  purpose: "sign-up" | "sign-in" | "password-reset"
  expiresInMinutes: number
}) => {
  deliveries.push({ email: input.email, code: input.code, purpose: input.purpose })
}

try {
  const email = "verification-test@example.com"
  await issueEmailVerificationCode(
    { email, purpose: "sign-up" },
    { code: "123456", deliver },
  )
  await assert.rejects(
    consumeEmailVerificationCode({ email, purpose: "sign-up", code: "000000" }),
    /还可尝试 4 次/,
  )
  await consumeEmailVerificationCode({ email, purpose: "sign-up", code: "123456" })
  await assert.rejects(
    consumeEmailVerificationCode({ email, purpose: "sign-up", code: "123456" }),
    /无效或已过期/,
  )

  const now = new Date().toISOString()
  const user = await createUser({
    email,
    name: "验证码测试用户",
    password: "OldPassword123",
    termsAcceptedAt: now,
    emailVerifiedAt: now,
  })
  assert.equal(user.email, email)

  await issueEmailVerificationCode(
    { email, purpose: "sign-in" },
    { code: "234567", deliver },
  )
  const codeLoginUser = await authenticateUserWithEmailCode(email, "234567")
  assert.equal(codeLoginUser.id, user.id)

  await issueEmailVerificationCode(
    { email, purpose: "password-reset" },
    { code: "345678", deliver },
  )
  await resetPasswordWithEmailCode({
    email,
    code: "345678",
    newPassword: "NewPassword456",
  })
  await assert.rejects(authenticateUser(email, "OldPassword123"), /邮箱或密码不正确/)
  const passwordLoginUser = await authenticateUser(email, "NewPassword456")
  assert.equal(passwordLoginUser.id, user.id)

  const lockedEmail = "locked-code@example.com"
  await issueEmailVerificationCode(
    { email: lockedEmail, purpose: "sign-up" },
    { code: "456789", deliver },
  )
  for (let attempt = 1; attempt <= 4; attempt++) {
    await assert.rejects(
      consumeEmailVerificationCode({
        email: lockedEmail,
        purpose: "sign-up",
        code: "000000",
      }),
      /验证码不正确/,
    )
  }
  await assert.rejects(
    consumeEmailVerificationCode({
      email: lockedEmail,
      purpose: "sign-up",
      code: "000000",
    }),
    /错误次数过多/,
  )
  await assert.rejects(
    consumeEmailVerificationCode({
      email: lockedEmail,
      purpose: "sign-up",
      code: "456789",
    }),
    /无效或已过期/,
  )

  const failedDeliveryEmail = "failed-delivery@example.com"
  await assert.rejects(
    issueEmailVerificationCode(
      { email: failedDeliveryEmail, purpose: "sign-up" },
      {
        code: "567890",
        deliver: async () => {
          throw new Error("simulated delivery failure")
        },
      },
    ),
    /simulated delivery failure/,
  )
  await assert.rejects(
    consumeEmailVerificationCode({
      email: failedDeliveryEmail,
      purpose: "sign-up",
      code: "567890",
    }),
    /无效或已过期/,
  )
  await issueEmailVerificationCode(
    { email: failedDeliveryEmail, purpose: "sign-up" },
    { code: "678901", deliver },
  )
  await consumeEmailVerificationCode({
    email: failedDeliveryEmail,
    purpose: "sign-up",
    code: "678901",
  })

  assert.deepEqual(
    deliveries.map(item => item.purpose),
    ["sign-up", "sign-in", "password-reset", "sign-up", "sign-up"],
  )
  console.log("Email verification tests passed.")
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true })
}
