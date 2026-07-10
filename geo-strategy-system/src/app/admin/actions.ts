"use server"

import { revalidatePath } from "next/cache"
import { assertAdmin } from "@/lib/admin"
import { updateUserStatus } from "@/lib/auth"

export type UpdateUserStatusState = {
  ok?: boolean
  message?: string
}

export async function updateUserStatusAction(
  _prevState: UpdateUserStatusState,
  formData: FormData,
): Promise<UpdateUserStatusState> {
  try {
    const adminId = await assertAdmin()
    const userId = String(formData.get("userId") || "")
    const status = String(formData.get("status") || "")

    if (!userId) return { ok: false, message: "缺少用户 ID" }
    if (status !== "active" && status !== "disabled") {
      return { ok: false, message: "无效的账号状态" }
    }
    if (userId === adminId && status === "disabled") {
      return { ok: false, message: "不能停用当前登录管理员" }
    }

    const user = await updateUserStatus(userId, status)
    revalidatePath("/admin")
    revalidatePath(`/admin/users/${userId}`)

    return {
      ok: true,
      message: `${user.email} 已${status === "active" ? "启用" : "停用"}`,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "操作失败",
    }
  }
}
