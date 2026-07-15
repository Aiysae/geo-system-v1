import "server-only"

import { createHash, createHmac, randomInt } from "crypto"
import { sendAuthVerificationEmail, type AuthEmailPurpose } from "@/lib/auth-email"
import { kv } from "@/lib/kv"

export type EmailVerificationPurpose = AuthEmailPurpose

type EmailVerificationRecord = {
  version: 1
  purpose: EmailVerificationPurpose
  identityHash: string
  codeHash: string
  attempts: number
  createdAt: number
  expiresAt: number
}

type IssueOptions = {
  code?: string
  deliver?: typeof sendAuthVerificationEmail
}

const CODE_TTL_SECONDS = 5 * 60
const CODE_TTL_MINUTES = CODE_TTL_SECONDS / 60
const RESEND_COOLDOWN_SECONDS = 60
const MAX_ATTEMPTS = 5

const VERIFY_CODE_SCRIPT = `
-- email_verification_v1
local raw = redis.call("GET", KEYS[1])
if not raw then
  return {-1, 0}
end

local record = cjson.decode(raw)
local now = tonumber(ARGV[2])
local max_attempts = tonumber(ARGV[3])
if tonumber(record.expiresAt or 0) <= now then
  redis.call("DEL", KEYS[1])
  return {-1, 0}
end

local attempts = tonumber(record.attempts or 0)
if attempts >= max_attempts then
  redis.call("DEL", KEYS[1])
  return {-2, 0}
end

if tostring(record.codeHash or "") ~= tostring(ARGV[1]) then
  attempts = attempts + 1
  record.attempts = attempts
  if attempts >= max_attempts then
    redis.call("DEL", KEYS[1])
    return {-2, 0}
  end

  local ttl = redis.call("TTL", KEYS[1])
  if ttl > 0 then
    redis.call("SET", KEYS[1], cjson.encode(record), "EX", ttl)
  else
    redis.call("SET", KEYS[1], cjson.encode(record))
  end
  return {0, max_attempts - attempts}
end

redis.call("DEL", KEYS[1])
return {1, max_attempts - attempts}
`

export class EmailVerificationError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = "EmailVerificationError"
    this.status = status
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function assertValidEmail(email: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new EmailVerificationError("请输入有效邮箱")
  }
}

function verificationSecret(): string {
  const secret = String(
    process.env.AUTH_EMAIL_CODE_SECRET
      || process.env.AUTH_SECRET
      || process.env.SESSION_SECRET
      || "",
  ).trim()
  if (secret) return secret
  if (process.env.NODE_ENV !== "production") return "dev-only-email-verification-secret"
  throw new EmailVerificationError("验证码服务暂不可用，请联系管理员", 503)
}

function identityHash(email: string): string {
  return createHash("sha256").update(email).digest("base64url")
}

function codeHash(email: string, purpose: EmailVerificationPurpose, code: string): string {
  return createHmac("sha256", verificationSecret())
    .update(`${purpose}\n${email}\n${code}`)
    .digest("base64url")
}

function recordKey(email: string, purpose: EmailVerificationPurpose): string {
  return `auth:email_verification:${purpose}:${identityHash(email)}`
}

function cooldownKey(email: string, purpose: EmailVerificationPurpose): string {
  return `auth:email_verification_cooldown:${purpose}:${identityHash(email)}`
}

function createCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0")
}

export async function issueEmailVerificationCode(
  input: { email: string; purpose: EmailVerificationPurpose },
  options: IssueOptions = {},
): Promise<void> {
  const email = normalizeEmail(input.email)
  assertValidEmail(email)

  const key = recordKey(email, input.purpose)
  const cooldown = cooldownKey(email, input.purpose)
  const acquired = await kv.set(cooldown, 1, {
    nx: true,
    ex: RESEND_COOLDOWN_SECONDS,
  })
  if (!acquired) {
    throw new EmailVerificationError("验证码发送过于频繁，请 60 秒后重试", 429)
  }

  const code = options.code || createCode()
  if (!/^\d{6}$/.test(code)) {
    await kv.del(cooldown)
    throw new Error("Email verification code must contain exactly 6 digits")
  }

  const now = Date.now()
  const record: EmailVerificationRecord = {
    version: 1,
    purpose: input.purpose,
    identityHash: identityHash(email),
    codeHash: codeHash(email, input.purpose, code),
    attempts: 0,
    createdAt: now,
    expiresAt: now + CODE_TTL_SECONDS * 1000,
  }
  await kv.set(key, record, { ex: CODE_TTL_SECONDS })

  try {
    const deliver = options.deliver || sendAuthVerificationEmail
    await deliver({
      email,
      code,
      purpose: input.purpose,
      expiresInMinutes: CODE_TTL_MINUTES,
    })
  } catch (error) {
    await Promise.all([kv.del(key), kv.del(cooldown)])
    throw error
  }
}

export async function consumeEmailVerificationCode(input: {
  email: string
  purpose: EmailVerificationPurpose
  code: string
}): Promise<void> {
  const email = normalizeEmail(input.email)
  const code = input.code.trim()
  assertValidEmail(email)
  if (!/^\d{6}$/.test(code)) {
    throw new EmailVerificationError("请输入 6 位验证码")
  }

  const result = await kv.eval<[number, number], string>(
    VERIFY_CODE_SCRIPT,
    [recordKey(email, input.purpose)],
    [codeHash(email, input.purpose, code), String(Date.now()), String(MAX_ATTEMPTS)],
  )
  const status = Number(result?.[0] ?? -1)
  const attemptsLeft = Math.max(0, Number(result?.[1] ?? 0))

  if (status === 1) return
  if (status === 0) {
    throw new EmailVerificationError(`验证码不正确，还可尝试 ${attemptsLeft} 次`)
  }
  if (status === -2) {
    throw new EmailVerificationError("验证码错误次数过多，请重新获取")
  }
  throw new EmailVerificationError("验证码无效或已过期，请重新获取")
}
