export type TaskCenterModule =
  | "penetration"
  | "research"
  | "diagnosis"
  | "difficulty"
  | "keyword"
  | "article"
  | "report"

export type TaskCenterSource =
  | "background"
  | "penetration"
  | "difficulty"
  | "question"
  | "articleBatch"
  | "articleMedia"
  | "report"

export type TaskCenterStatus =
  | "queued"
  | "running"
  | "retrying"
  | "succeeded"
  | "partial"
  | "failed"
  | "cancelled"
  | "blocked"

export type TaskCenterScope = "mine" | "workspace"

export interface TaskCenterTask {
  id: string
  source: TaskCenterSource
  sourceJobId: string
  kind: string
  module: TaskCenterModule
  clientId: string
  clientName?: string
  teamId?: string
  title: string
  status: TaskCenterStatus
  progressPercent: number
  stage: string
  error?: string
  resultUrl?: string
  canCancel: boolean
  scope: TaskCenterScope
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  unread: boolean
}

export interface TaskCenterListResponse {
  tasks: TaskCenterTask[]
  activeCount: number
  unreadCount: number
  serverTime: string
  nextCursor?: string
}

export interface TaskCenterClientFilter {
  clientId: string
  teamId?: string
}

export interface TaskCenterListQuery {
  limit?: number
  cursor?: string
  clientId?: string
  teamId?: string
  status?: TaskCenterStatus
  modules?: TaskCenterModule[]
  clientFilters?: TaskCenterClientFilter[]
}

export interface TaskCenterTaskInput {
  source: TaskCenterSource
  sourceJobId: string
  kind: string
  module: TaskCenterModule
  actorUserId: string
  workspaceOwnerUserId: string
  clientId: string
  clientName?: string
  title: string
  status: TaskCenterStatus
  progressPercent: number
  stage: string
  error?: string
  resultUrl?: string
  canCancel?: boolean
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  metadata?: Record<string, unknown>
}

export function isTaskCenterTerminalStatus(status: TaskCenterStatus): boolean {
  return ["succeeded", "partial", "failed", "cancelled", "blocked"].includes(status)
}
