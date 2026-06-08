import type { ModelKey } from "./index"

export type AiProviderKey = ModelKey | "keywordStrategy"

export interface AiProviderExtraField {
  key: string
  label: string
  placeholder?: string
  inputType?: "text" | "checkbox"
}

export interface AiProviderPublicSetting {
  key: AiProviderKey
  label: string
  description: string
  baseUrl: string
  chatPath: string
  model: string
  timeout: number
  hasApiKey: boolean
  apiKeyPreview: string
  extra: Record<string, string | boolean>
  extraFields: AiProviderExtraField[]
  updatedAt?: string
}

export interface AiProviderRuntimeSetting {
  key: AiProviderKey
  label: string
  baseUrl: string
  chatPath: string
  apiKey: string
  model: string
  timeout: number
  extra: Record<string, string | boolean>
}
