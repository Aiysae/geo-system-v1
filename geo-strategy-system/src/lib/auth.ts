import "server-only"

import { kv } from "@vercel/kv"
import { cookies } from "next/headers"
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "crypto"
import { promisify } from "util"
import { AUTH_COOKIE_NAME, createSessionCookieValue, verifySessionCookieValue } from "./session-cookie"

const scrypt = promisify(scryptCallback)

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
const PASSWORD_KEY_LENGTH = 64

const KEY_USER = (id: string) => `auth:users:${id}`
const KEY_EMAIL = (email: string) => `auth:emails:${email}`
const KEY_SESSION = (id: string) => `auth:sessions:${id}`
const KEY_USER_SET = "auth:users"

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
}

export type PublicUser = Omit<AuthUser, "passwordHash">

type AuthSession = {
  id: string
  userId: string
  createdAt: string
  expiresAt: string
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
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
  return publicUser
}

function validatePassword(password: string): string | null {
  if (password.length < 8) return "密码至少需要 8 位"
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "密码需要同时包含字母和数字"
  }
  return null
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

export async function createUser(input: {
  email: string
  password: string
  name?: string
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
  }

  const created = await kv.set(KEY_EMAIL(email), user.id, { nx: true })
  if (!created) throw new Error("该邮箱已注册，请直接登录")

  await kv.set(KEY_USER(user.id), user)
  await kv.sadd(KEY_USER_SET, user.id)

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

export async function createSession(userId: string): Promise<{
  cookieValue: string
  expiresAt: Date
}> {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000)
  const session: AuthSession = {
    id: `sess_${randomBytes(24).toString("base64url")}`,
    userId,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
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

export async function getUserById(userId: string): Promise<PublicUser | null> {
  const user = await kv.get<AuthUser>(KEY_USER(userId))
  return user ? toPublicUser(user) : null
}
