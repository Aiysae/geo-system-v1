import "server-only"

import { kv } from "@/lib/kv"
import { consumeEmailVerificationCode } from "@/lib/email-verification"
import { cookies } from "next/headers"
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "crypto"
import { promisify } from "util"
import { AUTH_COOKIE_NAME, createSessionCookieValue, verifySessionCookieValue } from "./session-cookie"

const scrypt = promisify(scryptCallback)

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
const PASSWORD_KEY_LENGTH = 64

const KEY_USER = (id: string) => `auth:users:${id}`
const KEY_EMAIL = (email: string) => `auth:emails:${email}`
const KEY_SESSION = (id: string) => `auth:sessions:${id}`
const KEY_USER_SET = "auth:users"
const KEY_MANAGED_USER_SET = (parentUserId: string) => (
  `auth:managed_users:${encodeURIComponent(parentUserId)}`
)
const KEY_PASSWORD_RESET_REQUEST = (id: string) => `auth:password_reset_requests:${id}`
const KEY_PASSWORD_RESET_REQUEST_SET = "auth:password_reset_requests"
const KEY_PASSWORD_RESET_TOKEN = (hash: string) => `auth:password_reset_tokens:${hash}`
const PASSWORD_RESET_REQUEST_TTL_SECONDS = 60 * 60 * 24 * 7
const PASSWORD_RESET_TOKEN_TTL_SECONDS = 60 * 30

export type AuthUser = {
  id: string
  email: string
  name: string
  passwordHash: string
  role: "admin" | "user"
  status: "active" | "disabled"
  createdAt: string
  updatedAt: string
  lastLoginAt?: string
  termsAcceptedAt?: string
  emailVerifiedAt?: string
  managedByUserId?: string
  mustChangePassword?: boolean
  authVersion: number
}

export type PublicUser = Omit<AuthUser, "passwordHash" | "authVersion">

export type PasswordResetRequest = {
  id: string
  email: string
  userId?: string
  userName?: string
  userStatus?: AuthUser["status"] | "missing"
  status: "pending" | "link_generated" | "used"
  createdAt: string
  updatedAt: string
  linkGeneratedAt?: string
  linkGeneratedBy?: string
  tokenExpiresAt?: string
  usedAt?: string
}

type AuthSession = {
  id: string
  userId: string
  createdAt: string
  expiresAt: string
  authVersion?: number
}

type PasswordResetTokenRecord = {
  tokenHash: string
  userId: string
  requestId: string
  createdAt: string
  expiresAt: string
  createdByAdminId: string
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function normalizeInviteCode(value: unknown): string {
  return String(value || "").trim()
}

export function isSignUpInviteRequired(): boolean {
  return Boolean(normalizeInviteCode(process.env.SIGN_UP_INVITE_CODE))
}

export function validateSignUpInviteCode(value: unknown): boolean {
  const expected = normalizeInviteCode(process.env.SIGN_UP_INVITE_CODE)
  if (!expected) return true

  const actual = normalizeInviteCode(value)
  if (!actual) return false

  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)
  if (expectedBuffer.length !== actualBuffer.length) return false
  return timingSafeEqual(expectedBuffer, actualBuffer)
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url")
  const hash = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer
  return `scrypt$${salt}$${hash.toString("base64url")}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$")
  if (scheme !== "scrypt" || !salt || !hash) return false

  const expected = Buffer.from(hash, "base64url")
  const actual = (await scrypt(password, salt, expected.length)) as Buffer
  if (actual.length !== expected.length) return false

  return timingSafeEqual(actual, expected)
}

function toPublicUser(user: AuthUser): PublicUser {
  const publicUser = { ...user } as AuthUser
  delete (publicUser as Partial<AuthUser>).passwordHash
  delete (publicUser as Partial<AuthUser>).authVersion
  return publicUser as PublicUser
}

function currentAuthVersion(user: Pick<AuthUser, "authVersion">): number {
  return Number.isFinite(user.authVersion) ? Math.max(0, Math.floor(user.authVersion)) : 0
}

function validatePassword(password: string): string | null {
  if (password.length < 8) return "密码至少需要 8 位"
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "密码需要同时包含字母和数字"
  }
  return null
}

function hashPasswordResetToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url")
}

function assertValidResetToken(token: string): void {
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) {
    throw new Error("重置链接无效或已过期")
  }
}

function resolveRole(email: string): AuthUser["role"] {
  const adminEmails = new Set(
    (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map(item => normalizeEmail(item))
      .filter(Boolean)
  )

  return adminEmails.has(normalizeEmail(email)) ? "admin" : "user"
}

function isConfiguredAdminEmail(email: string): boolean {
  return resolveRole(email) === "admin"
}

function assertValidEmail(email: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("请输入有效邮箱")
  }
}

export async function createUser(input: {
  email: string
  password: string
  name?: string
  termsAcceptedAt?: string
  emailVerifiedAt?: string
  managedByUserId?: string
  mustChangePassword?: boolean
}): Promise<PublicUser> {
  const email = normalizeEmail(input.email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("请输入有效邮箱")
  }

  const passwordError = validatePassword(input.password)
  if (passwordError) throw new Error(passwordError)

  const existing = await kv.get<string>(KEY_EMAIL(email))
  if (existing) throw new Error("该邮箱已注册，请直接登录")

  const now = new Date().toISOString()
  const user: AuthUser = {
    id: `user_${randomUUID().replace(/-/g, "")}`,
    email,
    name: input.name?.trim() || email.split("@")[0] || "用户",
    passwordHash: await hashPassword(input.password),
    role: resolveRole(email),
    status: "active",
    createdAt: now,
    updatedAt: now,
    termsAcceptedAt: input.termsAcceptedAt || now,
    emailVerifiedAt: input.emailVerifiedAt,
    managedByUserId: input.managedByUserId,
    mustChangePassword: input.mustChangePassword === true,
    authVersion: 0,
  }

  const created = await kv.set(KEY_EMAIL(email), user.id, { nx: true })
  if (!created) throw new Error("该邮箱已注册，请直接登录")

  await kv.set(KEY_USER(user.id), user)
  await kv.sadd(KEY_USER_SET, user.id)
  if (user.managedByUserId) {
    await kv.sadd(KEY_MANAGED_USER_SET(user.managedByUserId), user.id)
  }

  return toPublicUser(user)
}

export async function authenticateUser(emailInput: string, password: string): Promise<PublicUser> {
  const email = normalizeEmail(emailInput)
  const userId = await kv.get<string>(KEY_EMAIL(email))
  if (!userId) throw new Error("邮箱或密码不正确")

  const user = await kv.get<AuthUser>(KEY_USER(userId))
  if (!user) throw new Error("邮箱或密码不正确")
  if (user.status !== "active") throw new Error("账号已停用，请联系管理员")

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) throw new Error("邮箱或密码不正确")

  const updated: AuthUser = {
    ...user,
    role: user.role === "admin" ? "admin" : resolveRole(user.email),
    lastLoginAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await kv.set(KEY_USER(user.id), updated)

  return toPublicUser(updated)
}

export async function authenticateUserWithEmailCode(
  emailInput: string,
  code: string,
): Promise<PublicUser> {
  const email = normalizeEmail(emailInput)
  const userId = await kv.get<string>(KEY_EMAIL(email))
  if (!userId) throw new Error("验证码无效或已过期")

  const user = await kv.get<AuthUser>(KEY_USER(userId))
  if (!user) throw new Error("验证码无效或已过期")
  if (user.status !== "active") throw new Error("账号已停用，请联系管理员")

  await consumeEmailVerificationCode({
    email,
    purpose: "sign-in",
    code,
  })

  const now = new Date().toISOString()
  const updated: AuthUser = {
    ...user,
    emailVerifiedAt: user.emailVerifiedAt || now,
    lastLoginAt: now,
    updatedAt: now,
  }
  await kv.set(KEY_USER(user.id), updated)
  return toPublicUser(updated)
}

export async function createPasswordResetRequest(emailInput: string): Promise<void> {
  const email = normalizeEmail(emailInput)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return

  const userId = await kv.get<string>(KEY_EMAIL(email))
  const user = userId ? await kv.get<AuthUser>(KEY_USER(userId)) : null

  const now = new Date().toISOString()
  const request: PasswordResetRequest = {
    id: `reset_req_${randomUUID().replace(/-/g, "")}`,
    email,
    userId: user?.id || userId || undefined,
    userName: user?.name,
    userStatus: user?.status || "missing",
    status: "pending",
    createdAt: now,
    updatedAt: now,
  }

  await kv.set(KEY_PASSWORD_RESET_REQUEST(request.id), request, {
    ex: PASSWORD_RESET_REQUEST_TTL_SECONDS,
  })
  await kv.sadd(KEY_PASSWORD_RESET_REQUEST_SET, request.id)
}

export async function listPasswordResetRequests(limit = 100): Promise<PasswordResetRequest[]> {
  const ids = await kv.smembers<string[]>(KEY_PASSWORD_RESET_REQUEST_SET)
  const records = await Promise.all(
    ids.map(async id => {
      const record = await kv.get<PasswordResetRequest>(KEY_PASSWORD_RESET_REQUEST(id))
      if (!record) await kv.srem(KEY_PASSWORD_RESET_REQUEST_SET, id)
      return record
    })
  )

  return records
    .filter((record): record is PasswordResetRequest => Boolean(record))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(1, Math.floor(limit)))
}

export async function createPasswordResetLinkForRequest(
  requestId: string,
  adminUserId: string,
): Promise<{ path: string; expiresAt: string; request: PasswordResetRequest }> {
  const request = await kv.get<PasswordResetRequest>(KEY_PASSWORD_RESET_REQUEST(requestId))
  if (!request) throw new Error("重置申请不存在或已过期")
  if (request.status === "used") throw new Error("该重置申请已完成")
  if (!request.userId || request.userStatus === "missing") {
    throw new Error("该邮箱未匹配到有效用户，不能生成重置链接")
  }
  if (request.userStatus === "disabled") {
    throw new Error("该用户已停用，不能生成重置链接")
  }

  const user = await kv.get<AuthUser>(KEY_USER(request.userId))
  if (!user || user.status !== "active") throw new Error("用户不存在或已停用")

  const token = randomBytes(32).toString("base64url")
  const tokenHash = hashPasswordResetToken(token)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_SECONDS * 1000).toISOString()
  const record: PasswordResetTokenRecord = {
    tokenHash,
    userId: user.id,
    requestId: request.id,
    createdAt: now.toISOString(),
    expiresAt,
    createdByAdminId: adminUserId,
  }

  await kv.set(KEY_PASSWORD_RESET_TOKEN(tokenHash), record, {
    ex: PASSWORD_RESET_TOKEN_TTL_SECONDS,
  })

  const updated: PasswordResetRequest = {
    ...request,
    status: "link_generated",
    updatedAt: now.toISOString(),
    linkGeneratedAt: now.toISOString(),
    linkGeneratedBy: adminUserId,
    tokenExpiresAt: expiresAt,
  }
  await kv.set(KEY_PASSWORD_RESET_REQUEST(updated.id), updated, {
    ex: PASSWORD_RESET_REQUEST_TTL_SECONDS,
  })

  return {
    path: `/reset-password?token=${encodeURIComponent(token)}`,
    expiresAt,
    request: updated,
  }
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<PublicUser> {
  assertValidResetToken(token)

  const passwordError = validatePassword(newPassword)
  if (passwordError) throw new Error(passwordError)

  const tokenHash = hashPasswordResetToken(token)
  const record = await kv.get<PasswordResetTokenRecord>(KEY_PASSWORD_RESET_TOKEN(tokenHash))
  if (!record || new Date(record.expiresAt).getTime() <= Date.now()) {
    await kv.del(KEY_PASSWORD_RESET_TOKEN(tokenHash))
    throw new Error("重置链接无效或已过期")
  }

  const user = await kv.get<AuthUser>(KEY_USER(record.userId))
  if (!user || user.status !== "active") throw new Error("用户不存在或已停用")

  const now = new Date().toISOString()
  const updated: AuthUser = {
    ...user,
    passwordHash: await hashPassword(newPassword),
    mustChangePassword: false,
    authVersion: currentAuthVersion(user) + 1,
    updatedAt: now,
  }
  await kv.set(KEY_USER(user.id), updated)
  await kv.del(KEY_PASSWORD_RESET_TOKEN(tokenHash))

  const request = await kv.get<PasswordResetRequest>(KEY_PASSWORD_RESET_REQUEST(record.requestId))
  if (request) {
    await kv.set(KEY_PASSWORD_RESET_REQUEST(request.id), {
      ...request,
      status: "used",
      usedAt: now,
      updatedAt: now,
    } satisfies PasswordResetRequest, {
      ex: PASSWORD_RESET_REQUEST_TTL_SECONDS,
    })
  }

  return toPublicUser(updated)
}

export async function resetPasswordWithEmailCode(input: {
  email: string
  code: string
  newPassword: string
}): Promise<PublicUser> {
  const email = normalizeEmail(input.email)
  const passwordError = validatePassword(input.newPassword)
  if (passwordError) throw new Error(passwordError)

  const userId = await kv.get<string>(KEY_EMAIL(email))
  if (!userId) throw new Error("验证码无效或已过期")
  const user = await kv.get<AuthUser>(KEY_USER(userId))
  if (!user) throw new Error("验证码无效或已过期")
  if (user.status !== "active") throw new Error("账号已停用，请联系管理员")

  await consumeEmailVerificationCode({
    email,
    purpose: "password-reset",
    code: input.code,
  })

  const now = new Date().toISOString()
  const updated: AuthUser = {
    ...user,
    passwordHash: await hashPassword(input.newPassword),
    emailVerifiedAt: user.emailVerifiedAt || now,
    mustChangePassword: false,
    authVersion: currentAuthVersion(user) + 1,
    updatedAt: now,
  }
  await kv.set(KEY_USER(user.id), updated)
  return toPublicUser(updated)
}

export async function createSession(userId: string): Promise<{
  cookieValue: string
  expiresAt: Date
}> {
  const user = await kv.get<AuthUser>(KEY_USER(userId))
  if (!user || user.status !== "active") throw new Error("用户不存在或已停用")

  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000)
  const session: AuthSession = {
    id: `sess_${randomBytes(24).toString("base64url")}`,
    userId,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    authVersion: currentAuthVersion(user),
  }

  await kv.set(KEY_SESSION(session.id), session, { ex: SESSION_TTL_SECONDS })

  return {
    cookieValue: createSessionCookieValue(session.id),
    expiresAt,
  }
}

export async function getSession(cookieValue?: string): Promise<AuthSession | null> {
  const sessionId = verifySessionCookieValue(cookieValue)
  if (!sessionId) return null

  const session = await kv.get<AuthSession>(KEY_SESSION(sessionId))
  if (!session) return null

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await kv.del(KEY_SESSION(sessionId))
    return null
  }

  return session
}

export async function destroySession(cookieValue?: string): Promise<void> {
  const sessionId = verifySessionCookieValue(cookieValue)
  if (sessionId) await kv.del(KEY_SESSION(sessionId))
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  const cookieStore = await cookies()
  const session = await getSession(cookieStore.get(AUTH_COOKIE_NAME)?.value)
  if (!session) return null

  const user = await kv.get<AuthUser>(KEY_USER(session.userId))
  if (!user || user.status !== "active") return null
  if ((session.authVersion ?? 0) !== currentAuthVersion(user)) {
    await kv.del(KEY_SESSION(session.id))
    return null
  }

  return toPublicUser({
    ...user,
    role: user.role === "admin" ? "admin" : resolveRole(user.email),
  })
}

export async function listUsers(): Promise<PublicUser[]> {
  const ids = await kv.smembers<string[]>(KEY_USER_SET)
  const users = await Promise.all(ids.map(id => kv.get<AuthUser>(KEY_USER(id))))
  return users
    .filter((user): user is AuthUser => Boolean(user))
    .map(user =>
      toPublicUser({
        ...user,
        role: user.role === "admin" ? "admin" : resolveRole(user.email),
      })
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function listManagedUsers(parentUserId: string): Promise<PublicUser[]> {
  const indexedIds = await kv.smembers<string[]>(KEY_MANAGED_USER_SET(parentUserId))
  if (indexedIds.length > 0) {
    const users = await Promise.all(indexedIds.map(id => kv.get<AuthUser>(KEY_USER(id))))
    return users
      .filter((user): user is AuthUser => Boolean(
        user && user.managedByUserId === parentUserId,
      ))
      .map(toPublicUser)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  const users = (await listUsers()).filter(user => user.managedByUserId === parentUserId)
  if (users.length > 0) {
    await kv.sadd(KEY_MANAGED_USER_SET(parentUserId), ...users.map(user => user.id))
  }
  return users
}

export async function getUserById(userId: string): Promise<PublicUser | null> {
  const user = await kv.get<AuthUser>(KEY_USER(userId))
  return user ? toPublicUser(user) : null
}

export async function getUserByEmail(emailInput: string): Promise<PublicUser | null> {
  const email = normalizeEmail(emailInput)
  const userId = await kv.get<string>(KEY_EMAIL(email))
  if (!userId) return null
  return getUserById(userId)
}

export async function validateAccountEmailChangeTarget(
  userId: string,
  emailInput: string,
): Promise<string> {
  const user = await kv.get<AuthUser>(KEY_USER(userId))
  if (!user || user.status !== "active") throw new Error("用户不存在或已停用")
  if (user.role === "admin" || isConfiguredAdminEmail(user.email)) {
    throw new Error("管理员登录邮箱请在服务端配置中变更")
  }

  const email = normalizeEmail(emailInput)
  assertValidEmail(email)
  if (email === normalizeEmail(user.email)) throw new Error("新邮箱不能与当前邮箱相同")
  if (isConfiguredAdminEmail(email)) throw new Error("该邮箱不能用于普通账号")

  const existingUserId = await kv.get<string>(KEY_EMAIL(email))
  if (existingUserId && existingUserId !== userId) throw new Error("该邮箱已被其他账号使用")
  return email
}

export async function updateUserProfileName(
  userId: string,
  nameInput: string,
): Promise<PublicUser> {
  const user = await kv.get<AuthUser>(KEY_USER(userId))
  if (!user || user.status !== "active") throw new Error("用户不存在或已停用")
  const name = nameInput.trim().replace(/\s+/g, " ").slice(0, 50)
  if (name.length < 2) throw new Error("账号名称至少需要 2 个字符")
  const updated: AuthUser = {
    ...user,
    name,
    updatedAt: new Date().toISOString(),
  }
  await kv.set(KEY_USER(user.id), updated)
  return toPublicUser(updated)
}

export async function changeUserEmail(input: {
  userId: string
  currentPassword: string
  newEmail: string
  verificationCode: string
}): Promise<PublicUser> {
  const user = await kv.get<AuthUser>(KEY_USER(input.userId))
  if (!user || user.status !== "active") throw new Error("用户不存在或已停用")
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new Error("当前密码不正确")
  }
  const email = await validateAccountEmailChangeTarget(user.id, input.newEmail)
  await consumeEmailVerificationCode({
    email,
    purpose: "email-change",
    code: input.verificationCode,
  })

  const mappedUserId = await kv.get<string>(KEY_EMAIL(email))
  let reserved = false
  if (mappedUserId && mappedUserId !== user.id) throw new Error("该邮箱已被其他账号使用")
  if (!mappedUserId) {
    reserved = Boolean(await kv.set(KEY_EMAIL(email), user.id, { nx: true }))
    if (!reserved) throw new Error("该邮箱已被其他账号使用")
  }

  const now = new Date().toISOString()
  const updated: AuthUser = {
    ...user,
    email,
    emailVerifiedAt: now,
    authVersion: currentAuthVersion(user) + 1,
    updatedAt: now,
  }
  try {
    await kv.set(KEY_USER(user.id), updated)
  } catch (error) {
    if (reserved) await kv.del(KEY_EMAIL(email))
    throw error
  }
  try {
    await kv.del(KEY_EMAIL(normalizeEmail(user.email)))
  } catch (error) {
    console.warn(`[auth] Failed to remove previous email mapping for ${user.id}`, error)
  }
  return toPublicUser(updated)
}

export async function changeUserPassword(input: {
  userId: string
  currentPassword: string
  newPassword: string
}): Promise<PublicUser> {
  const user = await kv.get<AuthUser>(KEY_USER(input.userId))
  if (!user || user.status !== "active") throw new Error("用户不存在或已停用")
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new Error("当前密码不正确")
  }
  const passwordError = validatePassword(input.newPassword)
  if (passwordError) throw new Error(passwordError)
  if (await verifyPassword(input.newPassword, user.passwordHash)) {
    throw new Error("新密码不能与当前密码相同")
  }

  const updated: AuthUser = {
    ...user,
    passwordHash: await hashPassword(input.newPassword),
    mustChangePassword: false,
    authVersion: currentAuthVersion(user) + 1,
    updatedAt: new Date().toISOString(),
  }
  await kv.set(KEY_USER(user.id), updated)
  return toPublicUser(updated)
}

export async function setManagedUserTemporaryPassword(input: {
  parentUserId: string
  childUserId: string
  temporaryPassword: string
}): Promise<PublicUser> {
  const passwordError = validatePassword(input.temporaryPassword)
  if (passwordError) throw new Error(passwordError)
  const user = await kv.get<AuthUser>(KEY_USER(input.childUserId))
  if (!user || user.managedByUserId !== input.parentUserId) {
    throw new Error("客户子账号不存在或无权管理")
  }
  const updated: AuthUser = {
    ...user,
    passwordHash: await hashPassword(input.temporaryPassword),
    mustChangePassword: true,
    authVersion: currentAuthVersion(user) + 1,
    updatedAt: new Date().toISOString(),
  }
  await kv.set(KEY_USER(user.id), updated)
  return toPublicUser(updated)
}

export async function updateUserStatus(
  userId: string,
  status: AuthUser["status"],
): Promise<PublicUser> {
  const user = await kv.get<AuthUser>(KEY_USER(userId))
  if (!user) throw new Error("用户不存在")
  const updated: AuthUser = {
    ...user,
    status,
    authVersion: status === "disabled" ? currentAuthVersion(user) + 1 : currentAuthVersion(user),
    updatedAt: new Date().toISOString(),
  }
  await kv.set(KEY_USER(user.id), updated)
  return toPublicUser(updated)
}
