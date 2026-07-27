import "server-only"

import { sanitizeAiUpstreamMessage } from "@/lib/ai-secrets"
import {
  getAiCredentialRuntime,
  prioritizeAiCredentialModel,
  updateAiCredentialHealth,
} from "@/lib/ai-credential-store"
import { ADAPTERS } from "@/lib/llm"
import type { ModelKey } from "@/types"
import type {
  AiCredentialCapability,
  AiCredentialVendor,
} from "@/types/ai-credentials"
import type { AiCredentialVerificationResult } from "@/lib/ai-credential-verification"
import type { AiCredentialModelVerification } from "@/lib/ai-credential-verification"

const STRICT_WEB_MODEL_BY_VENDOR: Partial<Record<AiCredentialVendor, ModelKey>> = {
  doubao: "doubao",
  qwen: "qwen",
  ernie: "ernie",
  hunyuan: "hunyuan",
  kimi: "kimi",
}

export async function verifyAiCredentialWeb(
  credentialId: string,
  options: { allModels?: boolean } = {},
): Promise<AiCredentialVerificationResult> {
  const credential = await getAiCredentialRuntime(credentialId)
  const modelKey = STRICT_WEB_MODEL_BY_VENDOR[credential.vendor]
  if (!modelKey) throw new Error("该供应商暂不支持可审计的官方联网能力检测")
  if (credential.allowedModels.length === 0) {
    throw new Error("请先为该账号填写至少一个可用模型")
  }
  if (
    !credential.declaredCapabilities.includes("native_web")
    || !credential.declaredCapabilities.includes("auditable_sources")
  ) {
    throw new Error("该账号未声明同时具备官方联网和可审计信源能力")
  }
  if (credential.vendor === "kimi") {
    throw new Error("Kimi 严格联网由 Moonshot 生成与百度搜索双账号承载，请运行完整联网冒烟检测")
  }

  const startedAt = Date.now()
  const models: AiCredentialModelVerification[] = []
  let lastError: unknown
  for (const model of credential.allowedModels) {
    const modelStartedAt = Date.now()
    const sourceUrls = new Set<string>()
    const requestIds = new Set<string>()
    let searchExecuted = false
    try {
      const answer = await ADAPTERS[modelKey].chat({
        system: "",
        user: "请联网查询今天的日期，并给出至少一个可访问的公开网页来源。",
        temperature: 0,
        maxTokens: 512,
        mode: "consumer",
        forceWebSearch: true,
        rawQuestionOnly: true,
        requireWebEvidence: true,
        officialWebOnly: true,
        timeoutSec: 120,
        runtimeOverride: {
          vendor: credential.vendor,
          baseUrl: credential.baseUrl,
          chatPath: credential.chatPath,
          apiKey: credential.apiKey,
          model,
          timeout: 120,
          extra: credential.vendor === "qwen" || credential.vendor === "ernie"
            ? { enableSearch: true }
            : undefined,
        },
        onSearchSources: event => {
          searchExecuted ||= event.searchExecuted === true || event.sources.length > 0
          for (const source of event.sources) {
            if (/^https?:\/\//i.test(source.url)) sourceUrls.add(source.url)
          }
          if (event.providerRequestId?.trim()) requestIds.add(event.providerRequestId.trim())
        },
      })
      if (!answer.trim()) throw new Error("官方联网返回空内容")
      if (!searchExecuted) throw new Error("厂商未确认执行官方联网搜索")
      if (sourceUrls.size === 0) throw new Error("官方联网未返回可点击的网页信源")
      if (requestIds.size === 0) throw new Error("厂商未返回可审计请求编号")
      models.push({
        model,
        status: "passed",
        capabilities: ["chat", "native_web", "auditable_sources"],
        latencyMs: Date.now() - modelStartedAt,
      })
      if (!options.allModels) break
    } catch (error) {
      lastError = error
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
    await prioritizeAiCredentialModel(credential.id, preferred.model)
    const verified = new Set<AiCredentialCapability>(credential.verifiedCapabilities)
    verified.add("chat")
    verified.add("native_web")
    verified.add("auditable_sources")
    const latencyMs = Date.now() - startedAt
    const updated = await updateAiCredentialHealth(credential.id, {
      status: "healthy",
      verifiedCapabilities: [...verified],
      latencyMs,
      consecutiveFailures: 0,
    })
    return {
      credential: updated,
      message: options.allModels
        ? `严格联网检测完成 · ${passedModels.length}/${models.length} 个型号可用 · ${latencyMs}ms`
        : `严格联网检测通过 · ${preferred.model} · ${latencyMs}ms`,
      models,
    }
  }

  const message = sanitizeAiUpstreamMessage(
    lastError instanceof Error ? lastError.message : String(lastError || ""),
    240,
  )
  const verified = credential.verifiedCapabilities.filter(
    capability => capability !== "native_web" && capability !== "auditable_sources",
  )
  await updateAiCredentialHealth(credential.id, {
    status: verified.includes("chat") ? "healthy" : "degraded",
    verifiedCapabilities: verified,
    latencyMs: Date.now() - startedAt,
    consecutiveFailures: credential.consecutiveFailures,
  })
  throw new Error(message || "严格联网能力检测失败")
}
