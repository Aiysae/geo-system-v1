import "server-only"

import { createHash } from "crypto"
import { MODEL_LABELS } from "@/lib/model-labels"
import { normalizePenetrationQuestionIntentHints } from "@/lib/penetration/sample-design"
import type {
  PenetrationAutomationDetectionConfig,
} from "@/lib/penetration/automation-types"
import type { Client, ModelKey } from "@/types"

const MODEL_KEYS = new Set<ModelKey>(Object.keys(MODEL_LABELS) as ModelKey[])

function questions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 600)
}

function models(value: unknown): ModelKey[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .map(item => String(item || "").trim() as ModelKey)
      .filter(item => MODEL_KEYS.has(item)),
  ))
}

function configHash(input: {
  questions: string[]
  questionIntents: PenetrationAutomationDetectionConfig["questionIntents"]
  requestedModels: ModelKey[]
}): string {
  return createHash("sha256").update(JSON.stringify({
    version: 1,
    questions: input.questions,
    questionIntents: input.questionIntents,
    requestedModels: [...input.requestedModels].sort(),
  })).digest("hex")
}

export function buildPenetrationAutomationDetectionConfig(input: {
  client: Client
  questions?: unknown
  questionIntents?: unknown
  requestedModels?: unknown
  capturedAt?: string
}): PenetrationAutomationDetectionConfig {
  const selectedQuestions = questions(
    input.questions === undefined ? input.client.questions : input.questions,
  )
  const selectedModels = models(
    input.requestedModels === undefined ? input.client.selectedModels : input.requestedModels,
  )
  const selectedIntents = normalizePenetrationQuestionIntentHints(
    input.questionIntents === undefined
      ? input.client.questionIntentHints
      : input.questionIntents,
    selectedQuestions,
  )
  const normalized = {
    questions: selectedQuestions,
    questionIntents: selectedIntents,
    requestedModels: selectedModels,
  }
  return {
    version: 1,
    capturedAt: input.capturedAt || new Date().toISOString(),
    ...normalized,
    questionCount: selectedQuestions.length,
    modelCount: selectedModels.length,
    slotCount: selectedQuestions.length * selectedModels.length,
    configHash: configHash(normalized),
  }
}

export function normalizePenetrationAutomationDetectionConfig(
  value: unknown,
): PenetrationAutomationDetectionConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const selectedQuestions = questions(record.questions)
  const selectedModels = models(record.requestedModels)
  if (!selectedQuestions.length || !selectedModels.length) return undefined
  const selectedIntents = normalizePenetrationQuestionIntentHints(
    record.questionIntents,
    selectedQuestions,
  )
  const normalized = {
    questions: selectedQuestions,
    questionIntents: selectedIntents,
    requestedModels: selectedModels,
  }
  return {
    version: 1,
    capturedAt: String(record.capturedAt || "").trim() || new Date().toISOString(),
    ...normalized,
    questionCount: selectedQuestions.length,
    modelCount: selectedModels.length,
    slotCount: selectedQuestions.length * selectedModels.length,
    configHash: configHash(normalized),
  }
}
