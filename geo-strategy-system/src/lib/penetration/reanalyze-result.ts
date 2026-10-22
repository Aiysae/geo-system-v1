import "server-only"

import { NextRequest } from "next/server"
import { POST as runPenetrationPipeline } from "@/app/api/penetration/route"
import { createInternalApiHeaders } from "@/lib/internal-api"
import {
  buildPenetrationBatchResult,
  failedExtractionAnswers,
  mergeReextractedAnswers,
} from "@/lib/penetration/result-merge"
import type {
  AnalysisSubjectType,
  ModelKey,
  PenetrationByModel,
  PenetrationResult,
  PersonSubjectProfile,
} from "@/types"

type ReanalysisResponse = {
  byModel?: PenetrationByModel
  generatedAt?: string
  judgeModels?: ModelKey[]
  judgeErrors?: Partial<Record<ModelKey, string>>
  error?: string
}

export async function reanalyzePenetrationEntities(args: {
  result: PenetrationResult
  ourBrand: string
  brandAliases: string[]
  competitors: string[]
  subjectType?: AnalysisSubjectType
  personProfile?: PersonSubjectProfile
  /**
   * "failed" re-reads only answers whose brands were never read; "all" reads
   * every answer again. By default only the unread ones, when there are any.
   */
  scope?: "failed" | "all"
}): Promise<{
  result: PenetrationResult
  judgeModels: ModelKey[]
  judgeErrors: Partial<Record<ModelKey, string>>
  /** Answers sent to the judge this time. */
  reread: number
  scope: "failed" | "all"
  /** The answers as the judge returned them, to merge onto a newer report. */
  rereadByModel: PenetrationByModel
}> {
  const unread = failedExtractionAnswers(args.result.byModel)
  const scope = args.scope ?? (Object.keys(unread).length > 0 ? "failed" : "all")
  const sampledByModel: PenetrationByModel = {}
  const models: ModelKey[] = []

  for (const [model, items] of Object.entries(scope === "failed" ? unread : args.result.byModel) as Array<[
    ModelKey,
    PenetrationByModel[ModelKey],
  ]>) {
    if (!items?.length) continue
    const normalizedItems = items.map((item, index) => ({
      ...item,
      sampleId: item.sampleId || `reanalysis_${model}_${index + 1}`,
      extraction: item.answer?.trim()
        ? { status: "pending" as const, attempts: 0, version: 2 as const }
        : item.extraction,
    }))
    sampledByModel[model] = normalizedItems
    models.push(model)
  }

  const questions = Object.values(sampledByModel)
    .map(items => (items || []).map(item => item.question.trim()).filter(Boolean))
    .sort((left, right) => right.length - left.length)[0] || []

  if (models.length === 0 || questions.length === 0) {
    throw new Error("当前报告没有可重新识别的原始联网回答")
  }

  const request = new NextRequest("http://geo-internal/api/penetration", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...createInternalApiHeaders("penetration-job"),
    },
    body: JSON.stringify({
      pipelineStage: "judge",
      sampledByModel,
      models,
      questions,
      ourBrand: args.ourBrand,
      brandAliases: args.brandAliases,
      competitors: args.competitors,
      subjectType: args.subjectType || "brand",
      personProfile: args.personProfile,
    }),
  })
  const response = await runPenetrationPipeline(request)
  const payload = await response.json() as ReanalysisResponse
  if (!response.ok || !payload.byModel) {
    throw new Error(payload.error || "品牌实体重新识别失败")
  }

  const reread = Object.values(sampledByModel).reduce((sum, items) => sum + (items || []).length, 0)
  if (scope === "failed") {
    return {
      result: mergeReextractedAnswers({
        base: args.result,
        incoming: payload.byModel,
        ourBrand: args.ourBrand,
        brandAliases: args.brandAliases,
        competitors: args.competitors,
        subjectType: args.subjectType || "brand",
        generatedAt: payload.generatedAt || new Date().toISOString(),
      }),
      judgeModels: payload.judgeModels || [],
      judgeErrors: payload.judgeErrors || {},
      reread,
      scope,
      rereadByModel: payload.byModel,
    }
  }

  const result = buildPenetrationBatchResult({
    operation: "replace",
    incomingByModel: payload.byModel,
    ourBrand: args.ourBrand,
    brandAliases: args.brandAliases,
    competitors: args.competitors,
    subjectType: args.subjectType || "brand",
    generatedAt: payload.generatedAt || new Date().toISOString(),
    plannedQuestions: questions,
    questionIntents: args.result.questionIntents,
    plannedSlots: args.result.aggregated.plannedSlots
      ?? args.result.aggregated.totalSlots,
    modelCount: args.result.aggregated.perModelRate.length || models.length,
  })

  return {
    result,
    judgeModels: payload.judgeModels || [],
    judgeErrors: payload.judgeErrors || {},
    reread,
    scope,
    rereadByModel: payload.byModel,
  }
}
