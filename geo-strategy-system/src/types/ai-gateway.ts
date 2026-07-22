export type AiGatewayProviderKey = `gateway:${string}`

export type AiGatewayVendor =
  | "openai"
  | "anthropic"
  | "gemini"
  | "doubao"
  | "qwen"
  | "hunyuan"
  | "deepseek"
  | "kimi"
  | "ernie"
  | "relay"

export type AiGatewayPresetKey =
  | Exclude<AiGatewayVendor, "relay">
  | "bai"
  | "openai-compatible"
export type AiGatewayProtocol = "openai_chat" | "openai_responses" | "anthropic_messages" | "gemini_generate"
export type AiGatewayAuthType = "bearer" | "x-api-key" | "query-key"
export type AiGatewayChannel = "official" | "relay"
export type AiGatewayModelFamily = "gpt" | "claude" | "gemini" | "other"
export type AiGatewayHealthStatus = "unchecked" | "healthy" | "unhealthy"
export type AiGatewayModelStatus = "available" | "removed"

export interface AiGatewaySyncSummary {
  added: number
  removed: number
  available: number
  syncedAt: string
}

export interface AiGatewayModel {
  id: string
  displayName: string
  family: AiGatewayModelFamily
  endpointTypes: string[]
  enabled: boolean
  source: "synced" | "manual"
  status: AiGatewayModelStatus
  discoveredAt?: string
  lastSeenAt?: string
  updatedAt: string
}

export interface AiGatewayProviderPublic {
  id: string
  providerKey: AiGatewayProviderKey
  name: string
  preset: AiGatewayPresetKey
  vendor: AiGatewayVendor
  channel: AiGatewayChannel
  protocol: AiGatewayProtocol
  baseUrl: string
  chatPath: string
  modelsPath: string
  modelsUrl?: string
  authType: AiGatewayAuthType
  hasApiKey: boolean
  apiKeyPreview: string
  enabled: boolean
  priority: number
  timeout: number
  maxConcurrency: number
  primaryModel?: string
  models: AiGatewayModel[]
  healthStatus: AiGatewayHealthStatus
  healthMessage?: string
  lastCheckedAt?: string
  lastLatencyMs?: number
  lastSyncSummary?: AiGatewaySyncSummary
  updatedAt: string
}

export interface AiGatewayProviderRuntime extends Omit<AiGatewayProviderPublic, "hasApiKey" | "apiKeyPreview"> {
  apiKey: string
}

export interface AiGatewayArticleOption {
  id: string
  providerKey: AiGatewayProviderKey
  name: string
  models: AiGatewayModel[]
}

export interface AiGatewayPreset {
  key: AiGatewayPresetKey
  vendor: AiGatewayVendor
  channel: AiGatewayChannel
  label: string
  description: string
  baseUrl: string
  chatPath: string
  modelsPath: string
  modelsUrl?: string
  protocol: AiGatewayProtocol
  authType: AiGatewayAuthType
  defaultModel?: string
  configurableBaseUrl?: boolean
  timeout: number
  maxConcurrency: number
}
