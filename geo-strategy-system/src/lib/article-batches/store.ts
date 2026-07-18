import "server-only"

import { createHash } from "crypto"
import { Pool } from "pg"
import { kv } from "@/lib/kv"
import type {
  AnalysisSubjectType,
  ArticleBatchItemRecord,
  ArticleBatchRecord,
  ArticleGenerationState,
  ArticleModelProviderKey,
  ArticlePromptKey,
} from "@/types"

export type ArticleBatchBasePayload = Pick<
  ArticleGenerationState,
  | "promptKey"
  | "modelProvider"
  | "model"
  | "coreQuestion"
  | "keywords"
  | "region"
  | "business"
  | "advantages"
  | "audience"
  | "extraRequirements"
> & {
  clientName: string
  brandName: string
  subjectType: AnalysisSubjectType
  subjectContext: string
  industry: string
  website: string
}

export interface StoredArticleBatchItem extends ArticleBatchItemRecord {
  jobId?: string
  requestId: string
  markdown?: string
  fallbackMarkdown?: string
  artifactPath?: string
}

export interface StoredArticleBatch extends Omit<ArticleBatchRecord, "items"> {
  ownerUserId: string
  requestId: string
  cancelRequested?: boolean
  basePayload: ArticleBatchBasePayload
  items: StoredArticleBatchItem[]
}

type ArticleBatchGlobal = typeof globalThis & {
  __geoArticleBatchPool?: Pool
  __geoArticleBatchSchemaPromise?: Promise<unknown>
}

const globalState = globalThis as ArticleBatchGlobal
const BATCH_TTL_SECONDS = 60 * 60 * 24 * 30
const mutationQueues = new Map<string, Promise<void>>()

const ARTICLE_BATCH_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS geo_article_batches_v1 (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, request_id)
);
CREATE INDEX IF NOT EXISTS geo_article_batches_v1_owner_client_created_idx
  ON geo_article_batches_v1 (owner_user_id, client_id, created_at DESC);
`

function backend(): "postgres" | "kv" {
  const configured = String(process.env.ARTICLE_BATCH_STORE || "").trim().toLowerCase()
  if (configured === "kv") return "kv"
  if (configured === "postgres") return "postgres"
  return process.env.DATABASE_URL ? "postgres" : "kv"
}

function pool(): Pool {
  if (globalState.__geoArticleBatchPool) return globalState.__geoArticleBatchPool
  const connectionString = String(process.env.DATABASE_URL || "").trim()
  if (!connectionString) throw new Error("DATABASE_URL is required for article batch storage")
  globalState.__geoArticleBatchPool = new Pool({
    connectionString,
    max: Math.max(1, Math.min(6, Number(process.env.ARTICLE_BATCH_DB_POOL_MAX) || 3)),
    ssl: /^(1|true|yes|on)$/i.test(String(process.env.DATABASE_SSL || ""))
      ? { rejectUnauthorized: false }
      : undefined,
  })
  return globalState.__geoArticleBatchPool
}

async function ensureSchema(): Promise<void> {
  if (backend() !== "postgres") return
  if (!globalState.__geoArticleBatchSchemaPromise) {
    globalState.__geoArticleBatchSchemaPromise = pool().query(ARTICLE_BATCH_SCHEMA_SQL)
  }
  await globalState.__geoArticleBatchSchemaPromise
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24)
}

const batchKey = (id: string) => `geo:article-batches:${id}`
const requestKey = (ownerUserId: string, requestId: string) =>
  `geo:article-batch-requests:${hash(ownerUserId)}:${requestId}`
const indexKey = (ownerUserId: string, clientId: string) =>
  `geo:article-batch-index:${hash(ownerUserId)}:${hash(clientId)}`

function cloneBatch(batch: StoredArticleBatch): StoredArticleBatch {
  return JSON.parse(JSON.stringify(batch)) as StoredArticleBatch
}

function normalizeStoredBatch(value: unknown): StoredArticleBatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const batch = value as StoredArticleBatch
  if (!batch.id || !batch.ownerUserId || !batch.clientId || !Array.isArray(batch.items)) return null
  return cloneBatch(batch)
}

function toPublicItem(item: StoredArticleBatchItem): ArticleBatchItemRecord {
  return {
    id: item.id,
    position: item.position,
    topic: item.topic,
    brief: item.brief,
    status: item.status,
    progressPercent: item.progressPercent,
    stage: item.stage,
    title: item.title,
    fileName: item.fileName,
    error: item.error,
    attempt: item.attempt,
    similarityScore: item.similarityScore,
    generatedAt: item.generatedAt,
    updatedAt: item.updatedAt,
  }
}

export function toPublicArticleBatch(batch: StoredArticleBatch): ArticleBatchRecord {
  return {
    id: batch.id,
    clientId: batch.clientId,
    promptKey: batch.promptKey,
    promptTitle: batch.promptTitle,
    modelProvider: batch.modelProvider,
    model: batch.model,
    topicMode: batch.topicMode,
    similarityRetry: batch.similarityRetry,
    requestedCount: batch.requestedCount,
    completedCount: batch.completedCount,
    failedCount: batch.failedCount,
    cancelledCount: batch.cancelledCount,
    status: batch.status,
    stage: batch.stage,
    error: batch.error,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    finishedAt: batch.finishedAt,
    items: batch.items
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(toPublicItem),
  }
}

async function savePostgres(batch: StoredArticleBatch): Promise<void> {
  await ensureSchema()
  await pool().query(
    `INSERT INTO geo_article_batches_v1
      (id, owner_user_id, client_id, request_id, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz)
     ON CONFLICT (id) DO UPDATE SET
       client_id = EXCLUDED.client_id,
       data = EXCLUDED.data,
       updated_at = EXCLUDED.updated_at`,
    [
      batch.id,
      batch.ownerUserId,
      batch.clientId,
      batch.requestId,
      JSON.stringify(batch),
      batch.createdAt,
      batch.updatedAt,
    ],
  )
}

async function saveKv(batch: StoredArticleBatch): Promise<void> {
  await kv.set(batchKey(batch.id), batch, { ex: BATCH_TTL_SECONDS })
  await kv.set(requestKey(batch.ownerUserId, batch.requestId), batch.id, { ex: BATCH_TTL_SECONDS })
  await kv.sadd(indexKey(batch.ownerUserId, batch.clientId), batch.id)
}

export async function saveStoredArticleBatch(batch: StoredArticleBatch): Promise<void> {
  if (backend() === "postgres") await savePostgres(batch)
  else await saveKv(batch)
}

async function getPostgres(id: string): Promise<StoredArticleBatch | null> {
  await ensureSchema()
  const result = await pool().query<{ data: unknown }>(
    "SELECT data FROM geo_article_batches_v1 WHERE id = $1 LIMIT 1",
    [id],
  )
  return normalizeStoredBatch(result.rows[0]?.data)
}

async function getKv(id: string): Promise<StoredArticleBatch | null> {
  return normalizeStoredBatch(await kv.get<StoredArticleBatch>(batchKey(id)))
}

export async function getStoredArticleBatch(id: string): Promise<StoredArticleBatch | null> {
  return backend() === "postgres" ? getPostgres(id) : getKv(id)
}

export async function getOwnedStoredArticleBatch(
  id: string,
  ownerUserId: string,
): Promise<StoredArticleBatch | null> {
  const batch = await getStoredArticleBatch(id)
  return batch?.ownerUserId === ownerUserId ? batch : null
}

export async function findStoredArticleBatchByRequest(
  ownerUserId: string,
  requestId: string,
): Promise<StoredArticleBatch | null> {
  if (backend() === "postgres") {
    await ensureSchema()
    const result = await pool().query<{ data: unknown }>(
      "SELECT data FROM geo_article_batches_v1 WHERE owner_user_id = $1 AND request_id = $2 LIMIT 1",
      [ownerUserId, requestId],
    )
    return normalizeStoredBatch(result.rows[0]?.data)
  }
  const id = await kv.get<string>(requestKey(ownerUserId, requestId))
  return id ? getKv(id) : null
}

export async function listOwnedStoredArticleBatches(
  ownerUserId: string,
  clientId: string,
  limit = 12,
): Promise<StoredArticleBatch[]> {
  const safeLimit = Math.max(1, Math.min(30, Math.floor(limit)))
  if (backend() === "postgres") {
    await ensureSchema()
    const result = await pool().query<{ data: unknown }>(
      `SELECT data FROM geo_article_batches_v1
       WHERE owner_user_id = $1 AND client_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [ownerUserId, clientId, safeLimit],
    )
    return result.rows
      .map(row => normalizeStoredBatch(row.data))
      .filter((batch): batch is StoredArticleBatch => Boolean(batch))
  }

  const key = indexKey(ownerUserId, clientId)
  const ids = await kv.smembers<string[]>(key)
  const loaded = await Promise.all(ids.map(id => getKv(id)))
  const missing = ids.filter((_, index) => !loaded[index])
  if (missing.length > 0) await kv.srem(key, ...missing)
  return loaded
    .filter((batch): batch is StoredArticleBatch => Boolean(batch?.ownerUserId === ownerUserId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, safeLimit)
}

export async function mutateStoredArticleBatch<T>(
  id: string,
  mutate: (batch: StoredArticleBatch) => Promise<T> | T,
): Promise<{ batch: StoredArticleBatch; result: T } | null> {
  if (backend() === "postgres") {
    await ensureSchema()
    const db = await pool().connect()
    try {
      await db.query("BEGIN")
      const selected = await db.query<{ data: unknown }>(
        "SELECT data FROM geo_article_batches_v1 WHERE id = $1 FOR UPDATE",
        [id],
      )
      const batch = normalizeStoredBatch(selected.rows[0]?.data)
      if (!batch) {
        await db.query("ROLLBACK")
        return null
      }
      const result = await mutate(batch)
      batch.updatedAt = new Date().toISOString()
      await db.query(
        `UPDATE geo_article_batches_v1
         SET data = $2::jsonb, updated_at = $3::timestamptz
         WHERE id = $1`,
        [id, JSON.stringify(batch), batch.updatedAt],
      )
      await db.query("COMMIT")
      return { batch, result }
    } catch (error) {
      await db.query("ROLLBACK")
      throw error
    } finally {
      db.release()
    }
  }

  const previous = mutationQueues.get(id) || Promise.resolve()
  let release: () => void = () => undefined
  const current = new Promise<void>(resolve => {
    release = resolve
  })
  const queued = previous.catch(() => undefined).then(() => current)
  mutationQueues.set(id, queued)

  await previous.catch(() => undefined)
  try {
    const batch = await getStoredArticleBatch(id)
    if (!batch) return null
    const result = await mutate(batch)
    batch.updatedAt = new Date().toISOString()
    await saveStoredArticleBatch(batch)
    return { batch, result }
  } finally {
    release()
    if (mutationQueues.get(id) === queued) mutationQueues.delete(id)
  }
}

export function createStoredArticleBatchInput(args: {
  id: string
  ownerUserId: string
  clientId: string
  requestId: string
  promptKey: ArticlePromptKey
  promptTitle: string
  modelProvider: ArticleModelProviderKey
  model: string
  topicMode: StoredArticleBatch["topicMode"]
  similarityRetry: boolean
  basePayload: ArticleBatchBasePayload
  items: StoredArticleBatchItem[]
}): StoredArticleBatch {
  const now = new Date().toISOString()
  return {
    id: args.id,
    ownerUserId: args.ownerUserId,
    clientId: args.clientId,
    requestId: args.requestId,
    promptKey: args.promptKey,
    promptTitle: args.promptTitle,
    modelProvider: args.modelProvider,
    model: args.model,
    topicMode: args.topicMode,
    similarityRetry: args.similarityRetry,
    requestedCount: args.items.length,
    completedCount: 0,
    failedCount: 0,
    cancelledCount: 0,
    status: "preparing",
    stage: "正在创建独立文章任务",
    createdAt: now,
    updatedAt: now,
    basePayload: args.basePayload,
    items: args.items,
  }
}

export { ARTICLE_BATCH_SCHEMA_SQL }
