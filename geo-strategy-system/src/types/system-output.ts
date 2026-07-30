export type SystemOutputModule =
  | "penetration"
  | "research"
  | "diagnosis"
  | "difficulty"

export type SystemOutputKind =
  | "penetration_analysis"
  | "independent_research"
  | "competitor_comparison"
  | "website_diagnosis"
  | "difficulty_assessment"

export type SystemOutputStatus =
  | "succeeded"
  | "partial"
  | "failed"
  | "cancelled"

export type SystemOutputSource = "job" | "workspace_backfill"

export type SystemOutputResourceReference = {
  type: "penetration_history"
  id: string
}

export type SystemOutputSummary = {
  title: string
  subjectName: string
  industry?: string
  description?: string
  primaryMetricLabel?: string
  primaryMetricValue?: string
  secondaryMetricLabel?: string
  secondaryMetricValue?: string
  tags?: string[]
}

export interface SystemOutputRecord<
  TRequest = unknown,
  TResult = unknown,
> {
  id: string
  taskId: string
  actorUserId?: string
  clientId: string
  clientName: string
  module: SystemOutputModule
  kind: SystemOutputKind
  status: SystemOutputStatus
  source: SystemOutputSource
  summary: SystemOutputSummary
  request?: TRequest
  result?: TResult
  resource?: SystemOutputResourceReference
  error?: string
  schemaVersion: number
  createdAt: string
  completedAt?: string
  updatedAt: string
}

export type SystemOutputListItem = Omit<
  SystemOutputRecord,
  "request" | "result"
> & {
  hasRequest: boolean
  hasResult: boolean
}

export type SystemOutputListPage = {
  items: SystemOutputListItem[]
  page: number
  pageSize: number
  total: number
  hasMore: boolean
}
