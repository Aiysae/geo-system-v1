import { getCurrentUser, normalizeEmail, type PublicUser } from "./auth"

const FALLBACK_ADMIN_USER_IDS = new Set<string>([
  "user_3DfnZjNNsbtHiPpvSUvvHVzOPGp",
])

function envSet(name: string): Set<string> {
  return new Set(
    (process.env[name] || "")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean)
  )
}

export function isAdminUser(user: PublicUser | null | undefined): boolean {
  if (!user) return false
  if (user.role === "admin") return true

  const adminUserIds = envSet("ADMIN_USER_IDS")
  if (adminUserIds.has(user.id) || FALLBACK_ADMIN_USER_IDS.has(user.id)) return true

  const adminEmails = new Set(
    (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map(item => normalizeEmail(item))
      .filter(Boolean)
  )

  return adminEmails.has(normalizeEmail(user.email))
}

export function isAdminUserId(userId: string | null | undefined): boolean {
  if (!userId) return false
  return envSet("ADMIN_USER_IDS").has(userId) || FALLBACK_ADMIN_USER_IDS.has(userId)
}

/**
 * 服务端管理员校验。未登录或非管理员时抛错，调用方应让其冒泡到 Next.js 边界。
 * 同时返回当前 userId 供后续业务使用。
 */
export async function assertAdmin(): Promise<string> {
  const user = await getCurrentUser()
  if (!user || !isAdminUser(user)) {
    throw new Error("Forbidden: admin only")
  }
  return user.id
}
