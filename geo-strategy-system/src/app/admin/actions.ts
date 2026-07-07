"use server"

import { revalidatePath } from "next/cache"
import { assertAdmin } from "@/lib/admin"
import { updateUserStatus } from "@/lib/auth"
import { addCreditsBy, decrCreditsBy } from "@/lib/credits"

export type AdjustCreditsState = {
  ok?: boolean
  message?: string
}

export async function adjustCreditsAction(
  _prevState: AdjustCreditsState,
  formData: FormData
): Promise<AdjustCreditsState> {
  try {
    const adminId = await assertAdmin()

    const userId = String(formData.get("userId") || "")
    const rawAmount = Number(formData.get("amount"))
    const direction = String(formData.get("direction") || "add")

    if (!userId) return { ok: false, message: "缺少用户 ID" }
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      return { ok: false, message: "请输入大于 0 的积分数" }
    }

    const amount = Math.floor(rawAmount)
    const nextBalance =
      direction === "subtract"
        ? await decrCreditsBy(userId, amount, {
            type: "admin_adjust",
            source: "admin",
            operatorUserId: adminId,
            description: "管理员手动扣除积分",
          })
        : await addCreditsBy(userId, amount, {
            type: "admin_adjust",
            source: "admin",
            operatorUserId: adminId,
            description: "管理员手动增加积分",
          })

    revalidatePath("/admin")
    revalidatePath(`/admin/users/${userId}`)
    revalidatePath("/admin/ledger")

    return {
      ok: true,
      message: `已${direction === "subtract" ? "扣除" : "增加"} ${amount} 积分，当前余额 ${nextBalance}`,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "操作失败",
    }
  }
}

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
