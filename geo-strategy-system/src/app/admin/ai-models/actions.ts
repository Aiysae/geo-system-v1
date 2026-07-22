"use server"

import { revalidatePath } from "next/cache"
import { assertAdmin } from "@/lib/admin"
import {
  deleteAiGatewayProvider,
  getAiGatewayPreset,
  getAiGatewayProviderRuntime,
  saveAiGatewayProvider,
  setAiGatewayEnabled,
  setAiGatewayModelEnabled,
  setAiGatewayPrimaryModel,
  syncAiGatewayModels,
  syncAllAiGatewayModels,
} from "@/lib/ai-gateways"
import { getAiProviderRuntimeSetting, saveAiProviderSetting } from "@/lib/ai-settings"
import type { AiProviderKey } from "@/types/ai-settings"
import type { AiGatewayPresetKey, AiGatewayVendor } from "@/types/ai-gateway"

export type ModelCenterActionResult =
  | { ok: true; message: string; id?: string }
  | { ok: false; error: string; id?: string }

const LEGACY_VENDOR_KEYS = new Set<AiGatewayVendor>([
  "doubao",
  "qwen",
  "hunyuan",
  "deepseek",
  "kimi",
  "ernie",
])

function refreshModelPaths(): void {
  revalidatePath("/admin/ai-models")
  revalidatePath("/admin/recharge")
  revalidatePath("/api/article-generation/settings")
  revalidatePath("/workspace")
}

async function writeThroughLegacy(
  providerId: string,
  adminId: string,
  extraOverrides: Record<string, string | boolean> = {},
): Promise<void> {
  const provider = await getAiGatewayProviderRuntime(providerId)
  if (!LEGACY_VENDOR_KEYS.has(provider.vendor)) return
  const key = provider.vendor as AiProviderKey
  const previous = await getAiProviderRuntimeSetting(key)
  const model = provider.primaryModel || previous.model
  await saveAiProviderSetting(key, {
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    chatPath: provider.chatPath,
    model,
    timeout: provider.timeout,
    extra: { ...previous.extra, ...extraOverrides },
  }, adminId)

  if (provider.vendor === "qwen") {
    const keyword = await getAiProviderRuntimeSetting("keywordStrategy")
    await saveAiProviderSetting("keywordStrategy", {
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      chatPath: provider.chatPath,
      model,
      timeout: provider.timeout,
      extra: keyword.extra,
    }, adminId)
  }
}

async function legacyApiKey(vendor: AiGatewayVendor): Promise<string> {
  if (!LEGACY_VENDOR_KEYS.has(vendor)) return ""
  return (await getAiProviderRuntimeSetting(vendor as AiProviderKey)).apiKey
}

export async function saveModelConnectionAction(formData: FormData): Promise<ModelCenterActionResult> {
  let adminId: string
  try {
    adminId = await assertAdmin()
  } catch {
    return { ok: false, error: "无权限" }
  }

  const id = String(formData.get("id") || "").trim() || undefined
  const presetKey = String(formData.get("preset") || "openai-compatible") as AiGatewayPresetKey
  try {
    const preset = getAiGatewayPreset(presetKey)
    let apiKey = String(formData.get("apiKey") || "").trim()
    if (!apiKey && !id && preset.channel === "official") {
      apiKey = await legacyApiKey(preset.vendor)
    }
    const manualModels = String(formData.get("manualModels") || "")
      .split(/[\n,，]+/)
      .map(value => value.trim())
      .filter(Boolean)
    const provider = await saveAiGatewayProvider({
      id,
      name: String(formData.get("name") || preset.label),
      preset: presetKey,
      baseUrl: String(formData.get("baseUrl") || preset.baseUrl),
      apiKey,
      enabled: formData.get("enabled") !== "false",
      primaryModel: String(formData.get("primaryModel") || preset.defaultModel || ""),
      manualModels,
    }, adminId)
    const extraOverrides: Record<string, string | boolean> = {}
    const botId = String(formData.get("botId") || "").trim()
    const appId = String(formData.get("appId") || "").trim()
    if (botId) extraOverrides.botId = botId
    if (appId) extraOverrides.appId = appId
    if (preset.vendor === "qwen" || preset.vendor === "ernie") extraOverrides.enableSearch = true
    if (preset.vendor === "hunyuan") extraOverrides.enableEnhancement = true
    await writeThroughLegacy(provider.id, adminId, extraOverrides)

    let syncMessage = "配置已保存"
    if (formData.get("syncAfterSave") !== "false") {
      try {
        const synced = await syncAiGatewayModels(provider.id, adminId)
        syncMessage = synced.healthMessage || "配置已保存，模型已更新"
      } catch (error) {
        syncMessage = `配置已保存；${error instanceof Error ? error.message : "模型同步暂未完成"}`
      }
    }
    refreshModelPaths()
    return { ok: true, id: provider.id, message: syncMessage }
  } catch (error) {
    return { ok: false, id, error: error instanceof Error ? error.message : "配置保存失败" }
  }
}

export async function syncModelConnectionAction(providerId: string): Promise<ModelCenterActionResult> {
  let adminId: string
  try {
    adminId = await assertAdmin()
  } catch {
    return { ok: false, error: "无权限" }
  }
  try {
    const provider = await syncAiGatewayModels(providerId, adminId)
    refreshModelPaths()
    return { ok: true, id: providerId, message: provider.healthMessage || "模型已更新" }
  } catch (error) {
    return { ok: false, id: providerId, error: error instanceof Error ? error.message : "模型更新失败" }
  }
}

export async function syncAllModelConnectionsAction(): Promise<ModelCenterActionResult> {
  let adminId: string
  try {
    adminId = await assertAdmin()
  } catch {
    return { ok: false, error: "无权限" }
  }
  const result = await syncAllAiGatewayModels(adminId)
  refreshModelPaths()
  if (result.failed > 0) {
    const names = result.errors.slice(0, 3).map(item => item.name).join("、")
    return {
      ok: false,
      error: `已更新 ${result.success} 个渠道，${result.failed} 个失败：${names}`,
    }
  }
  return { ok: true, message: `已更新全部 ${result.success} 个可用渠道` }
}

export async function setPrimaryModelAction(
  providerId: string,
  modelId: string,
): Promise<ModelCenterActionResult> {
  let adminId: string
  try {
    adminId = await assertAdmin()
  } catch {
    return { ok: false, error: "无权限" }
  }
  try {
    await setAiGatewayPrimaryModel(providerId, modelId, adminId)
    await writeThroughLegacy(providerId, adminId)
    refreshModelPaths()
    return { ok: true, id: providerId, message: `主模型已切换为 ${modelId}` }
  } catch (error) {
    return { ok: false, id: providerId, error: error instanceof Error ? error.message : "主模型切换失败" }
  }
}

export async function toggleModelConnectionAction(
  providerId: string,
  enabled: boolean,
): Promise<ModelCenterActionResult> {
  let adminId: string
  try {
    adminId = await assertAdmin()
  } catch {
    return { ok: false, error: "无权限" }
  }
  try {
    await setAiGatewayEnabled(providerId, enabled, adminId)
    refreshModelPaths()
    return { ok: true, id: providerId, message: enabled ? "渠道已启用" : "渠道已停用" }
  } catch (error) {
    return { ok: false, id: providerId, error: error instanceof Error ? error.message : "状态更新失败" }
  }
}

export async function toggleConnectionModelAction(
  providerId: string,
  modelId: string,
  enabled: boolean,
): Promise<ModelCenterActionResult> {
  let adminId: string
  try {
    adminId = await assertAdmin()
  } catch {
    return { ok: false, error: "无权限" }
  }
  try {
    await setAiGatewayModelEnabled(providerId, modelId, enabled, adminId)
    refreshModelPaths()
    return { ok: true, id: providerId, message: enabled ? "模型已开放" : "模型已隐藏" }
  } catch (error) {
    return { ok: false, id: providerId, error: error instanceof Error ? error.message : "模型状态更新失败" }
  }
}

export async function deleteModelConnectionAction(providerId: string): Promise<ModelCenterActionResult> {
  try {
    await assertAdmin()
    const provider = await getAiGatewayProviderRuntime(providerId)
    if (provider.channel !== "relay") return { ok: false, id: providerId, error: "官方渠道不能删除，可停用或更换 Key" }
    await deleteAiGatewayProvider(providerId)
    refreshModelPaths()
    return { ok: true, id: providerId, message: "中转站已删除" }
  } catch (error) {
    return { ok: false, id: providerId, error: error instanceof Error ? error.message : "删除失败" }
  }
}
