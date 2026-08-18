import { hasAdapterCredentialPoolCandidate } from "@/lib/ai-credential-adapter"
import { listAiCredentialRouteHealth } from "@/lib/ai-credential-route-health"
import { listAiCredentialsPublic } from "@/lib/ai-credential-store"
import { MODEL_LABELS } from "@/lib/model-labels"
import type { ModelKey } from "@/types"

export interface PenetrationModelReadiness {
  model: ModelKey
  ready: boolean
  reason?: string
}

export async function getPenetrationModelReadiness(
  model: ModelKey,
): Promise<PenetrationModelReadiness> {
  try {
    const poolReady = await hasAdapterCredentialPoolCandidate(model, "penetration", {
      system: "",
      user: "",
      mode: "consumer",
      forceWebSearch: true,
      rawQuestionOnly: true,
      requireWebEvidence: true,
      officialWebOnly: true,
    })
    if (poolReady) return { model, ready: true }
  } catch (error) {
    console.warn(
      "[penetration-readiness] failed to inspect verified credential pool",
      model,
      error instanceof Error ? error.message : String(error),
    )
  }

  try {
    const dependencyVendors = model === "kimi" || model === "deepseek"
      ? new Set([model, "ernie"])
      : new Set([model])
    const credentials = (await listAiCredentialsPublic()).filter(
      credential => credential.enabled && dependencyVendors.has(credential.vendor),
    )
    const routes = (await listAiCredentialRouteHealth(
      credentials.map(credential => credential.id),
    )).filter(route => route.module === "penetration")
    if (routes.some(route => route.state === "half_open")) {
      return {
        model,
        ready: false,
        reason: `${MODEL_LABELS[model]}服务通道正在自动复检，请稍后重试`,
      }
    }
    if (routes.some(route => route.state === "open" || route.state === "degraded")) {
      return {
        model,
        ready: false,
        reason: `${MODEL_LABELS[model]}服务通道正在冷却恢复，系统会自动复检`,
      }
    }
    if (routes.some(route => route.state === "action_required")) {
      return {
        model,
        ready: false,
        reason: `${MODEL_LABELS[model]}服务通道需要管理员处理账号权限或额度`,
      }
    }
  } catch (error) {
    console.warn(
      "[penetration-readiness] failed to inspect route recovery state",
      model,
      error instanceof Error ? error.message : String(error),
    )
  }

  return {
    model,
    ready: false,
    reason: `${MODEL_LABELS[model]}暂无已启用且通过严格联网验证的账号`,
  }
}
