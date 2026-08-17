import "server-only"

import { hasAiCredentialCandidate } from "@/lib/ai-credential-router"
import {
  isAdapterCredentialConfigured,
} from "@/lib/ai-credential-adapter"
import { getAiProviderRuntimeSetting } from "@/lib/ai-settings"
import { resolveArticleModel } from "@/lib/article-models"
import { configuredDifficultyModels } from "@/lib/difficulty/assessment"
import { isKeywordStrategyWebReady } from "@/lib/geo-strategy/keyword-strategy-research"
import { getPenetrationModelReadiness } from "@/lib/penetration/model-readiness"
import type { AgentActionName } from "@/types/agent"
import type { ModelKey } from "@/types"

export type AgentReadinessCheck = {
  key: string
  label: string
  ready: boolean
  blocking: boolean
  reason?: string
}

export type AgentActionReadiness = {
  ready: boolean
  state: "ready" | "degraded" | "blocked"
  checks: AgentReadinessCheck[]
  warnings: string[]
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function complete(checks: AgentReadinessCheck[]): AgentActionReadiness {
  const blocked = checks.some(check => check.blocking && !check.ready)
  const warnings = checks
    .filter(check => !check.ready && !check.blocking)
    .map(check => check.reason || `${check.label}暂不可用`)
  return {
    ready: !blocked,
    state: blocked ? "blocked" : warnings.length > 0 ? "degraded" : "ready",
    checks,
    warnings,
  }
}

function available(key: string, label: string, ready: boolean, reason?: string, blocking = true): AgentReadinessCheck {
  return { key, label, ready, blocking, ...(reason ? { reason } : {}) }
}

async function pooledOrLegacy(input: {
  vendor: "doubao" | "qwen" | "deepseek"
  module: "question" | "keywordStrategy"
  model?: string
  capabilities: Array<"chat" | "json" | "vision">
  configKey?: "keywordStrategy" | "doubao" | "qwen" | "deepseek"
  label: string
}): Promise<AgentReadinessCheck> {
  const config = await getAiProviderRuntimeSetting(input.configKey || input.vendor)
  const model = String(input.model || config.model || "").trim()
  const poolReady = await hasAiCredentialCandidate({
    vendor: input.vendor,
    module: input.module,
    model,
    requiredCapabilities: input.capabilities,
  })
  const legacyReady = Boolean(config.apiKey && model)
  return available(
    `${input.module}:${input.vendor}`,
    input.label,
    poolReady || legacyReady,
    poolReady || legacyReady ? undefined : `${input.label}账号池和备用 API Key 均未配置`,
  )
}

async function articleReadiness(payload: Record<string, unknown>): Promise<AgentReadinessCheck> {
  const base = record(payload.basePayload)
  const provider = payload.modelProvider || base.modelProvider
  const model = payload.model || base.model
  try {
    const resolved = await resolveArticleModel(provider, model)
    const ready = Boolean(resolved.apiKey && resolved.model)
    return available(
      `article:${resolved.providerKey}`,
      resolved.label,
      ready,
      ready ? undefined : `${resolved.label}缺少可用 API Key 或模型名`,
    )
  } catch (error) {
    return available(
      "article:model",
      "文章模型",
      false,
      error instanceof Error ? error.message : "文章模型配置不可用",
    )
  }
}

async function websitePromptReadiness(payload: Record<string, unknown>): Promise<AgentReadinessCheck> {
  const vendor = payload.kind === "third-party" ? "deepseek" : "qwen"
  return pooledOrLegacy({
    vendor,
    module: "keywordStrategy",
    capabilities: ["chat"],
    label: payload.kind === "third-party" ? "DeepSeek 第三方网站 Prompt" : "通义千问官网 Prompt",
  })
}

async function backgroundReadiness(payload: Record<string, unknown>): Promise<AgentActionReadiness> {
  const kind = String(payload.kind || "")
  const nested = record(payload.payload)
  const mapped: Partial<Record<string, AgentActionName>> = {
    research: "research.run",
    competitorCompare: "research.compare",
    diagnosis: "diagnosis.run",
    keywordExtract: "keyword.extract",
    knowledgeImport: "keyword.extract",
    keywordAdvantages: "keyword.advantages",
    keywordStrategy: "keyword.strategy.run",
    keywordWebsitePrompt: "keyword.website-prompt.run",
    articleGeneration: "article.generate",
  }
  const action = mapped[kind]
  if (!action) {
    return complete([available(
      `background:${kind || "unknown"}`,
      "旧版后台动作",
      true,
      "旧版动作只能执行基础参数检查；建议改用对应专用动作",
      false,
    )])
  }
  return checkAgentActionReadiness(action, nested)
}

export async function checkAgentActionReadiness(
  action: AgentActionName,
  payload: Record<string, unknown>,
): Promise<AgentActionReadiness> {
  if (action === "penetration.run") {
    const models = (Array.isArray(payload.models) ? payload.models : []) as ModelKey[]
    const readiness = await Promise.all(models.map(getPenetrationModelReadiness))
    const checks = readiness.map(item => available(
      `penetration:${item.model}`,
      `${item.model} 严格联网检测`,
      item.ready,
      item.reason,
      false,
    ))
    if (!readiness.some(item => item.ready)) {
      checks.push(available(
        "penetration:any-model",
        "至少一个严格联网检测模型",
        false,
        "所选模型均未通过严格联网预检",
      ))
    }
    return complete(checks)
  }

  if (action === "penetration.questions.generate") {
    return complete([await pooledOrLegacy({
      vendor: "doubao",
      module: "question",
      capabilities: ["json"],
      label: "豆包智能检测问题模型",
    })])
  }

  if (action === "difficulty.run") {
    const selected = String(payload.model || "auto")
    const configured = await configuredDifficultyModels(
      selected === "auto" ? undefined : selected as ModelKey,
    )
    return complete([available(
      "difficulty:model",
      "难度测评模型",
      configured.length > 0,
      configured.length > 0 ? undefined : "难度测评没有可用的模型账号",
    )])
  }

  if (action === "research.run" || action === "research.compare") {
    const ready = await isAdapterCredentialConfigured("doubao", "research", { jsonMode: true })
    return complete([available(
      "research:doubao",
      "豆包独立调研模型",
      ready,
      ready ? undefined : "豆包调研账号池和备用 API Key 均不可用",
    )])
  }

  if (action === "diagnosis.run") {
    const models: ModelKey[] = ["deepseek", "doubao", "qwen", "kimi", "ernie", "hunyuan"]
    const configured = await Promise.all(models.map(async model => (
      isAdapterCredentialConfigured(model, "diagnosis", { jsonMode: true })
    )))
    const enhanced = configured.some(Boolean)
    return complete([available(
      "diagnosis:summary-model",
      "AI 诊断增强摘要",
      enhanced,
      enhanced ? undefined : "没有可用的诊断模型，将只生成网站技术审计，不生成 AI 增强摘要",
      false,
    )])
  }

  if (action === "keyword.extract" || action === "keyword.advantages" || action === "knowledge.import") {
    return complete([await pooledOrLegacy({
      vendor: "qwen",
      module: "keywordStrategy",
      capabilities: ["json"],
      configKey: "keywordStrategy",
      label: "关键词资料提炼模型",
    })])
  }

  if (action === "keyword.strategy.run") {
    const ready = await isKeywordStrategyWebReady()
    return complete([available(
      "keyword:strategy-web",
      "豆包联网关键词策略",
      ready,
      ready ? undefined : "豆包关键词策略联网模型尚未配置完整",
    )])
  }

  if (action === "keyword.website-prompt.run") {
    return complete([await websitePromptReadiness(payload)])
  }

  if (action === "keyword.questions.run") {
    const vendor = payload.questionModelProvider === "qwen" ? "qwen" : "doubao"
    return complete([await pooledOrLegacy({
      vendor,
      module: "question",
      model: String(payload.questionModel || "") || undefined,
      capabilities: ["json"],
      label: vendor === "qwen" ? "通义千问疑问句模型" : "豆包疑问句模型",
    })])
  }

  if (
    action === "article.generate"
    || action === "article.rewrite"
    || action === "article.batch.run"
    || action === "article.production.run"
    || action === "article.strategy.plan"
    || action === "article.brands.analyze"
  ) {
    return complete([await articleReadiness(payload)])
  }

  if (action === "background.run") return backgroundReadiness(payload)

  return complete([])
}
