import "server-only"

import { randomUUID } from "crypto"
import { Pool } from "pg"
import type { LlmTokenUsage } from "@/lib/llm/openai-compat"

export interface AiUsageEvent {
  credentialId?: string
  usageReported?: boolean
  cachedPromptTokens?: number
  reasoningTokens?: number
  userId: string
  task: string
  providerKey: string
  providerName: string
  modelId: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  latencyMs: number
  success: boolean
  usedFallback: boolean
  error?: string
}

type AiUsageGlobal = typeof globalThis & {
  __geoAiUsagePool?: Pool
  __geoAiUsageSchemaPromise?: Promise<unknown>
}

const globalState = globalThis as AiUsageGlobal
const AI_USAGE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS geo_ai_usage_v1 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  model_id TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  success BOOLEAN NOT NULL,
  used_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS geo_ai_usage_v1_created_idx
  ON geo_ai_usage_v1 (created_at DESC);
CREATE INDEX IF NOT EXISTS geo_ai_usage_v1_provider_model_idx
  ON geo_ai_usage_v1 (provider_key, model_id, created_at DESC);
CREATE INDEX IF NOT EXISTS geo_ai_usage_v1_user_created_idx
  ON geo_ai_usage_v1 (user_id, created_at DESC);
ALTER TABLE geo_ai_usage_v1 ADD COLUMN IF NOT EXISTS credential_id TEXT;
ALTER TABLE geo_ai_usage_v1 ADD COLUMN IF NOT EXISTS usage_reported BOOLEAN;
ALTER TABLE geo_ai_usage_v1 ADD COLUMN IF NOT EXISTS cached_prompt_tokens INTEGER;
ALTER TABLE geo_ai_usage_v1 ADD COLUMN IF NOT EXISTS reasoning_tokens INTEGER;
`

function pool(): Pool | null {
  const connectionString = String(process.env.DATABASE_URL || "").trim()
  if (!connectionString) return null
  if (!globalState.__geoAiUsagePool) {
    globalState.__geoAiUsagePool = new Pool({
      connectionString,
      max: Math.max(1, Math.min(4, Number(process.env.AI_USAGE_DB_POOL_MAX) || 2)),
      ssl: /^(1|true|yes|on)$/i.test(String(process.env.DATABASE_SSL || ""))
        ? { rejectUnauthorized: false }
        : undefined,
    })
  }
  return globalState.__geoAiUsagePool
}

async function ensureSchema(db: Pool): Promise<void> {
  if (!globalState.__geoAiUsageSchemaPromise) {
    globalState.__geoAiUsageSchemaPromise = db.query(AI_USAGE_SCHEMA_SQL).catch(error => {
      globalState.__geoAiUsageSchemaPromise = undefined
      throw error
    })
  }
  await globalState.__geoAiUsageSchemaPromise
}

function safeText(value: unknown, max: number): string {
  return String(value || "")
    .replace(/sk-[A-Za-z0-9_.-]{6,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer ***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
}

function safeInteger(value: unknown): number {
  const parsed = Math.round(Number(value))
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

export async function recordAiUsageQuietly(event: AiUsageEvent): Promise<void> {
  const db = pool()
  if (!db) return
  try {
    await ensureSchema(db)
    await db.query(
      `INSERT INTO geo_ai_usage_v1
        (id, user_id, task, provider_key, provider_name, model_id,
         prompt_tokens, completion_tokens, total_tokens, latency_ms,
         success, used_fallback, error, credential_id, usage_reported,
         cached_prompt_tokens, reasoning_tokens)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        `aiu_${randomUUID().replace(/-/g, "")}`,
        safeText(event.userId, 160),
        safeText(event.task, 80),
        safeText(event.providerKey, 120),
        safeText(event.providerName, 120),
        safeText(event.modelId, 200),
        safeInteger(event.promptTokens),
        safeInteger(event.completionTokens),
        safeInteger(event.totalTokens),
        safeInteger(event.latencyMs),
        event.success,
        event.usedFallback,
        event.error ? safeText(event.error, 300) : null,
        event.credentialId ? safeText(event.credentialId, 160) : null,
        event.usageReported ?? (event.totalTokens !== undefined),
        event.cachedPromptTokens === undefined ? null : safeInteger(event.cachedPromptTokens),
        event.reasoningTokens === undefined ? null : safeInteger(event.reasoningTokens),
      ],
    )
  } catch (error) {
    console.error("[ai-usage] write failed", error instanceof Error ? error.message : String(error))
  }
}

export { AI_USAGE_SCHEMA_SQL }

export function addTokenUsage(previous: LlmTokenUsage | undefined, next: LlmTokenUsage): LlmTokenUsage {
  if (!previous) return next
  return {
    promptTokens: previous.promptTokens + next.promptTokens,
    completionTokens: previous.completionTokens + next.completionTokens,
    totalTokens: previous.totalTokens + next.totalTokens,
    cachedPromptTokens: previous.cachedPromptTokens === undefined || next.cachedPromptTokens === undefined
      ? undefined : previous.cachedPromptTokens + next.cachedPromptTokens,
    reasoningTokens: previous.reasoningTokens === undefined || next.reasoningTokens === undefined
      ? undefined : previous.reasoningTokens + next.reasoningTokens,
  }
}

export async function observeAiUsage<T>(
  event: Pick<AiUsageEvent, "userId" | "task" | "providerKey" | "providerName" | "modelId" | "credentialId" | "usedFallback">,
  run: (onUsage: (usage: LlmTokenUsage) => void) => Promise<T>,
  onUsage?: (usage: LlmTokenUsage) => void,
): Promise<T> {
  const startedAt = Date.now()
  let usage: LlmTokenUsage | undefined
  let success = false
  let errorMessage: string | undefined
  try {
    const result = await run(value => {
      usage = addTokenUsage(usage, value)
      onUsage?.(value)
    })
    success = true
    return result
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    await recordAiUsageQuietly({
      ...event, ...usage, usageReported: Boolean(usage),
      latencyMs: Date.now() - startedAt, success, error: errorMessage,
    })
  }
}
