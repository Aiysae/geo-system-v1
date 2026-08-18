export type AiCredentialVendor =
  | "doubao"
  | "qwen"
  | "hunyuan"
  | "deepseek"
  | "kimi"
  | "ernie"
  | "minimax"
  | "zhipu"

export type AiCredentialCapability =
  | "chat"
  | "json"
  | "long_text"
  | "vision"
  | "native_web"
  | "auditable_sources"

export type AiCredentialModule =
  | "article"
  | "question"
  | "keywordStrategy"
  | "research"
  | "diagnosis"
  | "difficulty"
  | "penetration"
  | "judge"

export type AiCredentialHealthStatus =
  | "unchecked"
  | "healthy"
  | "degraded"
  | "unhealthy"

export type AiCredentialRouteState =
  | "closed"
  | "degraded"
  | "open"
  | "half_open"
  | "action_required"

export type AiCredentialFailureClass =
  | "none"
  | "cancelled"
  | "local_capacity"
  | "request_rejected"
  | "rate_limited"
  | "transient_upstream"
  | "authentication"
  | "billing"
  | "permission"
  | "model_unavailable"
  | "web_evidence"
  | "unknown"

export type AiCredentialFailureScope =
  | "ignored"
  | "route"
  | "capability"
  | "model"
  | "credential"

export interface AiCredentialFailureDiagnosis {
  failureClass: AiCredentialFailureClass
  scope: AiCredentialFailureScope
  code: string
  message: string
  countsTowardCircuit: boolean
  actionRequired: boolean
  retryable: boolean
  cooldownMs: number
}

export interface AiCredentialRouteIdentity {
  credentialId: string
  vendor: AiCredentialVendor
  model: string
  module: AiCredentialModule
  capabilityProfile: string
}

export interface AiCredentialRouteHealth extends AiCredentialRouteIdentity {
  id: string
  state: AiCredentialRouteState
  failureClass: AiCredentialFailureClass
  failureScope: AiCredentialFailureScope
  consecutiveFailures: number
  successCount: number
  failureCount: number
  probeAttempts: number
  lastErrorCode?: string
  lastErrorMessage?: string
  openUntil?: string
  nextProbeAt?: string
  lastProbeAt?: string
  lastSuccessAt?: string
  lastFailureAt?: string
  lastLatencyMs?: number
  createdAt: string
  updatedAt: string
}

export interface AiCredentialRouteContext {
  module: AiCredentialModule
  model?: string
  requiredCapabilities?: AiCredentialCapability[]
  isProbe?: boolean
}

export interface AiCredentialPublic {
  id: string
  vendor: AiCredentialVendor
  name: string
  accountLabel: string
  quotaGroup: string
  baseUrl: string
  chatPath: string
  apiKeyPreview: string
  enabled: boolean
  priority: number
  weight: number
  maxConcurrency: number
  quotaGroupMaxConcurrency: number
  rpmLimit?: number
  tpmLimit?: number
  dailyBudgetCents?: number
  allowedModels: string[]
  allowedModules: AiCredentialModule[]
  declaredCapabilities: AiCredentialCapability[]
  verifiedCapabilities: AiCredentialCapability[]
  verifiedWebModels: string[]
  healthStatus: AiCredentialHealthStatus
  consecutiveFailures: number
  cooldownUntil?: string
  lastCheckedAt?: string
  lastLatencyMs?: number
  createdAt: string
  updatedAt: string
}

export interface AiCredentialRuntime extends AiCredentialPublic {
  apiKey: string
}

export interface AiCredentialSelectionRequest {
  vendor: AiCredentialVendor
  module: AiCredentialModule
  model?: string
  requiredCapabilities?: AiCredentialCapability[]
  excludeCredentialIds?: string[]
  waitTimeoutMs?: number
  leaseSeconds?: number
  estimatedTokens?: number
  estimatedCostCents?: number
  signal?: AbortSignal
}

export interface AiCredentialLease {
  credential: AiCredentialRuntime
  release: () => Promise<void>
}
