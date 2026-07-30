import "server-only"

import { createHash, randomUUID } from "crypto"
import fs from "fs/promises"
import path from "path"
import { Pool } from "pg"
import { SYSTEM_OUTPUT_SCHEMA_SQL } from "@/lib/system-output/schema"
import type {
  SystemOutputKind,
  SystemOutputListItem,
  SystemOutputListPage,
  SystemOutputModule,
  SystemOutputRecord,
  SystemOutputStatus,
} from "@/types/system-output"

export type SystemOutputListFilters = {
  clientId?: string
  module?: SystemOutputModule
  kind?: SystemOutputKind
  status?: SystemOutputStatus
  days?: number
  page?: number
  pageSize?: number
}

type StoredFileRecord = SystemOutputRecord & {
  ownerUserId: string
  deletedAt?: string
}

type FileState = {
  records: Record<string, StoredFileRecord>
}

type OutputRow = {
  owner_user_id?: string
  actor_user_id?: string | null
  id: string
  task_id: string
  client_id: string
  client_name: string
  module: SystemOutputModule
  kind: SystemOutputKind
  status: SystemOutputStatus
  source: SystemOutputRecord["source"]
  summary: SystemOutputRecord["summary"]
  request_snapshot?: unknown
  result_snapshot?: unknown
  resource_reference?: SystemOutputRecord["resource"] | null
  error?: string | null
  schema_version: number
  created_at: string | Date
  completed_at?: string | Date | null
  updated_at: string | Date
}

const MAX_RECORD_BYTES = 20 * 1024 * 1024
const DEFAULT_FILE_PATH = process.env.NODE_ENV === "production"
  ? "/var/lib/geo-system/system-outputs.json"
  : path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "system-outputs.json")

const globalState = globalThis as typeof globalThis & {
  __geoSystemOutputPool?: Pool
  __geoSystemOutputSchemaPromise?: Promise<void>
  __geoSystemOutputFileQueue?: Promise<unknown>
}

function backend(): "postgres" | "file" {
  const configured = String(process.env.SYSTEM_OUTPUT_STORE || "").trim().toLowerCase()
  if (configured === "postgres" || configured === "file") return configured
  if (configured) throw new Error(`Unsupported SYSTEM_OUTPUT_STORE: ${configured}`)
  return process.env.DATABASE_URL ? "postgres" : "file"
}

function pool(): Pool {
  if (globalState.__geoSystemOutputPool) return globalState.__geoSystemOutputPool
  const connectionString = String(process.env.DATABASE_URL || "").trim()
  if (!connectionString) {
    throw new Error("DATABASE_URL is required when SYSTEM_OUTPUT_STORE=postgres")
  }
  const configuredMax = Number(process.env.SYSTEM_OUTPUT_DB_POOL_MAX || 2)
  const max = Number.isFinite(configuredMax)
    ? Math.max(1, Math.min(4, Math.floor(configuredMax)))
    : 2
  globalState.__geoSystemOutputPool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  })
  globalState.__geoSystemOutputPool.on("error", error => {
    console.error(`[system-output-db] ${error.message}`)
  })
  return globalState.__geoSystemOutputPool
}

export async function ensureSystemOutputSchema(): Promise<void> {
  if (backend() !== "postgres") return
  if (!globalState.__geoSystemOutputSchemaPromise) {
    globalState.__geoSystemOutputSchemaPromise = pool()
      .query(SYSTEM_OUTPUT_SCHEMA_SQL)
      .then(() => undefined)
      .catch(error => {
        globalState.__geoSystemOutputSchemaPromise = undefined
        throw error
      })
  }
  await globalState.__geoSystemOutputSchemaPromise
}

export function systemOutputRecordId(
  ownerUserId: string,
  module: SystemOutputModule,
  taskId: string,
): string {
  const digest = createHash("sha256")
    .update(`${ownerUserId}\u0000${module}\u0000${taskId}`)
    .digest("hex")
    .slice(0, 32)
  return `output_${digest}`
}

export async function saveSystemOutputRecord(
  ownerUserId: string,
  record: SystemOutputRecord,
): Promise<{ record: SystemOutputRecord; created: boolean }> {
  assertRecord(ownerUserId, record)
  if (backend() === "postgres") return savePostgresRecord(ownerUserId, record)
  return withFileState(state => {
    const key = fileRecordKey(ownerUserId, record.id)
    const existing = state.records[key]
    if (existing) return { record: stripStoredFields(existing), created: false }
    state.records[key] = { ...structuredClone(record), ownerUserId }
    return { record, created: true }
  }, true)
}

export async function listSystemOutputRecords(
  ownerUserId: string,
  filters: SystemOutputListFilters = {},
): Promise<SystemOutputListPage> {
  const normalized = normalizeFilters(filters)
  if (backend() === "postgres") return listPostgresRecords(ownerUserId, normalized)
  return withFileState(state => {
    const filtered = Object.values(state.records)
      .filter(record => record.ownerUserId === ownerUserId && !record.deletedAt)
      .filter(record => matchesFilters(record, normalized))
      .sort((left, right) => outputTime(right).localeCompare(outputTime(left)))
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

export async function getSystemOutputRecord(
  ownerUserId: string,
  id: string,
): Promise<SystemOutputRecord | null> {
  if (backend() === "postgres") {
    await ensureSystemOutputSchema()
    const result = await pool().query<OutputRow>(
      `${fullSelect()}
       WHERE owner_user_id = $1 AND id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [ownerUserId, id],
    )
    return result.rows[0] ? recordFromRow(result.rows[0]) : null
  }
  return withFileState(state => {
    const stored = state.records[fileRecordKey(ownerUserId, id)]
    return stored && !stored.deletedAt ? stripStoredFields(stored) : null
  })
}

export async function getSystemOutputRecordScope(
  id: string,
): Promise<{
  ownerUserId: string
  clientId: string
  module: SystemOutputModule
} | null> {
  if (backend() === "postgres") {
    await ensureSystemOutputSchema()
    const result = await pool().query<{
      owner_user_id: string
      client_id: string
      module: SystemOutputModule
    }>(
      `SELECT owner_user_id, client_id, module
       FROM geo_system_outputs_v1
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [id],
    )
    const row = result.rows[0]
    return row
      ? { ownerUserId: row.owner_user_id, clientId: row.client_id, module: row.module }
      : null
  }
  return withFileState(state => {
    const stored = Object.values(state.records).find(record => record.id === id && !record.deletedAt)
    return stored
      ? { ownerUserId: stored.ownerUserId, clientId: stored.clientId, module: stored.module }
      : null
  })
}

async function savePostgresRecord(
  ownerUserId: string,
  record: SystemOutputRecord,
): Promise<{ record: SystemOutputRecord; created: boolean }> {
  await ensureSystemOutputSchema()
  const result = await pool().query<OutputRow>(
    `INSERT INTO geo_system_outputs_v1 (
       owner_user_id, actor_user_id, id, task_id, client_id, client_name,
       module, kind, status, source, summary, request_snapshot, result_snapshot,
       resource_reference, error, schema_version, created_at, completed_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb,
       $14::jsonb, $15, $16, $17, $18, $19
     )
     ON CONFLICT (owner_user_id, module, task_id) DO NOTHING
     RETURNING owner_user_id, actor_user_id, id, task_id, client_id, client_name,
       module, kind, status, source, summary, request_snapshot, result_snapshot,
       resource_reference, error, schema_version, created_at, completed_at, updated_at`,
    [
      ownerUserId,
      record.actorUserId || null,
      record.id,
      record.taskId,
      record.clientId,
      record.clientName,
      record.module,
      record.kind,
      record.status,
      record.source,
      JSON.stringify(record.summary),
      jsonOrNull(record.request),
      jsonOrNull(record.result),
      jsonOrNull(record.resource),
      record.error || null,
      record.schemaVersion,
      record.createdAt,
      record.completedAt || null,
      record.updatedAt,
    ],
  )
  if (result.rows[0]) return { record: recordFromRow(result.rows[0]), created: true }

  const existing = await pool().query<OutputRow>(
    `${fullSelect()}
     WHERE owner_user_id = $1 AND module = $2 AND task_id = $3
     LIMIT 1`,
    [ownerUserId, record.module, record.taskId],
  )
  if (!existing.rows[0]) throw new Error("系统产出记录保存失败")
  return { record: recordFromRow(existing.rows[0]), created: false }
}

async function listPostgresRecords(
  ownerUserId: string,
  filters: ReturnType<typeof normalizeFilters>,
): Promise<SystemOutputListPage> {
  await ensureSystemOutputSchema()
  const where = ["owner_user_id = $1", "deleted_at IS NULL"]
  const values: unknown[] = [ownerUserId]
  const add = (clause: string, value: unknown) => {
    values.push(value)
    where.push(clause.replace("?", `$${values.length}`))
  }
  if (filters.clientId) add("client_id = ?", filters.clientId)
  if (filters.module) add("module = ?", filters.module)
  if (filters.kind) add("kind = ?", filters.kind)
  if (filters.status) add("status = ?", filters.status)
  if (filters.cutoff) add("COALESCE(completed_at, created_at) >= ?", filters.cutoff)

  const count = await pool().query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM geo_system_outputs_v1
     WHERE ${where.join(" AND ")}`,
    values,
  )
  const total = Number(count.rows[0]?.total || 0)
  const offset = (filters.page - 1) * filters.pageSize
  values.push(filters.pageSize, offset)
  const rows = await pool().query<OutputRow>(
    `SELECT actor_user_id, id, task_id, client_id, client_name, module, kind,
            status, source, summary, resource_reference, error, schema_version,
            created_at, completed_at, updated_at,
            request_snapshot IS NOT NULL AS has_request,
            result_snapshot IS NOT NULL AS has_result
     FROM geo_system_outputs_v1
     WHERE ${where.join(" AND ")}
     ORDER BY COALESCE(completed_at, created_at) DESC, created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  )
  const items = rows.rows.map(row => toListItemFromRow(row))
  return {
    items,
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    hasMore: offset + items.length < total,
  }
}

function fullSelect(): string {
  return `SELECT owner_user_id, actor_user_id, id, task_id, client_id, client_name,
                 module, kind, status, source, summary, request_snapshot, result_snapshot,
                 resource_reference, error, schema_version, created_at, completed_at, updated_at
          FROM geo_system_outputs_v1`
}

function recordFromRow(row: OutputRow): SystemOutputRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    actorUserId: row.actor_user_id || undefined,
    clientId: row.client_id,
    clientName: row.client_name,
    module: row.module,
    kind: row.kind,
    status: row.status,
    source: row.source,
    summary: row.summary,
    request: row.request_snapshot,
    result: row.result_snapshot,
    resource: row.resource_reference || undefined,
    error: row.error || undefined,
    schemaVersion: row.schema_version,
    createdAt: iso(row.created_at),
    completedAt: row.completed_at ? iso(row.completed_at) : undefined,
    updatedAt: iso(row.updated_at),
  }
}

function toListItemFromRow(
  row: OutputRow & { has_request?: boolean; has_result?: boolean },
): SystemOutputListItem {
  const record = recordFromRow(row)
  const { request: _request, result: _result, ...item } = record
  return {
    ...item,
    hasRequest: Boolean(row.has_request),
    hasResult: Boolean(row.has_result),
  }
}

function toListItem(record: SystemOutputRecord): SystemOutputListItem {
  const { request, result, ...item } = record
  return {
    ...item,
    hasRequest: request !== undefined,
    hasResult: result !== undefined,
  }
}

function normalizeFilters(filters: SystemOutputListFilters) {
  const days = Math.max(0, Math.min(3650, Math.floor(Number(filters.days) || 0)))
  return {
    clientId: cleanOptional(filters.clientId, 200),
    module: filters.module,
    kind: filters.kind,
    status: filters.status,
    page: Math.max(1, Math.floor(Number(filters.page) || 1)),
    pageSize: Math.max(1, Math.min(100, Math.floor(Number(filters.pageSize) || 20))),
    cutoff: days > 0 ? new Date(Date.now() - days * 86_400_000).toISOString() : "",
  }
}

function matchesFilters(
  record: SystemOutputRecord,
  filters: ReturnType<typeof normalizeFilters>,
): boolean {
  if (filters.clientId && record.clientId !== filters.clientId) return false
  if (filters.module && record.module !== filters.module) return false
  if (filters.kind && record.kind !== filters.kind) return false
  if (filters.status && record.status !== filters.status) return false
  if (filters.cutoff && outputTime(record) < filters.cutoff) return false
  return true
}

function assertRecord(ownerUserId: string, record: SystemOutputRecord): void {
  if (!ownerUserId.trim() || ownerUserId.length > 240) throw new Error("系统产出所有者无效")
  for (const [label, value] of [
    ["记录编号", record.id],
    ["任务编号", record.taskId],
    ["客户编号", record.clientId],
    ["客户名称", record.clientName],
  ] as const) {
    if (!String(value || "").trim() || String(value).length > 240) {
      throw new Error(`${label}无效`)
    }
  }
  const bytes = Buffer.byteLength(JSON.stringify(record))
  if (bytes > MAX_RECORD_BYTES) throw new Error("系统产出记录超过单条存储上限")
}

function jsonOrNull(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value)
}

function cleanOptional(value: unknown, maxLength: number): string {
  return String(value || "").trim().slice(0, maxLength)
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function outputTime(record: Pick<SystemOutputRecord, "completedAt" | "createdAt">): string {
  return record.completedAt || record.createdAt
}

function filePath(): string {
  return String(process.env.SYSTEM_OUTPUT_FILE || "").trim() || DEFAULT_FILE_PATH
}

function fileRecordKey(ownerUserId: string, id: string): string {
  return `${ownerUserId}:${id}`
}

async function withFileState<T>(
  operation: (state: FileState) => T | Promise<T>,
  persist = false,
): Promise<T> {
  const previous = globalState.__geoSystemOutputFileQueue || Promise.resolve()
  let release: () => void = () => undefined
  globalState.__geoSystemOutputFileQueue = new Promise<void>(resolve => {
    release = resolve
  })
  await previous.catch(() => undefined)
  try {
    const state = await loadFileState()
    const result = await operation(state)
    if (persist) await saveFileState(state)
    return result
  } finally {
    release()
  }
}

async function loadFileState(): Promise<FileState> {
  try {
    const parsed = JSON.parse(await fs.readFile(/* turbopackIgnore: true */ filePath(), "utf8")) as FileState
    if (parsed && typeof parsed === "object" && parsed.records) return parsed
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : ""
    if (code !== "ENOENT") console.warn("[system-output-file] load failed", error)
  }
  return { records: {} }
}

async function saveFileState(state: FileState): Promise<void> {
  const target = filePath()
  await fs.mkdir(/* turbopackIgnore: true */ path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(/* turbopackIgnore: true */ temporary, JSON.stringify(state), "utf8")
  await fs.rename(/* turbopackIgnore: true */ temporary, target)
}

function stripStoredFields(record: StoredFileRecord): SystemOutputRecord {
  const { ownerUserId: _ownerUserId, deletedAt: _deletedAt, ...output } = record
  return output
}
