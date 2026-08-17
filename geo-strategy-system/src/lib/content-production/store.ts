import "server-only"

import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import type {
  ContentProductionRun,
  ContentProductionRunFilters,
} from "@/types/content-production"

type ProductionRunRow = {
  owner_user_id: string
  id: string
  client_id: string
  plan_id: string
  request_id: string
  created_by_user_id: string
  article_owner_user_id: string
  data: ContentProductionRun
  created_at: string | Date
  updated_at: string | Date
}

type FileState = {
  runs: Record<string, ContentProductionRun>
}

export const CONTENT_PRODUCTION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS geo_content_production_runs_v1 (
  owner_user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  article_owner_user_id TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_user_id, id),
  UNIQUE (owner_user_id, request_id)
);
CREATE INDEX IF NOT EXISTS geo_content_production_runs_v1_client_created_idx
  ON geo_content_production_runs_v1 (owner_user_id, client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS geo_content_production_runs_v1_plan_created_idx
  ON geo_content_production_runs_v1 (owner_user_id, plan_id, created_at DESC);
`

const DEFAULT_FILE_PATH = process.env.NODE_ENV === "production"
  ? "/var/lib/geo-system/content-production-runs.json"
  : path.join(process.cwd(), ".data", "content-production-runs.json")

const globalState = globalThis as typeof globalThis & {
  __geoContentProductionPool?: Pool
  __geoContentProductionSchema?: Promise<void>
  __geoContentProductionFileQueue?: Promise<unknown>
}

function backend(): "postgres" | "file" {
  const configured = String(process.env.CONTENT_PRODUCTION_STORE || "").trim().toLowerCase()
  if (configured === "postgres" || configured === "file") return configured
  if (configured) throw new Error(`Unsupported CONTENT_PRODUCTION_STORE: ${configured}`)
  return process.env.DATABASE_URL ? "postgres" : "file"
}

function pool(): Pool {
  if (globalState.__geoContentProductionPool) return globalState.__geoContentProductionPool
  const connectionString = String(process.env.DATABASE_URL || "").trim()
  if (!connectionString) throw new Error("DATABASE_URL is required for content production runs")
  globalState.__geoContentProductionPool = new Pool({
    connectionString,
    max: Math.max(1, Math.min(6, Number(process.env.CONTENT_PRODUCTION_DB_POOL_MAX) || 3)),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  })
  globalState.__geoContentProductionPool.on("error", error => {
    console.error("[content-production-db]", error.message)
  })
  return globalState.__geoContentProductionPool
}

export async function ensureContentProductionSchema(): Promise<void> {
  if (backend() !== "postgres") return
  if (!globalState.__geoContentProductionSchema) {
    globalState.__geoContentProductionSchema = pool().query(CONTENT_PRODUCTION_SCHEMA_SQL)
      .then(() => undefined)
      .catch(error => {
        globalState.__geoContentProductionSchema = undefined
        throw error
      })
  }
  await globalState.__geoContentProductionSchema
}

export async function createContentProductionRun(run: ContentProductionRun): Promise<{
  run: ContentProductionRun
  reused: boolean
}> {
  if (backend() === "postgres") {
    await ensureContentProductionSchema()
    const existing = await findContentProductionRunByRequest(run.ownerUserId, run.requestId)
    if (existing) return { run: existing, reused: true }
    try {
      await pool().query(
        `INSERT INTO geo_content_production_runs_v1 (
           owner_user_id,id,client_id,plan_id,request_id,created_by_user_id,
           article_owner_user_id,data,created_at,updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$9)`,
        [
          run.ownerUserId,
          run.id,
          run.clientId,
          run.planId,
          run.requestId,
          run.createdByUserId,
          run.articleOwnerUserId,
          JSON.stringify(run),
          run.createdAt,
        ],
      )
      return { run: clone(run), reused: false }
    } catch (error) {
      const raced = await findContentProductionRunByRequest(run.ownerUserId, run.requestId)
      if (raced) return { run: raced, reused: true }
      throw error
    }
  }
  return withFileState(state => {
    const existing = Object.values(state.runs).find(item => (
      item.ownerUserId === run.ownerUserId && item.requestId === run.requestId
    ))
    if (existing) return { run: clone(existing), reused: true }
    state.runs[fileKey(run.ownerUserId, run.id)] = clone(run)
    return { run: clone(run), reused: false }
  }, true)
}

export async function getContentProductionRun(
  ownerUserId: string,
  runId: string,
): Promise<ContentProductionRun | null> {
  if (backend() === "postgres") {
    await ensureContentProductionSchema()
    const result = await pool().query<ProductionRunRow>(
      `SELECT * FROM geo_content_production_runs_v1
       WHERE owner_user_id = $1 AND id = $2 LIMIT 1`,
      [ownerUserId, runId],
    )
    return result.rows[0] ? runFromRow(result.rows[0]) : null
  }
  return withFileState(state => cloneOrNull(state.runs[fileKey(ownerUserId, runId)]))
}

export async function getContentProductionRunById(
  runId: string,
): Promise<ContentProductionRun | null> {
  if (backend() === "postgres") {
    await ensureContentProductionSchema()
    const result = await pool().query<ProductionRunRow>(
      `SELECT * FROM geo_content_production_runs_v1 WHERE id = $1 LIMIT 1`,
      [runId],
    )
    return result.rows[0] ? runFromRow(result.rows[0]) : null
  }
  return withFileState(state => cloneOrNull(
    Object.values(state.runs).find(run => run.id === runId),
  ))
}

export async function findContentProductionRunByRequest(
  ownerUserId: string,
  requestId: string,
): Promise<ContentProductionRun | null> {
  if (backend() === "postgres") {
    await ensureContentProductionSchema()
    const result = await pool().query<ProductionRunRow>(
      `SELECT * FROM geo_content_production_runs_v1
       WHERE owner_user_id = $1 AND request_id = $2 LIMIT 1`,
      [ownerUserId, requestId],
    )
    return result.rows[0] ? runFromRow(result.rows[0]) : null
  }
  return withFileState(state => cloneOrNull(Object.values(state.runs).find(run => (
    run.ownerUserId === ownerUserId && run.requestId === requestId
  ))))
}

export async function listContentProductionRuns(
  ownerUserId: string,
  clientId: string,
  filters: ContentProductionRunFilters = {},
): Promise<ContentProductionRun[]> {
  const limit = Math.max(1, Math.min(100, filters.limit || 30))
  if (backend() === "postgres") {
    await ensureContentProductionSchema()
    const values: unknown[] = [ownerUserId, clientId]
    const where = ["owner_user_id = $1", "client_id = $2"]
    if (filters.planId) {
      values.push(filters.planId)
      where.push(`plan_id = $${values.length}`)
    }
    if (filters.status) {
      values.push(filters.status)
      where.push(`data->>'status' = $${values.length}`)
    }
    values.push(limit)
    const result = await pool().query<ProductionRunRow>(
      `SELECT * FROM geo_content_production_runs_v1
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC LIMIT $${values.length}`,
      values,
    )
    return result.rows.map(runFromRow)
  }
  return withFileState(state => Object.values(state.runs)
    .filter(run => run.ownerUserId === ownerUserId && run.clientId === clientId)
    .filter(run => !filters.planId || run.planId === filters.planId)
    .filter(run => !filters.status || run.status === filters.status)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit)
    .map(clone))
}

export async function listActiveContentProductionRunsForUser(
  userId: string,
  limit = 10,
): Promise<ContentProductionRun[]> {
  const safeLimit = Math.max(1, Math.min(20, Math.floor(limit) || 10))
  if (backend() === "postgres") {
    await ensureContentProductionSchema()
    const result = await pool().query<ProductionRunRow>(
      `SELECT * FROM geo_content_production_runs_v1
       WHERE (owner_user_id = $1 OR created_by_user_id = $1)
         AND COALESCE(data->>'status', '') NOT IN ('succeeded', 'partial', 'failed', 'cancelled')
       ORDER BY updated_at DESC LIMIT $2`,
      [userId, safeLimit],
    )
    return result.rows.map(runFromRow)
  }
  return withFileState(state => Object.values(state.runs)
    .filter(run => run.ownerUserId === userId || run.createdByUserId === userId)
    .filter(run => !["succeeded", "partial", "failed", "cancelled"].includes(run.status))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, safeLimit)
    .map(clone))
}

export async function listPendingContentProductionRuns(
  limit = 500,
): Promise<ContentProductionRun[]> {
  const safeLimit = Math.max(1, Math.min(2_000, Math.floor(limit) || 500))
  if (backend() === "postgres") {
    await ensureContentProductionSchema()
    const result = await pool().query<ProductionRunRow>(
      `SELECT * FROM geo_content_production_runs_v1
       WHERE COALESCE(data->>'status', '') NOT IN ('succeeded', 'partial', 'failed', 'cancelled')
       ORDER BY updated_at ASC LIMIT $1`,
      [safeLimit],
    )
    return result.rows.map(runFromRow)
  }
  return withFileState(state => Object.values(state.runs)
    .filter(run => !["succeeded", "partial", "failed", "cancelled"].includes(run.status))
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
    .slice(0, safeLimit)
    .map(clone))
}

export async function mutateContentProductionRun<T>(
  ownerUserId: string,
  runId: string,
  mutate: (run: ContentProductionRun) => T | Promise<T>,
): Promise<{ run: ContentProductionRun; result: T } | null> {
  if (backend() === "postgres") {
    await ensureContentProductionSchema()
    const db = await pool().connect()
    try {
      await db.query("BEGIN")
      const selected = await db.query<ProductionRunRow>(
        `SELECT * FROM geo_content_production_runs_v1
         WHERE owner_user_id = $1 AND id = $2 FOR UPDATE`,
        [ownerUserId, runId],
      )
      if (!selected.rows[0]) {
        await db.query("ROLLBACK")
        return null
      }
      const run = runFromRow(selected.rows[0])
      const result = await mutate(run)
      run.updatedAt = new Date().toISOString()
      await db.query(
        `UPDATE geo_content_production_runs_v1
         SET data = $3::jsonb, updated_at = $4
         WHERE owner_user_id = $1 AND id = $2`,
        [ownerUserId, runId, JSON.stringify(run), run.updatedAt],
      )
      await db.query("COMMIT")
      return { run: clone(run), result }
    } catch (error) {
      await db.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      db.release()
    }
  }
  return withFileState(async state => {
    const key = fileKey(ownerUserId, runId)
    const stored = state.runs[key]
    if (!stored) return null
    const run = clone(stored)
    const result = await mutate(run)
    run.updatedAt = new Date().toISOString()
    state.runs[key] = run
    return { run: clone(run), result }
  }, true)
}

function runFromRow(row: ProductionRunRow): ContentProductionRun {
  const run = clone(row.data)
  run.ownerUserId = row.owner_user_id
  run.id = row.id
  run.clientId = row.client_id
  run.planId = row.plan_id
  run.requestId = row.request_id
  run.createdByUserId = row.created_by_user_id
  run.articleOwnerUserId = row.article_owner_user_id
  run.billingUserId = run.billingUserId || run.articleOwnerUserId
  run.createdAt = iso(row.created_at) || run.createdAt
  run.updatedAt = iso(row.updated_at) || run.updatedAt
  return run
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function cloneOrNull(value: ContentProductionRun | undefined): ContentProductionRun | null {
  return value ? clone(value) : null
}

function iso(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

function fileKey(ownerUserId: string, id: string): string {
  return `${ownerUserId}\u0000${id}`
}

function filePath(): string {
  return String(process.env.CONTENT_PRODUCTION_FILE || DEFAULT_FILE_PATH)
}

async function loadFileState(): Promise<FileState> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath(), "utf8")) as Partial<FileState>
    return { runs: parsed.runs || {} }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT") {
      console.warn("[content-production-file] load failed", error)
    }
    return { runs: {} }
  }
}

async function saveFileState(state: FileState): Promise<void> {
  const target = filePath()
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, JSON.stringify(state), "utf8")
  await fs.rename(temporary, target)
}

async function withFileState<T>(
  action: (state: FileState) => T | Promise<T>,
  persist = false,
): Promise<T> {
  const previous = globalState.__geoContentProductionFileQueue || Promise.resolve()
  const operation = previous.catch(() => undefined).then(async () => {
    const state = await loadFileState()
    const result = await action(state)
    if (persist) await saveFileState(state)
    return result
  })
  globalState.__geoContentProductionFileQueue = operation.then(() => undefined, () => undefined)
  return operation
}

export async function closeContentProductionStoreConnection(): Promise<void> {
  if (globalState.__geoContentProductionPool) await globalState.__geoContentProductionPool.end()
  globalState.__geoContentProductionPool = undefined
  globalState.__geoContentProductionSchema = undefined
}
