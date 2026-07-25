"use server"

import { revalidatePath } from "next/cache"
import { assertAdmin } from "@/lib/admin"
import {
  deleteAiCredential,
  getAiCredentialRuntime,
  saveAiCredential,
  setAiCredentialEnabled,
} from "@/lib/ai-credential-store"
import { AI_CREDENTIAL_PRESET_BY_VENDOR } from "@/lib/ai-credential-presets"
import { verifyAiCredentialChat } from "@/lib/ai-credential-verification"
import { verifyAiCredentialWeb } from "@/lib/ai-credential-web-verification"
import type {
  AiCredentialCapability,
  AiCredentialModule,
  AiCredentialVendor,
} from "@/types/ai-credentials"

export type CredentialActionResult =
  | { ok: true; message: string; id?: string }
  | { ok: false; error: string; id?: string }

function refreshPaths(): void {
  revalidatePath("/admin/ai-models")
  revalidatePath("/api/article-generation/settings")
}

function listValue(formData: FormData, key: string): string[] {
  return String(formData.get(key) || "")
    .split(/[\n,，]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

export async function saveCredentialAction(
  formData: FormData,
): Promise<CredentialActionResult> {
  let adminId: string
  try {
    adminId = await assertAdmin()
  } catch {
    return { ok: false, error: "无权限" }
  }

  const vendor = String(formData.get("vendor") || "") as AiCredentialVendor
  const preset = AI_CREDENTIAL_PRESET_BY_VENDOR.get(vendor)
  if (!preset) return { ok: false, error: "请选择模型供应商" }
  const id = String(formData.get("id") || "").trim() || undefined
  const accountLabel = String(formData.get("accountLabel") || "").trim()
  try {
    const credential = await saveAiCredential({
      id,
      vendor,
      name: String(formData.get("name") || "").trim()
        || `${preset.label} · ${accountLabel || "新账号"}`,
      accountLabel,
      quotaGroup: String(formData.get("quotaGroup") || "").trim(),
      baseUrl: String(formData.get("baseUrl") || preset.baseUrl),
      chatPath: String(formData.get("chatPath") || preset.chatPath),
      apiKey: String(formData.get("apiKey") || "").trim(),
      clearApiKey: formData.get("clearApiKey") === "true",
      enabled: false,
      priority: Number(formData.get("priority") || 100),
      weight: Number(formData.get("weight") || 100),
      maxConcurrency: Number(formData.get("maxConcurrency") || preset.defaultConcurrency),
      quotaGroupMaxConcurrency: Number(
        formData.get("quotaGroupMaxConcurrency") || preset.defaultConcurrency,
      ),
      rpmLimit: Number(formData.get("rpmLimit") || 0) || undefined,
      tpmLimit: Number(formData.get("tpmLimit") || 0) || undefined,
      dailyBudgetCents: Number(formData.get("dailyBudgetCents") || 0) || undefined,
      allowedModels: listValue(formData, "allowedModels").length > 0
        ? listValue(formData, "allowedModels")
        : preset.defaultModels,
      allowedModules: (
        formData.getAll("allowedModules").length > 0
          ? formData.getAll("allowedModules").map(String)
          : preset.allowedModules
      ) as AiCredentialModule[],
      declaredCapabilities: (
        formData.getAll("declaredCapabilities").length > 0
          ? formData.getAll("declaredCapabilities").map(String)
          : preset.declaredCapabilities
      ) as AiCredentialCapability[],
    }, adminId)
    refreshPaths()
    return {
      ok: true,
      id: credential.id,
      message: id ? "账号配置已更新，请重新检测后启用" : "账号已安全保存，请先检测再启用",
    }
  } catch (error) {
    return {
      ok: false,
      id,
      error: error instanceof Error ? error.message : "模型账号保存失败",
    }
  }
}

export async function testCredentialAction(
  id: string,
): Promise<CredentialActionResult> {
  try {
    await assertAdmin()
    const result = await verifyAiCredentialChat(id)
    refreshPaths()
    return { ok: true, id, message: result.message }
  } catch (error) {
    refreshPaths()
    return {
      ok: false,
      id,
      error: error instanceof Error ? error.message : "模型账号检测失败",
    }
  }
}

export async function testCredentialWebAction(
  id: string,
): Promise<CredentialActionResult> {
  try {
    await assertAdmin()
    const result = await verifyAiCredentialWeb(id)
    refreshPaths()
    return { ok: true, id, message: result.message }
  } catch (error) {
    refreshPaths()
    return {
      ok: false,
      id,
      error: error instanceof Error ? error.message : "严格联网能力检测失败",
    }
  }
}

export async function toggleCredentialAction(
  id: string,
  enabled: boolean,
): Promise<CredentialActionResult> {
  try {
    const adminId = await assertAdmin()
    const credential = await getAiCredentialRuntime(id)
    if (enabled) {
      if (credential.healthStatus !== "healthy" || !credential.verifiedCapabilities.includes("chat")) {
        return { ok: false, id, error: "请先完成基础生成检测，再启用该账号" }
      }
    }
    await setAiCredentialEnabled(id, enabled, adminId)
    refreshPaths()
    return { ok: true, id, message: enabled ? "账号已加入调度池" : "账号已退出调度池" }
  } catch (error) {
    return {
      ok: false,
      id,
      error: error instanceof Error ? error.message : "账号状态更新失败",
    }
  }
}

export async function deleteCredentialAction(
  id: string,
): Promise<CredentialActionResult> {
  try {
    await assertAdmin()
    const credential = await getAiCredentialRuntime(id)
    if (credential.enabled) {
      return { ok: false, id, error: "请先停用该账号，再执行删除" }
    }
    await deleteAiCredential(id)
    refreshPaths()
    return { ok: true, id, message: "模型账号已删除" }
  } catch (error) {
    return {
      ok: false,
      id,
      error: error instanceof Error ? error.message : "模型账号删除失败",
    }
  }
}
