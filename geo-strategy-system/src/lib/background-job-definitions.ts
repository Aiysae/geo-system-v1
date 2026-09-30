import "server-only"

import {
  ARTICLE_PROMPT_PRICE_KEYS,
  estimateFeatureCredits,
  getFeaturePrice,
  type FeaturePriceKey,
} from "@/lib/pricing"
import type { ArticlePromptKey, BackgroundJobKind } from "@/types"

type TaskDefinition = {
  endpoint: string
  featureKey: FeaturePriceKey
  units: number
  label: string
}

export type BackgroundJobEstimate = TaskDefinition & {
  credits: number
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function resolveBackgroundTask(kind: BackgroundJobKind, payload: unknown): TaskDefinition {
  const body = record(payload)
  switch (kind) {
    case "articleGeneration": {
      const promptKey = String(body.promptKey || "") as ArticlePromptKey
      const featureKey = ARTICLE_PROMPT_PRICE_KEYS[promptKey]
      if (!featureKey) throw new Error("请选择有效的文章 Prompt")
      return {
        endpoint: "/api/article-generation",
        featureKey,
        units: 1,
        label: getFeaturePrice(featureKey).label,
      }
    }
    case "queryGeneration": {
      const categoryCounts = record(body.categoryCounts)
      const customUnits = body.allocationMode === "custom"
        ? Object.values(categoryCounts).reduce<number>(
            (sum, value) => sum + Math.max(0, Math.floor(Number(value) || 0)),
            0,
          )
        : 0
      const requestedUnits = customUnits > 0 ? customUnits : Number(body.count) || 28
      const units = Math.min(84, Math.max(1, Math.floor(requestedUnits)))
      return {
        endpoint: "/api/generate-queries",
        featureKey: "legacyQueryGenerateUnit",
        units,
        label: getFeaturePrice("legacyQueryGenerateUnit").label,
      }
    }
    case "research": {
      const featureKey = body.mode === "hypothesis" ? "researchHypothesis" : "researchAi"
      return {
        endpoint: "/api/research",
        featureKey,
        units: 1,
        label: getFeaturePrice(featureKey).label,
      }
    }
    case "diagnosis":
      return {
        endpoint: "/api/diagnose",
        featureKey: "diagnose",
        units: 1,
        label: getFeaturePrice("diagnose").label,
      }
    case "competitorCompare": {
      const competitors = Array.isArray(body.selectedCompetitors)
        ? body.selectedCompetitors.filter(Boolean).slice(0, 5)
        : []
      return {
        endpoint: "/api/competitor-compare",
        featureKey: "competitorCompareUnit",
        units: Math.max(1, competitors.length),
        label: getFeaturePrice("competitorCompareUnit").label,
      }
    }
    case "keywordExtract":
    case "knowledgeImport":
      return {
        endpoint: "/api/geo-strategy/extract",
        featureKey: "keywordExtract",
        units: 1,
        label: getFeaturePrice("keywordExtract").label,
      }
    case "keywordAdvantages":
      return {
        endpoint: "/api/geo-strategy/advantages",
        featureKey: "keywordAdvantages",
        units: 1,
        label: getFeaturePrice("keywordAdvantages").label,
      }
    case "keywordStrategy":
      return {
        endpoint: "/api/geo-strategy/generate",
        featureKey: "keywordStrategyGenerate",
        units: 1,
        label: getFeaturePrice("keywordStrategyGenerate").label,
      }
    case "keywordWebsitePrompt":
      return {
        endpoint: "/api/geo-strategy/website-prompt",
        featureKey: "keywordWebsitePrompt",
        units: 1,
        label: getFeaturePrice("keywordWebsitePrompt").label,
      }
  }
}

export function estimateBackgroundJob(
  kind: BackgroundJobKind,
  payload: unknown,
): BackgroundJobEstimate {
  const definition = resolveBackgroundTask(kind, payload)
  return {
    ...definition,
    credits: estimateFeatureCredits(definition.featureKey, definition.units),
  }
}

export function isBackgroundJobKind(value: unknown): value is BackgroundJobKind {
  return [
    "articleGeneration",
    "queryGeneration",
    "research",
    "diagnosis",
    "competitorCompare",
    "keywordExtract",
    "knowledgeImport",
    "keywordAdvantages",
    "keywordStrategy",
    "keywordWebsitePrompt",
  ].includes(String(value))
}
