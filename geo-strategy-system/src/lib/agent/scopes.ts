import {
  ALL_TEAM_PERMISSIONS,
  normalizeTeamPermissions,
  type TeamPermissionKey,
} from "@/lib/team-permissions"
import type { AgentScope } from "@/types/agent"

export const AGENT_SPECIAL_SCOPES = [
  "tasks.view",
  "tasks.cancel",
  "outputs.view",
] as const satisfies readonly AgentScope[]

const SPECIAL_SCOPE_SET = new Set<string>(AGENT_SPECIAL_SCOPES)

export const ALL_AGENT_SCOPES: readonly AgentScope[] = [
  ...ALL_TEAM_PERMISSIONS,
  ...AGENT_SPECIAL_SCOPES,
]

export const AGENT_SCOPE_PRESETS = {
  observer: normalizeAgentScopes([
    "client.view",
    "penetration.view",
    "research.view",
    "diagnosis.view",
    "difficulty.view",
    "keyword.view",
    "article.view",
    "feedback.view",
    "report.view",
    "report.export",
    "tasks.view",
    "outputs.view",
  ]),
  operator: normalizeAgentScopes([
    ...ALL_TEAM_PERMISSIONS.filter(scope => !scope.endsWith(".manage")),
    "tasks.view",
    "tasks.cancel",
    "outputs.view",
  ]),
  full: normalizeAgentScopes([
    ...ALL_TEAM_PERMISSIONS,
    "tasks.view",
    "tasks.cancel",
    "outputs.view",
  ]),
} as const

export type AgentScopePreset = keyof typeof AGENT_SCOPE_PRESETS

export function normalizeAgentScopes(value: unknown): AgentScope[] {
  const input = Array.isArray(value) ? value.map(item => String(item || "").trim()) : []
  const moduleScopes = normalizeTeamPermissions(
    input.filter(item => !SPECIAL_SCOPE_SET.has(item)),
  ) as AgentScope[]
  const specialScopes = input.filter(item => SPECIAL_SCOPE_SET.has(item)) as AgentScope[]
  const normalized = new Set<AgentScope>([...moduleScopes, ...specialScopes])

  if (normalized.has("tasks.cancel")) normalized.add("tasks.view")
  if ([...normalized].some(scope => scope.includes(".") && !scope.startsWith("tasks.") && !scope.startsWith("outputs."))) {
    normalized.add("client.view")
  }

  return [...normalized].sort()
}

export function isAgentScope(value: unknown): value is AgentScope {
  return ALL_AGENT_SCOPES.includes(String(value || "") as AgentScope)
}

export function hasAgentScope(
  scopes: readonly AgentScope[],
  required: AgentScope,
): boolean {
  return scopes.includes(required)
}

export function teamPermissionFromAgentScope(scope: AgentScope): TeamPermissionKey | null {
  if (SPECIAL_SCOPE_SET.has(scope)) return null
  return scope as TeamPermissionKey
}
