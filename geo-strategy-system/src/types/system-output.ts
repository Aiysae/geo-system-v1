export type SystemOutputModule =
  | "penetration"
  | "research"
  | "diagnosis"
  | "difficulty"
  | "keyword"
  | "article"
  | "feedback"

export type SystemOutputKind =
  | "penetration_analysis"
  | "independent_research"
  | "competitor_comparison"
  | "website_diagnosis"
  | "difficulty_assessment"
  | "keyword_extraction"
  | "keyword_advantages"
  | "keyword_strategy"
  | "keyword_website_prompt"
  | "keyword_questions"
  | "article_generation"
  | "article_batch"
  | "feedback_report"

export type SystemOutputStatus =
  | "succeeded"
  | "partial"
  | "failed"
  | "cancelled"

export type SystemOutputSource = "job" | "workspace_backfill"

export type SystemOutputResourceReference =
  | { type: "penetration_history"; id: string }
  | { type: "keyword_question_job"; id: string }
  | { type: "article_batch"; id: string }
  | { type: "feedback_report"; id: string }

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
