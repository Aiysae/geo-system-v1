import "server-only"

import { estimateBackgroundJob, isBackgroundJobKind } from "@/lib/background-jobs"
import { moduleForBackgroundJob } from "@/lib/team-job-modules"
import {
  ARTICLE_PROMPT_PRICE_KEYS,
  estimateFeatureCredits,
  type FeaturePriceKey,
} from "@/lib/pricing"
import type {
  AgentActionName,
  AgentScope,
  BackgroundJobKind,
} from "@/types"

export type AgentActionDefinition = {
  name: AgentActionName
  title: string
  description: string
  idempotent: true
  requiredScope: AgentScope | "dynamic"
  billable: boolean
}

export type AgentActionEstimate = {
  credits: number
  units: number
  label: string
  scope: AgentScope
  clientId: string
  teamId?: string
  requestId: string
}

export const AGENT_ACTIONS: readonly AgentActionDefinition[] = [
  {
    name: "penetration.run",
    title: "运行渗透率情报检测",
    description: "按网页端相同的严格联网、独立采样和品牌裁判规则提交检测任务。",
    idempotent: true,
    requiredScope: "penetration.execute",
    billable: true,
  },
  {
    name: "difficulty.run",
    title: "运行 GEO 难度测评",
    description: "提交难度、周期、内容数量和执行成本测算任务。",
    idempotent: true,
    requiredScope: "difficulty.execute",
    billable: true,
  },
  {
    name: "background.run",
    title: "运行后台业务任务",
    description: "提交独立调研、AI 诊断、关键词策略或单篇文章等现有后台任务。",
    idempotent: true,
    requiredScope: "dynamic",
    billable: true,
  },
  {
    name: "article.batch.run",
    title: "批量生成文章",
    description: "按网页端相同的内容方法论、知识库和质量门禁创建独立文章任务。",
    idempotent: true,
    requiredScope: "article.execute",
    billable: true,
  },
  {
    name: "report.create",
    title: "生成专业报告",
    description: "生成单模块或全链路 PDF 报告，支持默认品牌和已解锁的白标报告。",
    idempotent: true,
    requiredScope: "report.execute",
    billable: true,
  },
] as const

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item || "").trim()).filter(Boolean) : []
}

const MODEL_KEYS = new Set(["doubao", "deepseek", "qwen", "kimi", "ernie", "hunyuan"])

function requestId(value: unknown): string {
  const id = String(value || "").trim()
  if (!/^[A-Za-z0-9_-]{16,160}$/.test(id)) {
    throw new Error("requestId 必须是 16 到 160 位字母、数字、下划线或连字符")
  }
  return id
}

function clientContext(input: Record<string, unknown>): {
  clientId: string
  teamId?: string
  requestId: string
} {
  const clientId = String(input.clientId || "").trim().slice(0, 200)
  if (!clientId) throw new Error("clientId 不能为空")
  const teamId = String(input.teamId || "").trim().slice(0, 200) || undefined
  return { clientId, teamId, requestId: requestId(input.requestId) }
}

function articlePriceKey(value: unknown): FeaturePriceKey {
  const key = String(value || "") as keyof typeof ARTICLE_PROMPT_PRICE_KEYS
  const priceKey = ARTICLE_PROMPT_PRICE_KEYS[key]
  if (!priceKey) throw new Error("文章 Prompt 无效")
  return priceKey
}

function estimateArticleBatch(input: Record<string, unknown>): {
  credits: number
  units: number
  label: string
} {
  const base = record(input.basePayload)
  const count = Math.floor(Number(input.count))
  const minimum = input.topicMode === "strategy" ? 1 : 2
  if (!Number.isFinite(count) || count < minimum || count > 50) {
    throw new Error(input.topicMode === "strategy"
      ? "策略自动成文数量必须在 1 到 50 篇之间"
      : "批量生成数量必须在 2 到 50 篇之间")
  }
  if (input.topicMode === "strategy" && Array.isArray(input.questionTasks)) {
    const tasks = input.questionTasks.slice(0, 50).map(record)
    if (tasks.length !== count) throw new Error("策略文章任务数量与 count 不一致")
    const credits = tasks.reduce((sum, task) => (
      sum + estimateFeatureCredits(articlePriceKey(task.promptKey || base.promptKey))
    ), 0)
    return { credits, units: count, label: `批量文章 × ${count}` }
  }
  const featureKey = articlePriceKey(base.promptKey)
  return {
    credits: estimateFeatureCredits(featureKey, count),
    units: count,
    label: `批量文章 × ${count}`,
  }
}

export function isAgentActionName(value: unknown): value is AgentActionName {
  return AGENT_ACTIONS.some(action => action.name === value)
}

export function estimateAgentAction(
  action: AgentActionName,
  value: unknown,
): AgentActionEstimate {
  const input = record(value)
  const context = clientContext(input)

  switch (action) {
    case "penetration.run": {
      const questions = strings(input.questions)
      const models = Array.from(new Set(strings(input.models)))
      if (questions.length === 0 || models.length === 0) {
        throw new Error("渗透率检测至少需要一个问题和一个模型")
      }
      if (questions.length > 600) throw new Error("渗透率检测单次最多支持 600 个问题")
      if (models.length > 6) throw new Error("渗透率检测单次最多支持 6 个模型")
      if (models.some(model => !MODEL_KEYS.has(model))) throw new Error("渗透率检测包含不支持的模型")
      const units = questions.length * models.length
      return {
        ...context,
        scope: "penetration.execute",
        units,
        credits: estimateFeatureCredits("penetrationSlot", units),
        label: `渗透率检测 ${questions.length} 问题 × ${models.length} 模型`,
      }
    }
    case "difficulty.run": {
      const mode = String(input.mode || "industry")
      const industry = String(input.industry || "").trim()
      if (mode !== "industry" && mode !== "brand") throw new Error("难度测评模式无效")
      if (!industry) throw new Error("难度测评行业不能为空")
      if (mode === "brand" && !String(input.targetBrand || input.brandName || "").trim()) {
        throw new Error("品牌难度测评必须提供目标品牌或人物名称")
      }
      return {
        ...context,
        scope: "difficulty.execute",
        units: 1,
        credits: estimateFeatureCredits("difficultyAssessment"),
        label: "GEO 难度测评",
      }
    }
    case "background.run": {
      const kind = input.kind
      if (!isBackgroundJobKind(kind)) throw new Error("后台任务 kind 无效")
      const estimate = estimateBackgroundJob(kind, input.payload)
      return {
        ...context,
        scope: `${moduleForBackgroundJob(kind as BackgroundJobKind)}.execute`,
        units: estimate.units,
        credits: estimate.credits,
        label: estimate.label,
      }
    }
    case "article.batch.run": {
      const estimate = estimateArticleBatch(input)
      return {
        ...context,
        scope: "article.execute",
        ...estimate,
      }
    }
    case "report.create": {
      const reportInput = record(input.input)
      const branding = record(reportInput.branding)
      const credits = branding.mode === "custom"
        ? estimateFeatureCredits("reportCustomBranding")
        : 0
      return {
        ...context,
        scope: "report.execute",
        units: 1,
        credits,
        label: branding.mode === "custom" ? "白标专业报告" : "专业报告",
      }
    }
  }
}
