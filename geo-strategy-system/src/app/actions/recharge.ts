"use server"

import { auth, clerkClient } from "@clerk/nextjs/server"
import { createRequest, MAX_AMOUNT, MIN_AMOUNT } from "@/lib/recharge"

export type RequestRechargeResult =
  | { ok: true; amount: number }
  | { ok: false; error: string }

export async function requestRechargeAction(
  formData: FormData
): Promise<RequestRechargeResult> {
  const { userId } = await auth()
  if (!userId) return { ok: false, error: "未登录" }

  const raw = formData.get("amount")
  const amount = Number(raw)
  if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    return { ok: false, error: `请输入 ${MIN_AMOUNT} ~ ${MAX_AMOUNT} 之间的整数` }
  }

  let username = ""
  let email = ""
  try {
    const client = await clerkClient()
    const user = await client.users.getUser(userId)
    username =
      user.username ||
      [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      ""
    email = user.primaryEmailAddress?.emailAddress || user.emailAddresses[0]?.emailAddress || ""
  } catch {
    /* 容错：Clerk 元数据拉取失败也允许提交 */
  }

  try {
    await createRequest({ userId, username, email, amount: Math.floor(amount) })
    return { ok: true, amount: Math.floor(amount) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "提交失败" }
  }
}
