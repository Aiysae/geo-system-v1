"use server"

import { getCurrentUser } from "@/lib/auth"
import { createRequest } from "@/lib/recharge"

export type RequestRechargeResult =
  | { ok: true; credits: number; packageName: string; priceCents?: number; paymentOutTradeNo?: string }
  | { ok: false; error: string }

export async function requestRechargeAction(
  formData: FormData
): Promise<RequestRechargeResult> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: "未登录" }

  const packageKey = String(formData.get("packageKey") || "")
  const paymentMethod = String(formData.get("paymentMethod") || "manual_transfer")
  const payerName = String(formData.get("payerName") || "")
  const paymentReference = String(formData.get("paymentReference") || "")
  const contact = String(formData.get("contact") || "")
  const note = String(formData.get("note") || "")

  try {
    const request = await createRequest({
      userId: user.id,
      username: user.name,
      email: user.email,
      packageKey,
      paymentMethod,
      payerName,
      paymentReference,
      contact,
      note,
    })
    return {
      ok: true,
      credits: request.credits ?? request.amount,
      packageName: request.packageName || "充值套餐",
      priceCents: request.priceCents,
      paymentOutTradeNo: request.paymentOutTradeNo,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "提交失败" }
  }
}
