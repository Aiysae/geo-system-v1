import type { AiCredentialPublic } from "@/types/ai-credentials"

export interface AiCredentialRepairPatch {
  reason: string
  baseUrl?: string
  chatPath?: string
  allowedModels?: string[]
  priority?: number
}

const DOUBAO_WORKING_MODEL = "doubao-seed-2-0-lite-260215"
const HUNYUAN_TOKENHUB_URL = "https://tokenhub.tencentmaas.com"
const HUNYUAN_WORKING_MODEL = "hy3-preview"

function accountNumber(accountLabel: string): number | undefined {
  const match = accountLabel.match(/(\d+)/)
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

function prioritizeModel(models: string[], model: string): string[] {
  return [model, ...models.filter(item => item !== model)]
}

export function knownAiCredentialRepair(
  credential: AiCredentialPublic,
): AiCredentialRepairPatch | null {
  const number = accountNumber(credential.accountLabel)
  const reasons: string[] = []
  const patch: AiCredentialRepairPatch = { reason: "" }
  if (/^\s*\d+\s*号账号\s*$/.test(credential.accountLabel)) {
    patch.priority = 100
    reasons.push("将同供应商账号归入同优先级加权调度")
  }

  if (credential.vendor === "doubao" && (number === 1 || number === 2)) {
    patch.allowedModels = prioritizeModel(
      credential.allowedModels,
      DOUBAO_WORKING_MODEL,
    )
    reasons.push("将已实测可用的豆包模型设为首选")
  }

  if (credential.vendor === "hunyuan" && (number === 1 || number === 2)) {
    patch.baseUrl = HUNYUAN_TOKENHUB_URL
    patch.chatPath = "/v1/chat/completions"
    patch.allowedModels = prioritizeModel(
      credential.allowedModels,
      HUNYUAN_WORKING_MODEL,
    )
    reasons.push("将混元 1/2 号 TokenHub Key 指向已实测可用的兼容接口")
  }

  if (reasons.length === 0) return null
  patch.reason = reasons.join("；")
  return patch
}
