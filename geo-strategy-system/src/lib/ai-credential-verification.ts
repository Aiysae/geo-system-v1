import "server-only"

import {
  getAiCredentialRuntime,
  prioritizeAiCredentialModel,
  updateAiCredentialHealth,
} from "@/lib/ai-credential-store"
import { classifyAiCredentialFailure } from "@/lib/ai-credential-failure-classifier"
import {
  buildAiCredentialRouteIdentity,
  recordAiCredentialRouteFailure,
  recordAiCredentialRouteSuccess,
} from "@/lib/ai-credential-route-health"
import { sanitizeAiUpstreamMessage } from "@/lib/ai-secrets"
import { openaiCompatChat } from "@/lib/llm/openai-compat"
import type {
  AiCredentialCapability,
  AiCredentialModule,
  AiCredentialPublic,
} from "@/types/ai-credentials"

export interface AiCredentialVerificationResult {
  credential: AiCredentialPublic
  message: string
  models: AiCredentialModelVerification[]
}

export interface AiCredentialModelVerification {
  model: string
  status: "passed" | "failed"
  capabilities: AiCredentialCapability[]
  latencyMs: number
  error?: string
}

function chatUrl(baseUrl: string, chatPath: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${chatPath.replace(/^\/+/, "")}`
}

function looksLikeJson(value: string): boolean {
  const normalized = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
  try {
    const parsed = JSON.parse(normalized) as { ok?: unknown }
    return parsed?.ok === true || parsed?.ok === "true"
  } catch {
    return /["']?ok["']?\s*:\s*(?:true|["']true["'])/i.test(normalized)
  }
}

export async function verifyAiCredentialChat(
  credentialId: string,
  options: {
    allModels?: boolean
    model?: string
    module?: AiCredentialModule
    isProbe?: boolean
  } = {},
): Promise<AiCredentialVerificationResult> {
  const credential = await getAiCredentialRuntime(credentialId)
  if (!credential.apiKey) throw new Error("该模型账号尚未配置 API Key")
  if (credential.allowedModels.length === 0) {
    throw new Error("请先为该账号填写至少一个可用模型")
  }

  const requestedModel = String(options.model || "").trim()
  if (requestedModel && !credential.allowedModels.includes(requestedModel)) {
    throw new Error("指定模型不在该账号的允许模型列表中")
  }
  const routeModule = options.module || credential.allowedModules[0] || "article"
  const modelsToTest = requestedModel ? [requestedModel] : credential.allowedModels
  const startedAt = Date.now()
  let lastError: unknown
  const models: AiCredentialModelVerification[] = []
  for (const model of modelsToTest) {
    const modelStartedAt = Date.now()
    try {
      const content = await openaiCompatChat({
        url: chatUrl(credential.baseUrl, credential.chatPath),
        apiKey: credential.apiKey,
        model,
        system: "你是 API 连通性检测器。只执行用户要求，不补充解释。",
        user: '只返回 JSON：{"ok":true}',
        temperature: 0,
        maxTokens: credential.vendor === "kimi" ? 512 : 64,
        jsonMode: true,
        timeoutSec: 60,
        label: `${credential.name}·连通性检测`,
        allowWebSearch: false,
      })
      const capabilities: AiCredentialCapability[] = ["chat"]
      if (looksLikeJson(content)) capabilities.push("json")
      models.push({
        model,
        status: "passed",
        capabilities,
        latencyMs: Date.now() - modelStartedAt,
      })
      await recordAiCredentialRouteSuccess(
        buildAiCredentialRouteIdentity(credential, {
          module: routeModule,
          model,
          requiredCapabilities: ["chat"],
        }),
        Date.now() - modelStartedAt,
        options.isProbe === true,
      )
      if (!options.allModels) break
    } catch (error) {
      lastError = error
      await recordAiCredentialRouteFailure(
        buildAiCredentialRouteIdentity(credential, {
          module: routeModule,
          model,
          requiredCapabilities: ["chat"],
        }),
        classifyAiCredentialFailure(error),
        options.isProbe === true,
      )
      models.push({
        model,
        status: "failed",
        capabilities: [],
        latencyMs: Date.now() - modelStartedAt,
        error: sanitizeAiUpstreamMessage(
          error instanceof Error ? error.message : String(error),
          240,
        ),
      })
    }
  }

  const passedModels = models.filter(item => item.status === "passed")
  if (passedModels.length > 0) {
    const preferred = passedModels[0]
    const prioritized = await prioritizeAiCredentialModel(
      credential.id,
      preferred.model,
    )
    const verified = new Set<AiCredentialCapability>(
      prioritized.verifiedCapabilities,
    )
    for (const result of passedModels) {
      for (const capability of result.capabilities) verified.add(capability)
    }
    const latencyMs = Date.now() - startedAt
    const updated = await updateAiCredentialHealth(credential.id, {
      status: "healthy",
      verifiedCapabilities: [...verified],
      latencyMs,
      consecutiveFailures: 0,
    })
    const failedCount = models.length - passedModels.length
    return {
      credential: updated,
      message: options.allModels
        ? `基础生成检测完成 · ${passedModels.length}/${models.length} 个型号可用 · ${latencyMs}ms`
        : failedCount > 0
          ? `基础生成检测通过 · ${preferred.model} · 已跳过 ${failedCount} 个失效型号 · ${latencyMs}ms`
          : `基础生成检测通过 · ${preferred.model} · ${latencyMs}ms`,
      models,
    }
  }

  const message = sanitizeAiUpstreamMessage(
    lastError instanceof Error ? lastError.message : String(lastError || ""),
    240,
  )
  const diagnosis = classifyAiCredentialFailure(lastError)
  const credentialFailure = diagnosis.scope === "credential"
  await updateAiCredentialHealth(credential.id, {
    status: credentialFailure
      ? "unhealthy"
      : credential.verifiedCapabilities.includes("chat")
        ? "healthy"
        : "degraded",
    latencyMs: Date.now() - startedAt,
    consecutiveFailures: credentialFailure
      ? credential.consecutiveFailures + 1
      : credential.consecutiveFailures,
    cooldownUntil: credentialFailure
      ? new Date(Date.now() + Math.max(30 * 60_000, diagnosis.cooldownMs)).toISOString()
      : undefined,
  })
  throw new Error(message || "模型账号连通性检测失败")
}
