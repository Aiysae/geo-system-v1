import type { BackgroundJobKind } from "@/types"
import type { TeamModuleKey } from "@/lib/team-permissions"

const BACKGROUND_JOB_MODULE = {
  articleGeneration: "article",
  queryGeneration: "penetration",
  research: "research",
  diagnosis: "diagnosis",
  competitorCompare: "research",
  keywordExtract: "keyword",
  knowledgeImport: "client",
  keywordAdvantages: "keyword",
  keywordStrategy: "keyword",
  keywordWebsitePrompt: "keyword",
} satisfies Record<BackgroundJobKind, TeamModuleKey>

export function moduleForBackgroundJob(kind: BackgroundJobKind): TeamModuleKey {
  return BACKGROUND_JOB_MODULE[kind]
}
