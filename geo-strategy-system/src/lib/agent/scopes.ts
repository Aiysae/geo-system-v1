import { normalizeTeamPermissions, type TeamPermissionKey } from "@/lib/team-permissions"
import type { AgentScope } from "@/types/agent"
import type { TaskCenterModule } from "@/types/task-center"

export const AGENT_SPECIAL_SCOPES = [
  "tasks.view",
  "tasks.cancel",
  "outputs.view",
  "knowledge.view",
  "knowledge.import",
] as const satisfies readonly AgentScope[]

const SPECIAL_SCOPE_SET = new Set<string>(AGENT_SPECIAL_SCOPES)

export const AGENT_CALLABLE_MODULE_SCOPES = [
  "client.view",
  "penetration.view",
  "penetration.execute",
  "research.view",
  "research.execute",
  "diagnosis.view",
  "diagnosis.execute",
  "difficulty.view",
  "difficulty.execute",
  "keyword.view",
  "keyword.execute",
  "article.view",
  "article.execute",
  "article.export",
  "feedback.view",
  "feedback.edit",
  "report.view",
  "report.execute",
  "report.export",
] as const satisfies readonly AgentScope[]

export const ALL_AGENT_SCOPES: readonly AgentScope[] = [
  ...AGENT_CALLABLE_MODULE_SCOPES,
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
    "article.export",
    "feedback.view",
    "report.view",
    "report.export",
    "tasks.view",
    "outputs.view",
  ]),
  operator: normalizeAgentScopes([
    ...AGENT_CALLABLE_MODULE_SCOPES.filter(scope => (
      scope.endsWith(".view")
      || scope.endsWith(".execute")
      || scope.endsWith(".export")
      || scope === "feedback.edit"
    )),
    "tasks.view",
    "tasks.cancel",
    "outputs.view",
  ]),
  full: normalizeAgentScopes([
    ...AGENT_CALLABLE_MODULE_SCOPES,
    "tasks.view",
    "tasks.cancel",
    "outputs.view",
    "knowledge.view",
    "knowledge.import",
  ]),
} as const

export function normalizeAgentScopes(value: unknown): AgentScope[] {
  const input = Array.isArray(value) ? value.map(item => String(item || "").trim()) : []
  const moduleScopes = normalizeTeamPermissions(
    input.filter(item => !SPECIAL_SCOPE_SET.has(item)),
  ) as AgentScope[]
  const specialScopes = input.filter(item => SPECIAL_SCOPE_SET.has(item)) as AgentScope[]
  const normalized = new Set<AgentScope>([...moduleScopes, ...specialScopes])

  if (normalized.has("tasks.cancel")) normalized.add("tasks.view")
  if (normalized.has("knowledge.import")) normalized.add("knowledge.view")
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

export function agentTaskScope(input: {
  kind: string
  module: TaskCenterModule
  action: "view" | "execute"
}): AgentScope {
  if (input.kind === "knowledgeImport") {
    return input.action === "view" ? "knowledge.view" : "knowledge.import"
  }
  return `${input.module}.${input.action}` as AgentScope
}
