import "server-only"

import { buildAiChatUrl } from "@/lib/ai-settings"
import {
  hasAiCredentialCandidate,
  recordAiCredentialFailure,
  recordAiCredentialSuccess,
  resolveAiCredentialModel,
  tryAcquireAiCredential,
} from "@/lib/ai-credential-router"
import { openaiCompatChat, type ChatArgs } from "@/lib/llm/openai-compat"
import type {
  AiCredentialCapability,
  AiCredentialModule,
  AiCredentialVendor,
} from "@/types/ai-credentials"

interface LegacyChatRoute {
  url: string
  apiKey: string
  label: string
}

export interface CredentialPoolChatInput {
  vendor: AiCredentialVendor
  module: AiCredentialModule
  model: string
  legacy: LegacyChatRoute
  chat: ChatArgs
  authType?: "bearer" | "x-api-key"
  extraBody?: Record<string, unknown>
  extraHeaders?: Record<string, string>
  images?: string[]
  maxCredentialAttempts?: number
  waitTimeoutMs?: number
  leaseSeconds?: number
  requiredCapabilities?: AiCredentialCapability[]
}

function shouldTryNextCredential(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "")
  return /(401|403|408|425|429|500|502|503|504|invalid.*key|unauthorized|forbidden|timeout|timed out|超时|连接失败|fetch failed|network|socket|temporar|余额不足|欠费|无权限|返回空内容)/i.test(message)
}

async function callRoute(
  input: CredentialPoolChatInput,
  route: LegacyChatRoute,
  model = input.model,
): Promise<string> {
  return openaiCompatChat({
    ...input.chat,
    url: route.url,
    apiKey: route.apiKey,
    authType: input.authType,
    model,
    label: route.label,
    extraBody: input.extraBody,
    extraHeaders: input.extraHeaders,
    images: input.images,
  })
}

export async function runCredentialPoolChat(
  input: CredentialPoolChatInput,
): Promise<string> {
  const excludedCredentialIds: string[] = []
  const maxAttempts = Math.max(1, Math.min(5, input.maxCredentialAttempts ?? 3))
  let lastError: unknown
  const requiredCapabilities = input.requiredCapabilities
    ?? [input.chat.jsonMode ? "json" : "chat"]
  const preferredRequest = {
    vendor: input.vendor,
    module: input.module,
    model: input.model,
    requiredCapabilities,
  }
  const selectionModel = input.model
    && await hasAiCredentialCandidate(preferredRequest)
    ? input.model
    : undefined

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const lease = await tryAcquireAiCredential({
      vendor: input.vendor,
      module: input.module,
      model: selectionModel,
      requiredCapabilities,
      excludeCredentialIds: excludedCredentialIds,
      waitTimeoutMs: input.waitTimeoutMs,
      leaseSeconds: input.leaseSeconds,
    })
    if (!lease) {
      if (attempt === 0 && input.legacy.apiKey) {
        return callRoute(input, input.legacy)
      }
      break
    }

    excludedCredentialIds.push(lease.credential.id)
    const startedAt = Date.now()
    try {
      const credentialModel = resolveAiCredentialModel(
        lease.credential,
        selectionModel || input.model,
        requiredCapabilities,
      )
      if (!credentialModel) throw new Error(`${input.legacy.label} 可用账号未配置模型`)
      const result = await callRoute(input, {
        url: buildAiChatUrl(lease.credential),
        apiKey: lease.credential.apiKey,
        label: `${input.legacy.label}·${lease.credential.accountLabel}`,
      }, credentialModel)
      await recordAiCredentialSuccess(lease.credential.id, Date.now() - startedAt)
      return result
    } catch (error) {
      lastError = error
      await recordAiCredentialFailure(lease.credential, error)
      if (!shouldTryNextCredential(error)) throw error
      console.warn(
        `[ai-credential-chat] ${input.vendor}/${input.model} 当前账号不可用，尝试下一账号。`,
      )
    } finally {
      await lease.release()
    }
  }

  if (lastError instanceof Error) throw lastError
  if (!input.legacy.apiKey) {
    throw new Error(`${input.legacy.label} API Key 未配置，请在后台管理页补全后重试。`)
  }
  throw new Error(`${input.legacy.label} 暂无可用账号`)
}
