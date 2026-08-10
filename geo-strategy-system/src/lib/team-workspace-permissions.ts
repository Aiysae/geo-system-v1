import "server-only"

import type {
  BackgroundJobKind,
  Client,
} from "@/types"
import type {
  TeamModuleKey,
  TeamPermissionAction,
} from "@/lib/team-permissions"

export type WorkspacePermissionRequirement = {
  module: TeamModuleKey
  action: TeamPermissionAction
}

const BACKGROUND_JOB_MODULE: Record<BackgroundJobKind, TeamModuleKey> = {
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
}

const FIELD_REQUIREMENTS: Partial<Record<keyof Client, WorkspacePermissionRequirement>> = {
  name: { module: "client", action: "edit" },
  subjectType: { module: "client", action: "edit" },
  personProfile: { module: "client", action: "edit" },
  ourBrand: { module: "client", action: "edit" },
  brandAliases: { module: "client", action: "edit" },
  industry: { module: "client", action: "edit" },
  website: { module: "client", action: "edit" },
  competitors: { module: "client", action: "edit" },
  knowledgeBase: { module: "client", action: "edit" },
  questions: { module: "penetration", action: "edit" },
  questionGenerationSettings: { module: "penetration", action: "edit" },
  questionIntentHints: { module: "penetration", action: "edit" },
  selectedModels: { module: "penetration", action: "edit" },
  penetration: { module: "penetration", action: "edit" },
  penetrationJobId: { module: "penetration", action: "execute" },
  research: { module: "research", action: "edit" },
  competitorCompare: { module: "research", action: "edit" },
  researchSourceMode: { module: "research", action: "edit" },
  researchManualInput: { module: "research", action: "edit" },
  competitorCompareSourceMode: { module: "research", action: "edit" },
  competitorCompareCustomCompetitors: { module: "research", action: "edit" },
  competitorCompareSelectedCompetitors: { module: "research", action: "edit" },
  diagnosis: { module: "diagnosis", action: "edit" },
  difficultyAssessments: { module: "difficulty", action: "edit" },
  difficultyJobId: { module: "difficulty", action: "execute" },
  keywordStrategy: { module: "keyword", action: "edit" },
  articleGeneration: { module: "article", action: "edit" },
}

function stable(value: unknown): string {
  if (value === undefined) return "__undefined__"
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function changedBackgroundKinds(
  current: Client["backgroundJobs"],
  next: Client["backgroundJobs"],
): BackgroundJobKind[] {
  const keys = new Set<BackgroundJobKind>([
    ...Object.keys(current || {}) as BackgroundJobKind[],
    ...Object.keys(next || {}) as BackgroundJobKind[],
  ])
  return [...keys].filter(kind => stable(current?.[kind]) !== stable(next?.[kind]))
}

export function workspacePermissionRequirements(input: {
  patch: Partial<Client>
  unsetFields: readonly (keyof Client)[]
  current?: Client
}): WorkspacePermissionRequirement[] {
  const requirements: WorkspacePermissionRequirement[] = []
  const fields = new Set<keyof Client>([
    ...Object.keys(input.patch) as (keyof Client)[],
    ...input.unsetFields,
  ])

  for (const field of fields) {
    if (field === "backgroundJobs") continue
    const requirement = FIELD_REQUIREMENTS[field]
    if (requirement) requirements.push(requirement)
  }

  if (fields.has("backgroundJobs")) {
    const next = input.unsetFields.includes("backgroundJobs")
      ? undefined
      : input.patch.backgroundJobs
    for (const kind of changedBackgroundKinds(input.current?.backgroundJobs, next)) {
      requirements.push({ module: BACKGROUND_JOB_MODULE[kind], action: "execute" })
    }
  }

  const unique = new Map<string, WorkspacePermissionRequirement>()
  for (const requirement of requirements) {
    unique.set(`${requirement.module}.${requirement.action}`, requirement)
  }
  return [...unique.values()]
}
