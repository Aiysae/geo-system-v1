import type {
  ModelKey,
  PenetrationByModel,
  PenetrationEntityExtractionSummary,
  PenetrationMentionedEntity,
} from "@/types"

export const PENETRATION_ENTITY_EXTRACTION_VERSION = 2 as const

export interface PenetrationJudgeEntry {
  id: string
  answer: string
}

export interface PenetrationJudgeBatchItem {
  id: string
  mentionedBrands: string[]
  mentionedEntities: PenetrationMentionedEntity[]
  topRecommended: string | null
}

export interface PenetrationJudgeBatchValidation {
  ok: boolean
  items: PenetrationJudgeBatchItem[]
  missingIds: string[]
  unexpectedIds: string[]
  duplicateIds: string[]
}

export function buildJudgeEntryBatches<T extends PenetrationJudgeEntry>(
  entries: T[],
  options: { maxItems: number; maxCharacters: number },
): T[][] {
  const maxItems = Math.max(1, Math.floor(options.maxItems))
  const maxCharacters = Math.max(1, Math.floor(options.maxCharacters))
  const batches: T[][] = []
  let current: T[] = []
  let currentCharacters = 0

  for (const entry of entries) {
    const entryCharacters = Math.max(1, entry.answer.length)
    const exceedsItemLimit = current.length >= maxItems
    const exceedsCharacterLimit = current.length > 0
      && currentCharacters + entryCharacters > maxCharacters

    if (exceedsItemLimit || exceedsCharacterLimit) {
      batches.push(current)
      current = []
      currentCharacters = 0
    }

    current.push(entry)
    currentCharacters += entryCharacters
  }

  if (current.length > 0) batches.push(current)
  return batches
}

export function validateJudgeBatchItems(
  entries: PenetrationJudgeEntry[],
  items: PenetrationJudgeBatchItem[],
): PenetrationJudgeBatchValidation {
  const expectedIds = new Set(entries.map(entry => entry.id))
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.id, (counts.get(item.id) || 0) + 1)

  const missingIds = entries
    .map(entry => entry.id)
    .filter(id => !counts.has(id))
  const unexpectedIds = Array.from(counts.keys()).filter(id => !expectedIds.has(id))
  const duplicateIds = Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([id]) => id)

  return {
    ok: missingIds.length === 0 && unexpectedIds.length === 0 && duplicateIds.length === 0,
    items,
    missingIds,
    unexpectedIds,
    duplicateIds,
  }
}

export function isPenetrationExtractionUsable(item: {
  extraction?: { status?: string }
  judgeError?: unknown
}): boolean {
  if (item.extraction) return item.extraction.status === "succeeded"
  // Legacy records predate explicit extraction state. A recorded judge error means
  // their target-only fallback must not be presented as a complete brand ranking.
  return !item.judgeError
}

export function buildPenetrationExtractionSummary(
  byModel: PenetrationByModel,
): PenetrationEntityExtractionSummary {
  let total = 0
  let succeeded = 0
  let failed = 0
  let pending = 0

  for (const items of Object.values(byModel)) {
    for (const item of items || []) {
      if (!item.answer?.trim()) continue
      total += 1
      if (item.extraction?.status === "succeeded") succeeded += 1
      else if (item.extraction?.status === "failed") failed += 1
      else if (item.extraction?.status === "pending") pending += 1
      else if ((item as typeof item & { judgeError?: unknown }).judgeError) failed += 1
      else succeeded += 1
    }
  }

  const status: PenetrationEntityExtractionSummary["status"] = pending > 0
    ? "pending"
    : failed === 0
      ? "complete"
      : succeeded === 0
        ? "failed"
        : "partial"

  return {
    status,
    total,
    succeeded,
    failed,
    pending,
    version: PENETRATION_ENTITY_EXTRACTION_VERSION,
  }
}

export function orderJudgeCandidates(
  candidates: ModelKey[],
  activeAnswerModels: ModelKey[] = [],
): ModelKey[] {
  const unique = Array.from(new Set(candidates))
  const active = new Set(activeAnswerModels)
  return [
    ...unique.filter(model => !active.has(model)),
    ...unique.filter(model => active.has(model)),
  ]
}
