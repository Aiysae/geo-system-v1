import { auth } from "@clerk/nextjs/server"

const ADMIN_USER_IDS = new Set<string>([
  "user_3DfnZjNNsbtHiPpvSUvvHVzOPGp",
])

export function isAdminUserId(userId: string | null | undefined): boolean {
  if (!userId) return false
  return ADMIN_USER_IDS.has(userId)
}

/**
 * 服务端管理员校验。未登录或非管理员时抛错，调用方应让其冒泡到 Next.js 边界。
 * 同时返回当前 userId 供后续业务使用。
 */
export async function assertAdmin(): Promise<string> {
  const { userId } = await auth()
  if (!userId || !isAdminUserId(userId)) {
    throw new Error("Forbidden: admin only")
  }
  return userId
}
