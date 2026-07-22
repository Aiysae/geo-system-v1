"use server"

import { revalidatePath } from "next/cache"
import { assertAdmin } from "@/lib/admin"
import { saveAiProviderSetting } from "@/lib/ai-settings"
import {
  saveAiGatewayProvider,
  setAiGatewayEnabled,
  setAiGatewayModelEnabled,
  syncAiGatewayModels,
} from "@/lib/ai-gateways"
import { approveRequest, rejectRequest } from "@/lib/recharge"
import type { AiProviderKey } from "@/types/ai-settings"
import type { AiGatewayAuthType, AiGatewayPresetKey } from "@/types/ai-gateway"

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
  revalidatePath("/admin/ledger")
  revalidatePath(`/admin/users/${result.record.userId}`)
  revalidatePath("/billing")
  return {
    ok: true,
    message: `已为 ${result.record.username || result.record.email || result.record.userId} 充值 ${
      result.record.credits ?? result.record.amount
    } 积分，到账后余额 ${result.balance}`,
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
  revalidatePath(`/admin/users/${result.record.userId}`)
  revalidatePath("/billing")
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

export type SaveAiGatewayState = {
  ok?: boolean
  message?: string
  id?: string
}

export async function saveAiGatewayAction(
  _prevState: SaveAiGatewayState,
  formData: FormData,
): Promise<SaveAiGatewayState> {
  let adminId: string
  try {
    adminId = await assertAdmin()
  } catch {
    return { ok: false, message: "无权限" }
  }

  const id = String(formData.get("id") || "").trim() || undefined
  const manualModels = String(formData.get("manualModels") || "")
    .split(/[\n,，]+/)
    .map(item => item.trim())
    .filter(Boolean)

  try {
    const provider = await saveAiGatewayProvider({
      id,
      name: String(formData.get("name") || ""),
      preset: String(formData.get("preset") || "bai") as AiGatewayPresetKey,
      baseUrl: String(formData.get("baseUrl") || ""),
      chatPath: String(formData.get("chatPath") || ""),
      modelsPath: String(formData.get("modelsPath") || ""),
      authType: String(formData.get("authType") || "bearer") as AiGatewayAuthType,
      apiKey: String(formData.get("apiKey") || ""),
      clearApiKey: formData.get("clearApiKey") === "on",
      enabled: formData.get("enabled") === "on",
      priority: Number(formData.get("priority") || 1),
      timeout: Number(formData.get("timeout") || 600),
      maxConcurrency: Number(formData.get("maxConcurrency") || 2),
      manualModels,
    }, adminId)
    revalidatePath("/admin/recharge")
    revalidatePath("/api/article-generation/settings")
    return {
      ok: true,
      id: provider.id,
      message: id ? "中转站配置已保存" : "中转站已添加，可以同步模型了",
    }
  } catch (error) {
    return {
      ok: false,
      id,
      message: error instanceof Error ? error.message : "中转站保存失败",
    }
  }
}

export async function syncAiGatewayModelsAction(providerId: string): Promise<AdminActionResult> {
  let adminId: string
  try {
    adminId = await assertAdmin()
  } catch {
    return { ok: false, error: "无权限" }
  }
  try {
    const provider = await syncAiGatewayModels(providerId, adminId)
    revalidatePath("/admin/recharge")
    revalidatePath("/api/article-generation/settings")
    return { ok: true, message: provider.healthMessage || "连接正常，模型已同步" }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "模型同步失败",
    }
  }
}

export async function toggleAiGatewayAction(
  providerId: string,
  enabled: boolean,
): Promise<AdminActionResult> {
  let adminId: string
  try {
    adminId = await assertAdmin()
  } catch {
    return { ok: false, error: "无权限" }
  }
  try {
    await setAiGatewayEnabled(providerId, enabled, adminId)
    revalidatePath("/admin/recharge")
    revalidatePath("/api/article-generation/settings")
    return { ok: true, message: enabled ? "中转站已启用" : "中转站已停用" }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "状态更新失败",
    }
  }
}

export async function toggleAiGatewayModelAction(
  providerId: string,
  modelId: string,
  enabled: boolean,
): Promise<AdminActionResult> {
  let adminId: string
  try {
    adminId = await assertAdmin()
  } catch {
    return { ok: false, error: "无权限" }
  }
  try {
    await setAiGatewayModelEnabled(providerId, modelId, enabled, adminId)
    revalidatePath("/admin/recharge")
    revalidatePath("/api/article-generation/settings")
    return { ok: true, message: enabled ? "模型已开放" : "模型已隐藏" }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "模型状态更新失败",
    }
  }
}
