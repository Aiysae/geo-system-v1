"use server"

import { revalidatePath } from "next/cache"
import { assertAdmin } from "@/lib/admin"
import { saveAiProviderSetting } from "@/lib/ai-settings"
import { approveRequest, rejectRequest } from "@/lib/recharge"
import type { AiProviderKey } from "@/types/ai-settings"

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

export type SaveAiSettingState = {
  ok?: boolean
  message?: string
  key?: string
}

export async function saveAiSettingAction(
  _prevState: SaveAiSettingState,
  formData: FormData
): Promise<SaveAiSettingState> {
  let adminId: string
  try {
    adminId = await assertAdmin()
  } catch {
    return { ok: false, message: "无权限" }
  }

  const key = String(formData.get("key") || "") as AiProviderKey
  const apiKey = String(formData.get("apiKey") || "").trim()
  const baseUrl = String(formData.get("baseUrl") || "").trim()
  const chatPath = String(formData.get("chatPath") || "").trim()
  const model = String(formData.get("model") || "").trim()
  const timeout = Number(formData.get("timeout") || 300)
  const clearApiKey = formData.get("clearApiKey") === "on"

  const extra: Record<string, string | boolean> = {}
  for (const [fieldKey, value] of formData.entries()) {
    if (!fieldKey.startsWith("extra.")) continue
    const extraKey = fieldKey.slice("extra.".length)
    if (value === "on") extra[extraKey] = true
    else extra[extraKey] = String(value || "").trim()
  }

  try {
    await saveAiProviderSetting(
      key,
      {
        apiKey,
        clearApiKey,
        baseUrl,
        chatPath,
        model,
        timeout,
        extra,
      },
      adminId
    )
    revalidatePath("/admin/recharge")
    revalidatePath("/admin")
    return { ok: true, key, message: "模型配置已保存" }
  } catch (error) {
    return {
      ok: false,
      key,
      message: error instanceof Error ? error.message : "保存失败",
    }
  }
}
