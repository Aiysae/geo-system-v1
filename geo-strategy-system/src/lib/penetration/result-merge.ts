import { aggregatePenetration } from "@/lib/score-utils"
import type {
  AnalysisSubjectType,
  ModelKey,
  PenetrationByModel,
  PenetrationItem,
  PenetrationJobOperation,
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
  plannedSlots?: number
  modelCount?: number
}): PenetrationResult {
  const existingByModel = args.currentResult?.byModel
    || (args.operation === "append" ? args.baseResult?.byModel : undefined)
    || {}
  const byModel = mergePenetrationByModel(existingByModel, args.incomingByModel)
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
        plannedSlots: args.plannedSlots,
        modelCount: args.modelCount,
      },
    ),
    generatedAt: args.generatedAt,
  }
}
