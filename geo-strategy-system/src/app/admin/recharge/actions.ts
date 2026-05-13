"use server"

import { revalidatePath } from "next/cache"
import { assertAdmin } from "@/lib/admin"
import { approveRequest, rejectRequest } from "@/lib/recharge"

export type AdminActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string }

export async function approveRechargeAction(
  formData: FormData
): Promise<AdminActionResult> {
  let adminId: string
  try {
    adminId = await assertAdmin()
  } catch {
    return { ok: false, error: "无权限" }
  }
  const requestId = String(formData.get("requestId") || "")
  if (!requestId) return { ok: false, error: "缺少 requestId" }

  const result = await approveRequest(requestId, adminId)
  if (!result.ok) return { ok: false, error: result.reason }

  revalidatePath("/admin/recharge")
  return {
    ok: true,
    message: `已为 ${result.record.username || result.record.email || result.record.userId} 充值 ${result.record.amount} 积分`,
  }
}

export async function rejectRechargeAction(
  formData: FormData
): Promise<AdminActionResult> {
  let adminId: string
  try {
    adminId = await assertAdmin()
  } catch {
    return { ok: false, error: "无权限" }
  }
  const requestId = String(formData.get("requestId") || "")
  if (!requestId) return { ok: false, error: "缺少 requestId" }

  const result = await rejectRequest(requestId, adminId)
  if (!result.ok) return { ok: false, error: result.reason }

  revalidatePath("/admin/recharge")
  return { ok: true, message: "已拒绝该申请" }
}
