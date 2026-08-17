export type AgentModuleKey =
  | "client"
  | "penetration"
  | "research"
  | "diagnosis"
  | "difficulty"
  | "keyword"
  | "article"
  | "feedback"
  | "report"

export type AgentModuleAction = "view" | "execute" | "edit" | "export" | "manage"

export type AgentModuleScope = `${AgentModuleKey}.${AgentModuleAction}`

export type AgentSpecialScope =
  | "tasks.view"
  | "tasks.cancel"
  | "outputs.view"
  | "knowledge.view"
  | "knowledge.import"

export type AgentScope = AgentModuleScope | AgentSpecialScope

export type AgentClientMode = "all" | "selected"
export type AgentTokenStatus = "active" | "revoked"

export type AgentClientGrant = {
  clientId: string
  teamId?: string
}

export type AgentTokenRecord = {
  id: string
  ownerUserId: string
  name: string
  tokenPrefix: string
  scopes: AgentScope[]
  clientMode: AgentClientMode
  clientGrants: AgentClientGrant[]
  status: AgentTokenStatus
  rateLimitPerMinute: number
  dailyCreditLimit: number
  maxTaskCredits: number
  allowedIps: string[]
  expiresAt?: string
  lastUsedAt?: string
  revokedAt?: string
  createdAt: string
  updatedAt: string
}

export type AgentTokenSecret = {
  token: string
  record: AgentTokenRecord
}

export type AgentAuditStatus = "accepted" | "succeeded" | "failed" | "denied"

export type AgentAuditRecord = {
  id: string
  tokenId: string
  ownerUserId: string
  action: string
  method: string
  path: string
  traceId: string
  requestId?: string
  clientId?: string
  teamId?: string
  status: AgentAuditStatus
  httpStatus: number
  estimatedCredits: number
  metadata: Record<string, unknown>
  createdAt: string
}

export type AgentActionName =
  | "penetration.run"
  | "penetration.questions.generate"
  | "penetration.brands.reanalyze"
  | "penetration.automation.get"
  | "penetration.automation.save"
  | "penetration.automation.set-status"
  | "penetration.automation.run"
  | "penetration.automation.delete"
  | "difficulty.run"
  | "research.run"
  | "research.compare"
  | "diagnosis.run"
  | "keyword.extract"
  | "keyword.advantages"
  | "keyword.strategy.run"
  | "keyword.website-prompt.run"
  | "keyword.questions.run"
  | "article.generate"
  | "article.rewrite"
  | "article.strategy.plan"
  | "article.source.extract"
  | "article.brands.analyze"
  | "article.materials.list"
  | "article.materials.import"
  | "article.materials.delete"
  | "article.media.upload"
  | "article.media.run"
  | "knowledge.import"
  | "knowledge.commit"
  | "background.run"
  | "article.batch.run"
  | "feedback.action.create"
  | "feedback.actions.import"
  | "feedback.report.create"
  | "feedback.report.options"
  | "feedback.report.manage"
  | "feedback.profile.update"
  | "feedback.visibility.update"
  | "feedback.automation.get"
  | "feedback.automation.save"
  | "feedback.automation.set-status"
  | "feedback.automation.run"
  | "feedback.automation.retry"
  | "feedback.automation.delete"
  | "feedback.reminder-settings.get"
  | "feedback.reminder-settings.update"
  | "report.create"

export type AgentAccessMode = "admin" | "vip4" | "all"

export type AgentScopePreset = "observer" | "operator" | "full"

export type AgentAccessEligibility = {
  eligible: boolean
  canCreateTokens: boolean
  guideEnabled: boolean
  reason?: string
  mode: AgentAccessMode
  tier: "admin" | "free" | "vip1" | "vip2" | "vip3" | "vip4" | "vip5" | "vip6"
  accountMode: "standard" | "client"
  maxActiveTokens: number
  maxRateLimitPerMinute: number
  allowedPresets: AgentScopePreset[]
}

export type AgentAuthContext = {
  token: AgentTokenRecord
  userId: string
  traceId: string
  ip: string
}

export type AgentApiErrorBody = {
  ok: false
  error: {
    code: string
    message: string
    retryable: boolean
    details?: Record<string, unknown>
  }
  meta: {
    traceId: string
    requestId?: string
  }
}

export type AgentApiSuccess<T> = {
  ok: true
  data: T
  meta: {
    traceId: string
    requestId?: string
    serverTime: string
  }
}
