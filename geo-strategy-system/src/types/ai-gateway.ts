export type AiGatewayProviderKey = `gateway:${string}`

export type AiGatewayPresetKey = "bai" | "openai-compatible"
export type AiGatewayProtocol = "openai_chat"
export type AiGatewayAuthType = "bearer" | "x-api-key"
export type AiGatewayModelFamily = "gpt" | "claude" | "gemini" | "other"
export type AiGatewayHealthStatus = "unchecked" | "healthy" | "unhealthy"

export interface AiGatewayModel {
  id: string
  displayName: string
  family: AiGatewayModelFamily
  endpointTypes: string[]
  enabled: boolean
  source: "synced" | "manual"
  updatedAt: string
}

export interface AiGatewayProviderPublic {
  id: string
  providerKey: AiGatewayProviderKey
  name: string
  preset: AiGatewayPresetKey
  protocol: AiGatewayProtocol
  baseUrl: string
  chatPath: string
  modelsPath: string
  authType: AiGatewayAuthType
  hasApiKey: boolean
  apiKeyPreview: string
  enabled: boolean
  priority: number
  timeout: number
  maxConcurrency: number
  models: AiGatewayModel[]
  healthStatus: AiGatewayHealthStatus
  healthMessage?: string
  lastCheckedAt?: string
  lastLatencyMs?: number
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
  label: string
  description: string
  baseUrl: string
  chatPath: string
  modelsPath: string
  protocol: AiGatewayProtocol
  authType: AiGatewayAuthType
  timeout: number
  maxConcurrency: number
}
