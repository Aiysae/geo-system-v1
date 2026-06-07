"use server"

import { revalidatePath } from "next/cache"
import { assertAdmin } from "@/lib/admin"
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
    await assertAdmin()

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
        ? await decrCreditsBy(userId, amount)
        : await addCreditsBy(userId, amount)

    revalidatePath("/admin")

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
