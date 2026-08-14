import { hasAdapterCredentialPoolCandidate } from "@/lib/ai-credential-adapter"
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

  return {
    model,
    ready: false,
    reason: `${MODEL_LABELS[model]}暂无已启用且通过严格联网验证的账号`,
  }
}
