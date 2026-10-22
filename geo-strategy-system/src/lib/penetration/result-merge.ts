import { aggregatePenetration } from "@/lib/score-utils"
import { buildPenetrationExtractionSummary } from "@/lib/penetration/entity-extraction"
import { normalizePenetrationQuestionIntentHints } from "@/lib/penetration/sample-design"
import type {
  AnalysisSubjectType,
  ModelKey,
  PenetrationByModel,
  PenetrationItem,
  PenetrationJobOperation,
  PenetrationModelRerunRecord,
  PenetrationQuestionIntentHint,
  PenetrationResult,
} from "@/types"

export function mergePenetrationByModel(
  current: PenetrationByModel,
  incoming: PenetrationByModel,
): PenetrationByModel {
  const merged: PenetrationByModel = {}
  for (const [model, items] of Object.entries(current) as Array<[ModelKey, PenetrationItem[] | undefined]>) {
    if (items?.length) merged[model] = [...items]
  }
  for (const [model, items] of Object.entries(incoming) as Array<[ModelKey, PenetrationItem[] | undefined]>) {
    if (!items?.length) continue
    const target = [...(merged[model] || [])]
    for (const item of items) {
      const existingIndex = item.sampleId
        ? target.findIndex(existing => existing.sampleId === item.sampleId)
        : -1
      if (existingIndex >= 0) target[existingIndex] = item
      else target.push(item)
    }
    merged[model] = target
  }
  return merged
}

export function buildPenetrationBatchResult(args: {
  operation: PenetrationJobOperation
  currentResult?: PenetrationResult
  baseResult?: PenetrationResult
  incomingByModel: PenetrationByModel
  ourBrand: string
  brandAliases: string[]
  competitors: string[]
  subjectType?: AnalysisSubjectType
  generatedAt: string
  plannedQuestions?: string[]
  questionIntents?: PenetrationQuestionIntentHint[]
  plannedSlots?: number
  modelCount?: number
}): PenetrationResult {
  const existingByModel = args.currentResult?.byModel
    || (args.operation === "append" ? args.baseResult?.byModel : undefined)
    || {}
  const byModel = mergePenetrationByModel(existingByModel, args.incomingByModel)
  const existingQuestionIntents = args.currentResult?.questionIntents
    || (args.operation === "append" ? args.baseResult?.questionIntents : undefined)
    || []
  const questionIntents = normalizePenetrationQuestionIntentHints([
    ...existingQuestionIntents,
    ...(args.questionIntents || []),
  ])
  return {
    byModel,
    aggregated: aggregatePenetration(
      byModel,
      args.ourBrand,
      args.brandAliases,
      args.competitors,
      args.subjectType || "brand",
      {
        plannedQuestions: args.plannedQuestions,
        questionIntents,
        plannedSlots: args.plannedSlots,
        modelCount: args.modelCount,
      },
    ),
    extraction: buildPenetrationExtractionSummary(byModel),
    questionIntents,
    generatedAt: args.generatedAt,
  }
}

function questionKey(question: string): string {
  return question.normalize("NFKC").trim().replace(/\s+/gu, " ")
}

/**
 * Replaces one model's answers with those of a re-run and recomputes the
 * report. A question the re-run answered fewer times than before keeps its
 * earlier answers for the gap, so a partly failed re-run leaves no holes;
 * questions the re-run did not cover keep their answers untouched.
 */
export function replacePenetrationModelAnswers(args: {
  base: PenetrationResult
  model: ModelKey
  incoming: PenetrationItem[]
  rerun: Omit<PenetrationModelRerunRecord, "answerCount">
  ourBrand: string
  brandAliases: string[]
  competitors: string[]
  subjectType?: AnalysisSubjectType
  generatedAt: string
}): PenetrationResult {
  const fresh = args.incoming.filter(item => item.answer?.trim())
  const freshByQuestion = new Map<string, PenetrationItem[]>()
  for (const item of fresh) {
    const key = questionKey(item.question)
    freshByQuestion.set(key, [...(freshByQuestion.get(key) || []), item])
  }

  const earlierByQuestion = new Map<string, PenetrationItem[]>()
  for (const item of args.base.byModel[args.model] || []) {
    const key = questionKey(item.question)
    earlierByQuestion.set(key, [...(earlierByQuestion.get(key) || []), item])
  }

  const replaced: PenetrationItem[] = []
  for (const [key, earlier] of earlierByQuestion) {
    const answers = freshByQuestion.get(key) || []
    replaced.push(...answers, ...earlier.slice(answers.length))
    freshByQuestion.delete(key)
  }
  for (const answers of freshByQuestion.values()) replaced.push(...answers)

  const byModel: PenetrationByModel = { ...args.base.byModel, [args.model]: replaced }
  const rebuilt = buildPenetrationBatchResult({
    operation: "replace",
    incomingByModel: byModel,
    ourBrand: args.ourBrand,
    brandAliases: args.brandAliases,
    competitors: args.competitors,
    subjectType: args.subjectType,
    generatedAt: args.generatedAt,
    questionIntents: args.base.questionIntents,
    plannedSlots: args.base.aggregated.plannedSlots ?? args.base.aggregated.totalSlots,
    modelCount: args.base.aggregated.perModelRate.length || Object.keys(byModel).length,
  })
  const record: PenetrationModelRerunRecord = { ...args.rerun, answerCount: fresh.length }
  return {
    ...rebuilt,
    modelReruns: [
      ...(args.base.modelReruns || []).filter(existing => existing.jobId !== record.jobId),
      record,
    ],
  }
}
