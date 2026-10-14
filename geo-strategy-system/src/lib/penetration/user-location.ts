import type { PenetrationUserLocation } from "@/types"

export const MAX_PENETRATION_SAMPLES_PER_QUESTION = 3

function cleanPlace(value: unknown): string | undefined {
  const text = String(value ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s·-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20)
  return text || undefined
}

/** Province and city of the simulated asker; undefined when neither is set. */
export function normalizePenetrationUserLocation(value: unknown): PenetrationUserLocation | undefined {
  if (!value || typeof value !== "object") return undefined
  const input = value as Record<string, unknown>
  const region = cleanPlace(input.region)
  const city = cleanPlace(input.city)
  if (!region && !city) return undefined
  return { ...(region ? { region } : {}), ...(city ? { city } : {}) }
}

export function normalizePenetrationSamplesPerQuestion(value: unknown): number {
  const count = Math.floor(Number(value))
  if (!Number.isFinite(count) || count < 1) return 1
  return Math.min(MAX_PENETRATION_SAMPLES_PER_QUESTION, count)
}

/**
 * Repeats every question so each repetition is its own independent sample.
 * Real users get different answers to the same question; one sample per
 * question makes "were we mentioned" a coin toss.
 */
export function expandPenetrationQuestionSamples(questions: string[], samples: number): string[] {
  if (samples <= 1) return questions
  return questions.flatMap(question => Array.from({ length: samples }, () => question))
}

/** Each repeated question once, for scoring the question set rather than the samples. */
export function distinctPenetrationQuestions(questions: string[]): string[] {
  return [...new Set(questions.map(question => question.trim()).filter(Boolean))]
}
