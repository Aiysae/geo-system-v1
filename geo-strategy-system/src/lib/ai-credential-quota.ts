import type { ChatArgs } from "@/lib/llm/openai-compat"

export interface AiCredentialQuotaEstimate {
  estimatedTokens: number
  estimatedCostCents: number
}

const DEFAULT_COST_CENTS_PER_MILLION_TOKENS = 1_000

function configuredCostRate(): number {
  const value = Number(
    process.env.AI_CREDENTIAL_ESTIMATED_COST_CENTS_PER_MILLION_TOKENS,
  )
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_COST_CENTS_PER_MILLION_TOKENS
  }
  return Math.max(1, Math.min(1_000_000, Math.round(value)))
}

export function estimateAiCredentialQuota(
  args: Pick<ChatArgs, "system" | "user" | "maxTokens">,
): AiCredentialQuotaEstimate {
  const promptCharacters = String(args.system || "").length
    + String(args.user || "").length
  const estimatedInputTokens = Math.max(1, promptCharacters)
  const estimatedOutputTokens = Math.max(
    1,
    Math.min(64_000, Math.round(args.maxTokens || 4_096)),
  )
  const estimatedTokens = estimatedInputTokens + estimatedOutputTokens
  const estimatedCostCents = Math.max(
    1,
    Math.ceil(
      estimatedTokens * configuredCostRate() / 1_000_000,
    ),
  )
  return { estimatedTokens, estimatedCostCents }
}
