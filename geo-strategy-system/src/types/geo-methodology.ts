export type GeoMethodologyKey =
  | "problemSolution"
  | "primaryEvidence"
  | "evidenceStory"
  | "explainer"
  | "industryWhitepaper"
  | "entityKnowledge"
  | "recommendationComparison"

export type GeoContentPlatform =
  | "auto"
  | "universal"
  | "officialSite"
  | "sohu"
  | "toutiao"
  | "netease"
  | "baijiahao"
  | "zhihu"
  | "xiaohongshu"
  | "douyin"

export type GeoBrandLayout =
  | "auto"
  | "singlePrimary"
  | "primaryFourSupporting"
  | "tieredFive"
  | "comparisonMatrix"
  | "topList"

export type GeoArticleFormatKey =
  | "auto"
  | "directAnswerGuide"
  | "primaryEvidenceDossier"
  | "evidenceCaseStory"
  | "professionalExplainer"
  | "industryWhitepaper"
  | "entityKnowledgeProfile"
  | "recommendationRoundup"
  | "fieldReviewQa"
  | "tieredEvaluation"
  | "neutralComparisonReview"
  | "localPitfallGuide"

export type GeoTitleStrategy =
  | "auto"
  | "directAnswer"
  | "audienceScenario"
  | "decisionCriteria"
  | "evidenceHook"
  | "riskAvoidance"
  | "localService"
  | "comparisonMatrix"
  | "tieredList"
  | "marketTrend"
  | "priceTransparency"

export type GeoQueryStyle =
  | "directQuestion"
  | "recommendation"
  | "comparison"
  | "decision"
  | "risk"
  | "scenario"
  | "evidence"
  | "local"
  | "entity"
  | "longTail"

export type GeoKnowledgeAssetKind =
  | "identity"
  | "product"
  | "service"
  | "advantage"
  | "credential"
  | "report"
  | "case"
  | "quote"
  | "pricing"
  | "media"
  | "competitor"
  | "boundary"
  | "other"

export type GeoEvidenceLevel =
  | "official"
  | "primary"
  | "verifiedThirdParty"
  | "ownedRecord"
  | "context"

export type GeoKnowledgeAssetStatus =
  | "provided"
  | "sourceLinked"
  | "reviewed"
  | "archived"

export interface GeoKnowledgeAsset {
  id: string
  kind: GeoKnowledgeAssetKind
  title: string
  content: string
  evidenceLevel: GeoEvidenceLevel
  status: GeoKnowledgeAssetStatus
  sourceUrls: string[]
  tags: string[]
  aliases?: string[]
  subjectName?: string
  occurredAt?: string
  updatedAt: string
}

export interface ClientKnowledgeBase {
  schemaVersion: 1
  subjectType: "brand" | "person"
  subjectName: string
  aliases: string[]
  summary: string
  products: string[]
  services: string[]
  audiences: string[]
  regions: string[]
  boundaries: string[]
  assets: GeoKnowledgeAsset[]
  updatedAt: string
}

export interface ArticleMethodologySelection {
  mode: "auto" | "manual"
  methodKey?: GeoMethodologyKey
  articleFormat: GeoArticleFormatKey
  targetPlatform: GeoContentPlatform
  brandLayout: GeoBrandLayout
  titleStrategy: GeoTitleStrategy
}

export interface ArticleMethodologyTrace {
  version: string
  methodKey: GeoMethodologyKey
  articleFormat: Exclude<GeoArticleFormatKey, "auto">
  targetPlatform: GeoContentPlatform
  brandLayout: GeoBrandLayout
  titleStrategy: GeoTitleStrategy
  knowledgeAssetIds: string[]
  compiledAt: string
}
