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
  | "pendingReview"
  | "verified"
  | "conflicted"
  | "expired"
  | "archived"

export type GeoKnowledgeSourceKind =
  | "userFile"
  | "officialWebsite"
  | "officialRegistry"
  | "media"
  | "platform"
  | "internal"
  | "other"

export type GeoKnowledgeEntityType =
  | "brand"
  | "person"
  | "company"
  | "product"
  | "service"
  | "organization"
  | "location"
  | "other"

export interface GeoKnowledgeSource {
  id: string
  title: string
  kind: GeoKnowledgeSourceKind
  url?: string
  fileName?: string
  contentHash?: string
  publisher?: string
  publishedAt?: string
  retrievedAt?: string
  updatedAt: string
}

export interface GeoKnowledgeClaim {
  id: string
  assetId?: string
  subjectName: string
  kind: GeoKnowledgeAssetKind
  statement: string
  normalizedKey: string
  evidenceLevel: GeoEvidenceLevel
  status: GeoKnowledgeAssetStatus
  sourceIds: string[]
  tags: string[]
  validFrom?: string
  validUntil?: string
  updatedAt: string
}

export interface GeoKnowledgeEntityRelationship {
  predicate: string
  targetEntityId: string
}

export interface GeoKnowledgeEntity {
  id: string
  type: GeoKnowledgeEntityType
  name: string
  aliases: string[]
  relationships: GeoKnowledgeEntityRelationship[]
  updatedAt: string
}

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
  sourceFileName?: string
  sourceLocator?: string
  importJobId?: string
  updatedAt: string
}

export interface ClientKnowledgeBase {
  schemaVersion: 2
  revision: number
  subjectType: "brand" | "person"
  subjectName: string
  aliases: string[]
  summary: string
  products: string[]
  services: string[]
  audiences: string[]
  regions: string[]
  boundaries: string[]
  entities: GeoKnowledgeEntity[]
  claims: GeoKnowledgeClaim[]
  sources: GeoKnowledgeSource[]
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
  recipeVersion?: string
  methodKey: GeoMethodologyKey
  articleFormat: Exclude<GeoArticleFormatKey, "auto">
  targetPlatform: GeoContentPlatform
  brandLayout: GeoBrandLayout
  titleStrategy: GeoTitleStrategy
  knowledgeAssetIds: string[]
  knowledgeClaimIds?: string[]
  knowledgeSourceIds?: string[]
  knowledgeBaseRevision?: number
  knowledgeRetrievalVersion?: string
  knowledgeContextChars?: number
  knowledgeCandidateCount?: number
  resolutionNotes?: string[]
  compiledAt: string
}
