export const WORKSPACE_NAVIGATION_EVENT = "geo:workspace-navigate"

export const WORKSPACE_MODULES = [
  "penetration",
  "research",
  "diagnosis",
  "difficulty",
  "keyword",
  "article",
  "feedback",
] as const

export type WorkspaceModule = (typeof WORKSPACE_MODULES)[number]

export type WorkspaceNavigationTarget = {
  clientId?: string
  teamId?: string
  module?: WorkspaceModule
  view?: string
  jobId?: string
}

function clean(value: string | null | undefined, max = 240): string | undefined {
  const normalized = String(value || "").trim().slice(0, max)
  return normalized || undefined
}

export function isWorkspaceModule(value: unknown): value is WorkspaceModule {
  return WORKSPACE_MODULES.includes(value as WorkspaceModule)
}

export function parseWorkspaceNavigation(
  input: string | URL | URLSearchParams,
): WorkspaceNavigationTarget {
  const params = input instanceof URLSearchParams
    ? input
    : input instanceof URL
      ? input.searchParams
      : new URL(input, "https://workspace.local").searchParams
  const requestedModule = clean(params.get("module"), 40)
  return {
    ...(clean(params.get("clientId"), 128) ? { clientId: clean(params.get("clientId"), 128) } : {}),
    ...(clean(params.get("teamId"), 128) ? { teamId: clean(params.get("teamId"), 128) } : {}),
    ...(isWorkspaceModule(requestedModule) ? { module: requestedModule } : {}),
    ...(clean(params.get("view"), 80) ? { view: clean(params.get("view"), 80) } : {}),
    ...(clean(params.get("jobId"), 220) ? { jobId: clean(params.get("jobId"), 220) } : {}),
  }
}

export function buildWorkspaceResultUrl(target: WorkspaceNavigationTarget): string {
  const params = new URLSearchParams()
  if (target.clientId) params.set("clientId", target.clientId)
  if (target.teamId) params.set("teamId", target.teamId)
  if (target.module) params.set("module", target.module)
  if (target.view) params.set("view", target.view)
  if (target.jobId) params.set("jobId", target.jobId)
  const query = params.toString()
  return query ? `/workspace?${query}` : "/workspace"
}

export function resolveInitialWorkspaceModule(
  requested: unknown,
  canView: (module: WorkspaceModule) => boolean,
  fallback: WorkspaceModule,
): WorkspaceModule {
  return isWorkspaceModule(requested) && canView(requested) ? requested : fallback
}
