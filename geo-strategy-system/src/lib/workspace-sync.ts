import type { Client, ModelKey } from "@/types"
import {
  normalizeAnalysisSubjectType,
  normalizePersonSubjectProfile,
} from "@/lib/analysis-subject"

export const WORKSPACE_SECTIONS = [
  "core",
  "penetration",
  "research",
  "diagnosis",
  "difficulty",
  "keywordStrategy",
  "articleGeneration",
  "jobs",
] as const

export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number]
export type WorkspaceVersions = Record<WorkspaceSection, number>

export type SyncedClient = {
  client: Client
  versions: WorkspaceVersions
}

export class WorkspaceValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WorkspaceValidationError"
  }
}

const SECTION_FIELDS = {
  core: [
    "name",
    "subjectType",
    "personProfile",
    "ourBrand",
    "brandAliases",
    "industry",
    "website",
    "questions",
    "competitors",
    "selectedModels",
  ],
  penetration: ["penetration"],
  research: [
    "research",
    "competitorCompare",
    "researchSourceMode",
    "researchManualInput",
    "competitorCompareSourceMode",
    "competitorCompareCustomCompetitors",
    "competitorCompareSelectedCompetitors",
  ],
  diagnosis: ["diagnosis"],
  difficulty: ["difficultyAssessments"],
  keywordStrategy: ["keywordStrategy"],
  articleGeneration: ["articleGeneration"],
  jobs: ["penetrationJobId", "difficultyJobId", "backgroundJobs"],
} as const satisfies Record<WorkspaceSection, readonly (keyof Client)[]>

const MUTABLE_FIELDS = new Set<keyof Client>(
  Object.values(SECTION_FIELDS).flat() as (keyof Client)[],
)

const FIELD_SECTION = new Map<keyof Client, WorkspaceSection>()
for (const section of WORKSPACE_SECTIONS) {
  for (const field of SECTION_FIELDS[section]) FIELD_SECTION.set(field, section)
}

const MODEL_KEYS = new Set<ModelKey>([
  "doubao",
  "deepseek",
  "qwen",
  "kimi",
  "ernie",
  "hunyuan",
])

export function emptyWorkspaceVersions(): WorkspaceVersions {
  return Object.fromEntries(WORKSPACE_SECTIONS.map(section => [section, 0])) as WorkspaceVersions
}

export function normalizeWorkspaceVersions(value: unknown): WorkspaceVersions {
  const versions = emptyWorkspaceVersions()
  if (!value || typeof value !== "object" || Array.isArray(value)) return versions
  const input = value as Record<string, unknown>
  for (const section of WORKSPACE_SECTIONS) {
    const version = Number(input[section])
    versions[section] = Number.isInteger(version) && version >= 0 ? version : 0
  }
  return versions
}

export function sectionForClientField(field: keyof Client): WorkspaceSection | null {
  return FIELD_SECTION.get(field) || null
}

export function sectionsForClientPatch(
  patch: Partial<Client>,
  unsetFields: readonly (keyof Client)[] = [],
): WorkspaceSection[] {
  const sections = new Set<WorkspaceSection>()
  for (const field of [...Object.keys(patch), ...unsetFields] as (keyof Client)[]) {
    const section = sectionForClientField(field)
    if (section) sections.add(section)
  }
  return [...sections]
}

export function pickSectionData(client: Client, section: WorkspaceSection): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const field of SECTION_FIELDS[section]) {
    const value = client[field]
    if (value !== undefined) data[field] = value
  }
  return data
}

export function splitClientData(client: Client): Record<WorkspaceSection, Record<string, unknown>> {
  const sections = Object.fromEntries(
    WORKSPACE_SECTIONS.map(section => [section, pickSectionData(client, section)]),
  ) as Record<WorkspaceSection, Record<string, unknown>>
  sections.core.id = client.id
  sections.core.createdAt = client.createdAt
  sections.core.updatedAt = client.updatedAt
  return sections
}

export function composeClientData(
  sections: Partial<Record<WorkspaceSection, Record<string, unknown>>>,
): Client {
  const merged: Record<string, unknown> = {}
  for (const section of WORKSPACE_SECTIONS) Object.assign(merged, sections[section] || {})
  return normalizeClientPayload(merged)
}

export function filterClientPatch(value: unknown): Partial<Client> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  for (const field of MUTABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) patch[field] = input[field]
  }
  if (Object.prototype.hasOwnProperty.call(patch, "name")) {
    const name = String(patch.name || "").trim().slice(0, 160)
    if (!name) delete patch.name
    else patch.name = name
  }
  return patch as Partial<Client>
}

export function filterUnsetFields(value: unknown): (keyof Client)[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => String(item) as keyof Client)
    .filter(field => MUTABLE_FIELDS.has(field))
}

export function normalizeClientPayload(value: unknown): Client {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceValidationError("客户数据格式无效")
  }
  const input = value as Record<string, unknown>
  const id = String(input.id || "").trim().slice(0, 128)
  const name = String(input.name || "").trim().slice(0, 160)
  if (!id || !name) throw new WorkspaceValidationError("客户 ID 和名称不能为空")

  const now = new Date().toISOString()
  const client: Client = {
    id,
    name,
    subjectType: normalizeAnalysisSubjectType(input.subjectType),
    personProfile: normalizePersonSubjectProfile(input.personProfile),
    ourBrand: String(input.ourBrand || "").slice(0, 300),
    brandAliases: stringArray(input.brandAliases, 100, 300),
    industry: String(input.industry || "").slice(0, 300),
    website: String(input.website || "").slice(0, 2_000),
    questions: stringArray(input.questions, 5_000, 10_000),
    competitors: stringArray(input.competitors, 1_000, 500),
    selectedModels: modelArray(input.selectedModels),
    createdAt: validIso(input.createdAt) || now,
    updatedAt: validIso(input.updatedAt) || now,
  }

  for (const field of MUTABLE_FIELDS) {
    if (field in client || !Object.prototype.hasOwnProperty.call(input, field)) continue
    ;(client as unknown as Record<string, unknown>)[field] = input[field]
  }
  return client
}

function stringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, maxItems)
    .map(item => String(item || "").trim().slice(0, maxLength))
    .filter(Boolean)
}

function modelArray(value: unknown): ModelKey[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(String).filter(item => MODEL_KEYS.has(item as ModelKey)))] as ModelKey[]
}

function validIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}
