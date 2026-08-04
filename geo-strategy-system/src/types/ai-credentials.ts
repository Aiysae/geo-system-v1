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
