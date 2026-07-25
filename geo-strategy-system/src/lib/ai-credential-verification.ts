import "server-only"

import {
  getAiCredentialRuntime,
  updateAiCredentialHealth,
} from "@/lib/ai-credential-store"
import { sanitizeAiUpstreamMessage } from "@/lib/ai-secrets"
import { openaiCompatChat } from "@/lib/llm/openai-compat"
import type {
  AiCredentialCapability,
  AiCredentialPublic,
} from "@/types/ai-credentials"

export interface AiCredentialVerificationResult {
  credential: AiCredentialPublic
  message: string
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
): Promise<AiCredentialVerificationResult> {
  const credential = await getAiCredentialRuntime(credentialId)
  const model = credential.allowedModels[0]
  if (!credential.apiKey) throw new Error("该模型账号尚未配置 API Key")
  if (!model) throw new Error("请先为该账号填写至少一个可用模型")

  const startedAt = Date.now()
  try {
    const content = await openaiCompatChat({
      url: chatUrl(credential.baseUrl, credential.chatPath),
      apiKey: credential.apiKey,
      model,
      system: "你是 API 连通性检测器。只执行用户要求，不补充解释。",
      user: '只返回 JSON：{"ok":true}',
      temperature: 0,
      maxTokens: 64,
      jsonMode: true,
      timeoutSec: 60,
      label: `${credential.name}·连通性检测`,
      allowWebSearch: false,
    })
    const verified = new Set<AiCredentialCapability>(credential.verifiedCapabilities)
    verified.add("chat")
    if (looksLikeJson(content)) verified.add("json")
    const latencyMs = Date.now() - startedAt
    const updated = await updateAiCredentialHealth(credential.id, {
      status: "healthy",
      verifiedCapabilities: [...verified],
      latencyMs,
      consecutiveFailures: 0,
    })
    return {
      credential: updated,
      message: `基础生成检测通过 · ${model} · ${latencyMs}ms`,
    }
  } catch (error) {
    const message = sanitizeAiUpstreamMessage(
      error instanceof Error ? error.message : String(error),
      240,
    )
    await updateAiCredentialHealth(credential.id, {
      status: /(401|403|invalid.*key|unauthorized|forbidden|余额不足|欠费|无权限)/i.test(message)
        ? "unhealthy"
        : "degraded",
      latencyMs: Date.now() - startedAt,
      consecutiveFailures: credential.consecutiveFailures + 1,
      cooldownUntil: new Date(Date.now() + 5 * 60_000).toISOString(),
    })
    throw new Error(message || "模型账号连通性检测失败")
  }
}
