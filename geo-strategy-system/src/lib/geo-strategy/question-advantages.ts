import type { GeoStrategyPlan, QuestionItem } from "@/types/geo-strategy"

function cleanText(value: unknown): string {
  return String(value ?? "").trim()
}

function normalizeKey(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase()
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const text = cleanText(value)
    const key = normalizeKey(text)
    if (!text || seen.has(key)) continue
    seen.add(key)
    result.push(text)
  }
  return result
}

function textParts(question: Partial<QuestionItem>): string {
  return [
    question.question,
    question.keyword,
    question.category,
    question.intent,
    question.content_angle,
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ")
}

function tokenSet(value: string): Set<string> {
  const tokens = new Set<string>()
  const normalized = normalizeKey(value)
  const wordParts = value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .map(item => item.trim())
    .filter(item => item.length >= 2)

  for (const part of wordParts) tokens.add(part)
  for (let size = 2; size <= 4; size++) {
    for (let index = 0; index <= normalized.length - size; index++) {
      const gram = normalized.slice(index, index + size)
      if (/[\u4e00-\u9fa5]/.test(gram)) tokens.add(gram)
    }
  }
  return tokens
}

function scoreAdvantage(question: Partial<QuestionItem>, advantage: string): number {
  const source = textParts(question)
  const sourceKey = normalizeKey(source)
  const advantageKey = normalizeKey(advantage)
  if (!sourceKey || !advantageKey) return 0

  let score = 0
  if (sourceKey.includes(advantageKey)) score += 100
  if (question.keyword && advantageKey.includes(normalizeKey(question.keyword))) score += 30

  const sourceTokens = tokenSet(source)
  const advantageTokens = tokenSet(advantage)
  for (const token of advantageTokens) {
    if (sourceTokens.has(token)) {
      score += token.length >= 4 ? 6 : 3
    }
  }

  return score
}

function hashText(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}

export function extractQuestionAdvantages(strategy?: Pick<GeoStrategyPlan, "profile"> | null): string[] {
  return uniqueStrings(strategy?.profile?.advantages || [])
}

export function resolveQuestionAdvantage(
  question: Partial<QuestionItem>,
  advantages: string[],
): string {
  const available = uniqueStrings(advantages)
  if (available.length === 0) return ""

  const existing = cleanText(question.matched_advantage)
  if (existing) {
    const existingKey = normalizeKey(existing)
    const exact = available.find(item => normalizeKey(item) === existingKey)
    if (exact) return exact
  }

  let best = ""
  let bestScore = -1
  for (const advantage of available) {
    const score = scoreAdvantage(question, advantage)
    if (score > bestScore) {
      best = advantage
      bestScore = score
    }
  }

  if (bestScore > 0) return best
  const fallbackIndex = hashText(textParts(question)) % available.length
  return available[fallbackIndex] || available[0] || ""
}

export function attachQuestionAdvantages<T extends Partial<QuestionItem>>(
  questions: T[],
  advantages: string[],
): Array<T & { matched_advantage?: string }> {
  const available = uniqueStrings(advantages)
  return questions.map(question => ({
    ...question,
    matched_advantage: resolveQuestionAdvantage(question, available),
  }))
}
