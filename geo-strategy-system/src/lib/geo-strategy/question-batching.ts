export type QuestionCategoryKey =
  | "weakness_spin"
  | "core_keywords"
  | "secondary_keywords"
  | "pain_scenario"

export interface QuestionAllocationOverride {
  category: QuestionCategoryKey
  count: number
  keywords?: string[]
}

export interface QuestionBatchPlan {
  totalCount: number
  allocationOverrides: QuestionAllocationOverride[]
}

export const QUESTION_BATCH_SIZE = 15

export function buildQuestionBatchPlans(
  counts: Record<QuestionCategoryKey, number>,
): QuestionBatchPlan[] {
  const plans: QuestionBatchPlan[] = []
  const remaining = { ...counts }
  const order: QuestionCategoryKey[] = [
    "weakness_spin",
    "core_keywords",
    "secondary_keywords",
    "pain_scenario",
  ]
  let current: QuestionAllocationOverride[] = []
  let currentTotal = 0

  const flush = () => {
    if (currentTotal <= 0) return
    plans.push({ totalCount: currentTotal, allocationOverrides: current })
    current = []
    currentTotal = 0
  }

  for (const category of order) {
    while (remaining[category] > 0) {
      const capacity = QUESTION_BATCH_SIZE - currentTotal
      if (capacity <= 0) {
        flush()
        continue
      }
      const take = Math.min(capacity, remaining[category])
      current.push({ category, count: take })
      currentTotal += take
      remaining[category] -= take
      if (currentTotal >= QUESTION_BATCH_SIZE) flush()
    }
  }
  flush()
  return plans
}

export function buildPerKeywordBatchPlans(input: {
  counts: Record<QuestionCategoryKey, number>
  keywords: string[]
  questionsPerKeyword: number
}): QuestionBatchPlan[] {
  const plans: QuestionBatchPlan[] = []
  let remainingKeywordCount = input.counts.core_keywords
  const questionsPerKeyword = Math.max(
    1,
    Math.min(30, Math.round(input.questionsPerKeyword || 10)),
  )

  for (const keyword of input.keywords) {
    let remainingForKeyword = Math.min(questionsPerKeyword, remainingKeywordCount)
    while (remainingForKeyword > 0) {
      const count = Math.min(QUESTION_BATCH_SIZE, remainingForKeyword)
      plans.push({
        totalCount: count,
        allocationOverrides: [{
          category: "core_keywords",
          count,
          keywords: [keyword],
        }],
      })
      remainingForKeyword -= count
      remainingKeywordCount -= count
    }
    if (remainingKeywordCount <= 0) break
  }

  if (remainingKeywordCount > 0) {
    plans.push(...buildQuestionBatchPlans({
      weakness_spin: 0,
      core_keywords: remainingKeywordCount,
      secondary_keywords: 0,
      pain_scenario: 0,
    }))
  }
  plans.push(...buildQuestionBatchPlans({
    ...input.counts,
    core_keywords: 0,
  }))
  return plans
}

export function buildQuestionBatchPlan(input: {
  counts: Record<QuestionCategoryKey, number>
  keywordCountMode?: "system" | "custom" | "per_keyword"
  customKeywords?: string[]
  coreKeywords?: string[]
  questionsPerKeyword?: number
}): QuestionBatchPlan[] {
  if (input.keywordCountMode !== "per_keyword") {
    return buildQuestionBatchPlans(input.counts)
  }
  const keywords = (input.customKeywords || []).length > 0
    ? input.customKeywords || []
    : input.coreKeywords || []
  return buildPerKeywordBatchPlans({
    counts: input.counts,
    keywords,
    questionsPerKeyword: input.questionsPerKeyword || 10,
  })
}

export function summarizeQuestionBatchPlan(plans: QuestionBatchPlan[]): {
  totalCount: number
  maxBatchSize: number
  keywordCounts: Record<string, number>
} {
  const keywordCounts: Record<string, number> = {}
  let totalCount = 0
  let maxBatchSize = 0
  for (const plan of plans) {
    totalCount += plan.totalCount
    maxBatchSize = Math.max(maxBatchSize, plan.totalCount)
    for (const allocation of plan.allocationOverrides) {
      for (const keyword of allocation.keywords || []) {
        keywordCounts[keyword] = (keywordCounts[keyword] || 0) + allocation.count
      }
    }
  }
  return { totalCount, maxBatchSize, keywordCounts }
}
