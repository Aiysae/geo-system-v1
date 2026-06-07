"use server"

import { getCurrentUser } from "@/lib/auth"
import { createRequest, MAX_AMOUNT, MIN_AMOUNT } from "@/lib/recharge"

export type RequestRechargeResult =
  | { ok: true; amount: number }
  | { ok: false; error: string }

export async function requestRechargeAction(
  formData: FormData
): Promise<RequestRechargeResult> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: "未登录" }

  const raw = formData.get("amount")
  const amount = Number(raw)
  if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    return { ok: false, error: `请输入 ${MIN_AMOUNT} ~ ${MAX_AMOUNT} 之间的整数` }
  }

  try {
    await createRequest({
      userId: user.id,
      username: user.name,
      email: user.email,
      amount: Math.floor(amount),
    })
    return { ok: true, amount: Math.floor(amount) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "提交失败" }
  }
}
