import "server-only"

import fs from "fs/promises"
import path from "path"
import { randomUUID } from "crypto"
import { Pool } from "pg"
import {
  computeBrandVoice,
  computeKeywordCompetition,
} from "@/lib/dashboard-aggregations"
import { PENETRATION_HISTORY_SCHEMA_SQL } from "@/lib/penetration/history-schema"
import type {
  PenetrationHistoryListItem,
  PenetrationHistoryListPage,
  PenetrationHistoryRecord,
  PenetrationHistoryRequestSnapshot,
  PenetrationHistorySource,
  PenetrationHistoryStatus,
  PenetrationJobOperation,
  PenetrationResult,
} from "@/types"

export type PenetrationHistoryBuildInput = {
  id: string
  actorUserId?: string
  request: PenetrationHistoryRequestSnapshot
  status: PenetrationHistoryStatus
  source?: PenetrationHistorySource
  result?: PenetrationResult
  error?: string
  completedSlots: number
  totalSlots: number
  createdAt: string
  completedAt?: string
}

export type PenetrationHistoryListFilters = {
  clientId?: string
  status?: PenetrationHistoryStatus
  operation?: PenetrationJobOperation
  source?: PenetrationHistorySource
  days?: number
  page?: number
  pageSize?: number
}

type StoredFileRecord = PenetrationHistoryRecord & {
  ownerUserId: string
  deletedAt?: string
}

type FileHistoryState = {
  records: Record<string, StoredFileRecord>
}

type HistoryRow = {
  id: string
  actor_user_id?: string | null
  client_id: string
  client_name: string
  operation: PenetrationJobOperation
  status: PenetrationHistoryStatus
  source: PenetrationHistorySource
  request_snapshot?: PenetrationHistoryRequestSnapshot
  summary: PenetrationHistoryRecord["summary"]
  dashboard_snapshot?: PenetrationHistoryRecord["dashboard"]
  result?: PenetrationResult | null
  error?: string | null
  schema_version?: number
  created_at: string | Date
  completed_at?: string | Date | null
  updated_at: string | Date
}

const DEFAULT_FILE_PATH = process.env.NODE_ENV === "production"
  ? "/var/lib/geo-system/penetration-history.json"
  : path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "penetration-history.json")

const historyGlobal = globalThis as typeof globalThis & {
  __geoPenetrationHistoryPool?: Pool
  __geoPenetrationHistorySchemaPromise?: Promise<void>
  __geoPenetrationHistoryFileQueue?: Promise<unknown>
}

function backend(): "postgres" | "file" {
  const configured = String(process.env.PENETRATION_HISTORY_STORE || "").trim().toLowerCase()
  if (configured === "postgres" || configured === "file") return configured
  if (configured) throw new Error(`Unsupported PENETRATION_HISTORY_STORE: ${configured}`)
  return process.env.DATABASE_URL ? "postgres" : "file"
}

function pool(): Pool {
  if (historyGlobal.__geoPenetrationHistoryPool) return historyGlobal.__geoPenetrationHistoryPool
  const connectionString = String(process.env.DATABASE_URL || "").trim()
  if (!connectionString) {
    throw new Error("DATABASE_URL is required when PENETRATION_HISTORY_STORE=postgres")
  }
  const configuredMax = Number(process.env.PENETRATION_HISTORY_DB_POOL_MAX || 2)
  const max = Number.isFinite(configuredMax)
    ? Math.max(1, Math.min(4, Math.floor(configuredMax)))
    : 2
  historyGlobal.__geoPenetrationHistoryPool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  })
  historyGlobal.__geoPenetrationHistoryPool.on("error", error => {
    console.error(`[penetration-history-db] ${error.message}`)
  })
  return historyGlobal.__geoPenetrationHistoryPool
}

export async function ensurePenetrationHistorySchema(): Promise<void> {
  if (backend() !== "postgres") return
  if (!historyGlobal.__geoPenetrationHistorySchemaPromise) {
    historyGlobal.__geoPenetrationHistorySchemaPromise = pool()
      .query(PENETRATION_HISTORY_SCHEMA_SQL)
      .then(() => undefined)
      .catch(error => {
        historyGlobal.__geoPenetrationHistorySchemaPromise = undefined
        throw error
      })
  }
  await historyGlobal.__geoPenetrationHistorySchemaPromise
}

function concreteSourceCount(result?: PenetrationResult): number {
  if (!result) return 0
  let count = 0
  for (const items of Object.values(result.byModel)) {
    for (const item of items || []) count += item.searchSources?.length || 0
  }
  return count
}

export function buildPenetrationHistoryRecord(
  input: PenetrationHistoryBuildInput,
): PenetrationHistoryRecord {
  const result = input.result
  const dashboard = result
    ? {
        brandVoice: computeBrandVoice(
          result.byModel,
          input.request.ourBrand,
          input.request.brandAliases,
          input.request.competitors,
        ),
        keywordCompetition: computeKeywordCompetition(
          result.byModel,
          input.request.ourBrand,
          input.request.brandAliases,
          input.request.competitors,
        ),
      }
    : { brandVoice: [], keywordCompetition: [] }
  const updatedAt = input.completedAt || new Date().toISOString()

  return {
    id: input.id,
    actorUserId: input.actorUserId,
    clientId: input.request.clientId,
    clientName: input.request.clientName,
    operation: input.request.operation,
    status: input.status,
    source: input.source || "job",
    request: input.request,
    summary: {
      ourBrand: input.request.ourBrand,
      industry: input.request.industry,
      questionCount: input.request.questions.length,
      modelCount: input.request.models.length,
      completedSlots: Math.max(0, input.completedSlots),
      totalSlots: Math.max(0, input.totalSlots),
      penetrationRate: result?.aggregated.penetrationRate ?? null,
      sourceCount: concreteSourceCount(result),
    },
    dashboard,
    result,
    error: input.error?.trim() || undefined,
    schemaVersion: 1,
    createdAt: input.createdAt,
    completedAt: input.completedAt,
    updatedAt,
  }
}

export async function savePenetrationHistoryRecord(
  ownerUserId: string,
  record: PenetrationHistoryRecord,
): Promise<void> {
  if (backend() === "postgres") {
    await savePostgresRecord(ownerUserId, record)
    return
  }
  await withFileState(state => {
    const key = fileRecordKey(ownerUserId, record.id)
    const existing = state.records[key]
    state.records[key] = {
      ...record,
      ownerUserId,
      deletedAt: existing?.deletedAt,
    }
  }, true)
}

export async function listPenetrationHistoryRecords(
  ownerUserId: string,
  filters: PenetrationHistoryListFilters = {},
): Promise<PenetrationHistoryListPage> {
  const normalized = normalizeFilters(filters)
  if (backend() === "postgres") return listPostgresRecords(ownerUserId, normalized)
  return withFileState(state => {
    const filtered = Object.values(state.records)
      .filter(record => record.ownerUserId === ownerUserId && !record.deletedAt)
      .filter(record => matchesFilters(record, normalized))
      .sort((left, right) => historyTime(right).localeCompare(historyTime(left)))
    const offset = (normalized.page - 1) * normalized.pageSize
    const items = filtered
      .slice(offset, offset + normalized.pageSize)
      .map(toListItem)
    return {
      items,
      page: normalized.page,
      pageSize: normalized.pageSize,
      total: filtered.length,
      hasMore: offset + items.length < filtered.length,
    }
  })
}

export async function getPenetrationHistoryRecord(
  ownerUserId: string,
  id: string,
): Promise<PenetrationHistoryRecord | null> {
  if (backend() === "postgres") {
    await ensurePenetrationHistorySchema()
    const result = await pool().query<HistoryRow>(
      `SELECT id, actor_user_id, client_id, client_name, operation, status, source,
              request_snapshot, summary, dashboard_snapshot, result, error,
              schema_version, created_at, completed_at, updated_at
       FROM geo_penetration_history_v1
       WHERE owner_user_id = $1 AND id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [ownerUserId, id],
    )
    return result.rows[0] ? fullRecordFromRow(result.rows[0]) : null
  }
  return withFileState(state => {
    const record = state.records[fileRecordKey(ownerUserId, id)]
    if (!record || record.deletedAt) return null
    return stripStoredFields(record)
  })
}

export async function deletePenetrationHistoryRecord(
  ownerUserId: string,
  id: string,
): Promise<boolean> {
  if (backend() === "postgres") {
    await ensurePenetrationHistorySchema()
    const result = await pool().query(
      `UPDATE geo_penetration_history_v1
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE owner_user_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [ownerUserId, id],
    )
    return Boolean(result.rowCount)
  }
  return withFileState(state => {
    const record = state.records[fileRecordKey(ownerUserId, id)]
    if (!record || record.deletedAt) return false
    record.deletedAt = new Date().toISOString()
    record.updatedAt = record.deletedAt
    return true
  }, true)
}

async function savePostgresRecord(
  ownerUserId: string,
  record: PenetrationHistoryRecord,
): Promise<void> {
  await ensurePenetrationHistorySchema()
  await pool().query(
    `INSERT INTO geo_penetration_history_v1 (
       owner_user_id, actor_user_id, id, client_id, client_name, operation, status, source,
       request_snapshot, summary, dashboard_snapshot, result, error,
       schema_version, created_at, completed_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13,
       $14, $15::timestamptz, $16::timestamptz, $17::timestamptz
     )
     ON CONFLICT (owner_user_id, id) DO UPDATE SET
       client_id = EXCLUDED.client_id,
       actor_user_id = EXCLUDED.actor_user_id,
       client_name = EXCLUDED.client_name,
       operation = EXCLUDED.operation,
       status = EXCLUDED.status,
       source = EXCLUDED.source,
       request_snapshot = EXCLUDED.request_snapshot,
       summary = EXCLUDED.summary,
       dashboard_snapshot = EXCLUDED.dashboard_snapshot,
       result = EXCLUDED.result,
       error = EXCLUDED.error,
       schema_version = EXCLUDED.schema_version,
       completed_at = EXCLUDED.completed_at,
       updated_at = EXCLUDED.updated_at`,
    [
      ownerUserId,
      record.actorUserId || ownerUserId,
      record.id,
      record.clientId,
      record.clientName,
      record.operation,
      record.status,
      record.source,
      JSON.stringify(record.request),
      JSON.stringify(record.summary),
      JSON.stringify(record.dashboard),
      record.result ? JSON.stringify(record.result) : null,
      record.error || null,
      record.schemaVersion,
      record.createdAt,
      record.completedAt || null,
      record.updatedAt,
    ],
  )
}

type NormalizedFilters = Required<Pick<PenetrationHistoryListFilters, "page" | "pageSize">>
  & Omit<PenetrationHistoryListFilters, "page" | "pageSize">

function normalizeFilters(filters: PenetrationHistoryListFilters): NormalizedFilters {
  const page = Math.max(1, Math.floor(Number(filters.page) || 1))
  const pageSize = Math.max(1, Math.min(50, Math.floor(Number(filters.pageSize) || 20)))
  const days = filters.days
    ? Math.max(1, Math.min(3_650, Math.floor(filters.days)))
    : undefined
  return { ...filters, days, page, pageSize }
}

async function listPostgresRecords(
  ownerUserId: string,
  filters: NormalizedFilters,
): Promise<PenetrationHistoryListPage> {
  await ensurePenetrationHistorySchema()
  const clauses = ["owner_user_id = $1", "deleted_at IS NULL"]
  const values: unknown[] = [ownerUserId]
  const addClause = (sql: string, value: unknown) => {
    values.push(value)
    clauses.push(sql.replace("?", `$${values.length}`))
  }
  if (filters.clientId) addClause("client_id = ?", filters.clientId)
  if (filters.status) addClause("status = ?", filters.status)
  if (filters.operation) addClause("operation = ?", filters.operation)
  if (filters.source) addClause("source = ?", filters.source)
  if (filters.days) {
    addClause(
      "COALESCE(completed_at, created_at) >= NOW() - (?::integer * INTERVAL '1 day')",
      filters.days,
    )
  }

  const where = clauses.join(" AND ")
  const countResult = await pool().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM geo_penetration_history_v1 WHERE ${where}`,
    values,
  )
  const total = Number(countResult.rows[0]?.count || 0)
  const offset = (filters.page - 1) * filters.pageSize
  const listValues = [...values, filters.pageSize, offset]
  const rows = await pool().query<HistoryRow>(
    `SELECT id, actor_user_id, client_id, client_name, operation, status, source,
            summary, created_at, completed_at, updated_at
     FROM geo_penetration_history_v1
     WHERE ${where}
     ORDER BY COALESCE(completed_at, created_at) DESC, id DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    listValues,
  )
  const items = rows.rows.map(listItemFromRow)
  return {
    items,
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    hasMore: offset + items.length < total,
  }
}

function matchesFilters(
  record: PenetrationHistoryRecord,
  filters: NormalizedFilters,
): boolean {
  if (filters.clientId && record.clientId !== filters.clientId) return false
  if (filters.status && record.status !== filters.status) return false
  if (filters.operation && record.operation !== filters.operation) return false
  if (filters.source && record.source !== filters.source) return false
  if (filters.days) {
    const cutoff = Date.now() - filters.days * 24 * 60 * 60 * 1_000
    if (Date.parse(record.completedAt || record.createdAt) < cutoff) return false
  }
  return true
}

function toIso(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
}

function listItemFromRow(row: HistoryRow): PenetrationHistoryListItem {
  return {
    id: row.id,
    actorUserId: row.actor_user_id || undefined,
    clientId: row.client_id,
    clientName: row.client_name,
    operation: row.operation,
    status: row.status,
    source: row.source,
    summary: row.summary,
    createdAt: toIso(row.created_at) || "",
    completedAt: toIso(row.completed_at),
    updatedAt: toIso(row.updated_at) || "",
  }
}

function fullRecordFromRow(row: HistoryRow): PenetrationHistoryRecord {
  return {
    ...listItemFromRow(row),
    request: row.request_snapshot as PenetrationHistoryRequestSnapshot,
    dashboard: row.dashboard_snapshot || { brandVoice: [], keywordCompetition: [] },
    result: row.result || undefined,
    error: row.error || undefined,
    schemaVersion: Number(row.schema_version || 1),
  }
}

function toListItem(record: PenetrationHistoryRecord): PenetrationHistoryListItem {
  return {
    id: record.id,
    actorUserId: record.actorUserId,
    clientId: record.clientId,
    clientName: record.clientName,
    operation: record.operation,
    status: record.status,
    source: record.source,
    summary: record.summary,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
    updatedAt: record.updatedAt,
  }
}

function historyTime(record: PenetrationHistoryRecord): string {
  return record.completedAt || record.createdAt
}

function fileRecordKey(ownerUserId: string, id: string): string {
  return `${ownerUserId}\u0000${id}`
}

function filePath(): string {
  return process.env.PENETRATION_HISTORY_FILE || DEFAULT_FILE_PATH
}

async function withFileState<T>(
  action: (state: FileHistoryState) => T | Promise<T>,
  persist = false,
): Promise<T> {
  const previous = historyGlobal.__geoPenetrationHistoryFileQueue || Promise.resolve()
  const operation = previous.catch(() => undefined).then(async () => {
    const state = await loadFileState()
    const result = await action(state)
    if (persist) await saveFileState(state)
    return result
  })
  historyGlobal.__geoPenetrationHistoryFileQueue = operation.then(() => undefined, () => undefined)
  return operation
}

async function loadFileState(): Promise<FileHistoryState> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(/* turbopackIgnore: true */ filePath(), "utf8"),
    ) as FileHistoryState
    if (parsed && typeof parsed === "object" && parsed.records) return parsed
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : ""
    if (code !== "ENOENT") console.warn("[penetration-history-file] load failed", error)
  }
  return { records: {} }
}

async function saveFileState(state: FileHistoryState): Promise<void> {
  const target = filePath()
  await fs.mkdir(/* turbopackIgnore: true */ path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(/* turbopackIgnore: true */ temporary, JSON.stringify(state), "utf8")
  await fs.rename(/* turbopackIgnore: true */ temporary, target)
}

function stripStoredFields(record: StoredFileRecord): PenetrationHistoryRecord {
  const publicRecord: Partial<StoredFileRecord> = { ...record }
  delete publicRecord.ownerUserId
  delete publicRecord.deletedAt
  return publicRecord as PenetrationHistoryRecord
}
