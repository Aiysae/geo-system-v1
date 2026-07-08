"use server"

import { revalidatePath } from "next/cache"
import { assertAdmin } from "@/lib/admin"
import { createPasswordResetLinkForRequest } from "@/lib/auth"

export type PasswordResetLinkState = {
  ok?: boolean
  message?: string
  path?: string
  expiresAt?: string
}

export async function createPasswordResetLinkAction(
  _prevState: PasswordResetLinkState,
  formData: FormData,
): Promise<PasswordResetLinkState> {
  try {
    const adminId = await assertAdmin()
    const requestId = String(formData.get("requestId") || "")
    if (!requestId) return { ok: false, message: "缺少重置申请 ID" }

    const result = await createPasswordResetLinkForRequest(requestId, adminId)
    revalidatePath("/admin/password-resets")

    return {
      ok: true,
      message: "已生成一次性重置链接",
      path: result.path,
      expiresAt: result.expiresAt,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "生成重置链接失败",
    }
  }
}
