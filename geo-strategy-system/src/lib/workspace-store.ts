import "server-only"

import fs from "fs/promises"
import path from "path"
import { randomUUID } from "crypto"
import { isDeepStrictEqual } from "util"
import { Pool, type PoolClient } from "pg"
import type { AnalysisSubjectType, Client } from "@/types"
import {
  WORKSPACE_SECTIONS,
  WorkspaceValidationError,
  composeClientData,
  emptyWorkspaceVersions,
  normalizeClientPayload,
  normalizeWorkspaceVersions,
  sectionForClientField,
  sectionsForClientPatch,
  splitClientData,
  type SyncedClient,
  type WorkspaceSection,
  type WorkspaceSectionSnapshot,
  type WorkspaceVersions,
} from "@/lib/workspace-sync"
import { WORKSPACE_SCHEMA_SQL } from "@/lib/workspace-schema"

type WorkspaceRecord = {
  sections: Partial<Record<WorkspaceSection, Record<string, unknown>>>
  versions: WorkspaceVersions
  deletedAt?: string
}

type FileUserState = {
  clients: Record<string, WorkspaceRecord>
  imports: Record<string, { importedAt: string; importedCount: number; duplicatedCount: number }>
}

type FileWorkspaceState = {
  users: Record<string, FileUserState>
}

export type WorkspaceImportResult = {
  importedCount: number
  duplicatedCount: number
  alreadyImported: boolean
  clients: SyncedClient[]
}

export type WorkspaceClientSummary = {
  id: string
  name: string
  subjectType: AnalysisSubjectType
  ourBrand: string
  industry: string
  website: string
  createdAt: string
  updatedAt: string
  questionCount: number
  selectedModelCount: number
  completedModules: WorkspaceSection[]
  versions: WorkspaceVersions
}

export class WorkspaceConflictError extends Error {
  readonly current: SyncedClient
  readonly conflictingSections: WorkspaceSection[]

  constructor(current: SyncedClient, conflictingSections: WorkspaceSection[]) {
    super("云端数据已在另一台设备上更新")
    this.name = "WorkspaceConflictError"
    this.current = current
    this.conflictingSections = conflictingSections
  }
}

const DEFAULT_FILE_PATH = process.env.NODE_ENV === "production"
  ? "/var/lib/geo-system/workspaces.json"
  : path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "workspaces.json")

const workspaceGlobal = globalThis as typeof globalThis & {
  __geoWorkspacePool?: Pool
  __geoWorkspaceSchemaPromise?: Promise<void>
  __geoWorkspaceFileQueue?: Promise<unknown>
}

function backend(): "postgres" | "file" {
  const configured = String(process.env.WORKSPACE_STORE || "").trim().toLowerCase()
  if (configured === "postgres" || configured === "file") return configured
  if (configured) throw new Error(`Unsupported WORKSPACE_STORE: ${configured}`)
  return process.env.DATABASE_URL ? "postgres" : "file"
}

function pool(): Pool {
  if (workspaceGlobal.__geoWorkspacePool) return workspaceGlobal.__geoWorkspacePool
  const connectionString = String(process.env.DATABASE_URL || "").trim()
  if (!connectionString) throw new Error("DATABASE_URL is required when WORKSPACE_STORE=postgres")
  workspaceGlobal.__geoWorkspacePool = new Pool({
    connectionString,
    max: Math.max(2, Number(process.env.WORKSPACE_DB_POOL_MAX || 8)),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  })
  workspaceGlobal.__geoWorkspacePool.on("error", error => {
    console.error(`[workspace-db] ${error.message}`)
  })
  return workspaceGlobal.__geoWorkspacePool
}

export async function ensureWorkspaceSchema(): Promise<void> {
  if (backend() !== "postgres") return
  if (!workspaceGlobal.__geoWorkspaceSchemaPromise) {
    workspaceGlobal.__geoWorkspaceSchemaPromise = pool().query(WORKSPACE_SCHEMA_SQL)
      .then(() => undefined)
      .catch(error => {
        workspaceGlobal.__geoWorkspaceSchemaPromise = undefined
        throw error
      })
  }
  await workspaceGlobal.__geoWorkspaceSchemaPromise
}

export async function listWorkspaceClients(userId: string): Promise<SyncedClient[]> {
  return backend() === "postgres"
    ? listPostgresClients(userId)
    : withFileState(state => listFileClients(state, userId))
}

export async function listWorkspaceClientSummaries(
  userId: string,
): Promise<WorkspaceClientSummary[]> {
  return backend() === "postgres"
    ? listPostgresClientSummaries(userId)
    : withFileState(state => listFileClientSummaries(state, userId))
}

export async function getWorkspaceClientSections(
  userId: string,
  clientId: string,
  requestedSections: readonly WorkspaceSection[],
): Promise<WorkspaceSectionSnapshot | null> {
  const selected = Array.from(new Set<WorkspaceSection>([
    "core",
    ...requestedSections.filter(section => WORKSPACE_SECTIONS.includes(section)),
  ]))
  return backend() === "postgres"
    ? getPostgresClientSections(userId, clientId, selected)
    : withFileState(state => {
        const record = fileUser(state, userId).clients[clientId]
        if (!record || record.deletedAt) return null
        return snapshotFromRecord(clientId, record, selected)
      })
}

export async function createWorkspaceClient(userId: string, value: unknown): Promise<SyncedClient> {
  const client = normalizeClientPayload(value)
  return backend() === "postgres"
    ? createPostgresClient(userId, client)
    : withFileState(state => {
        const user = fileUser(state, userId)
        const existing = user.clients[client.id]
        if (existing && !existing.deletedAt) return syncedFromRecord(existing)
        const record = recordFromClient(client)
        user.clients[client.id] = record
        return syncedFromRecord(record)
      }, true)
}

export async function patchWorkspaceClient(args: {
  userId: string
  clientId: string
  patch: Partial<Client>
  unsetFields: (keyof Client)[]
  expectedVersions: WorkspaceVersions
  force?: boolean
}): Promise<SyncedClient | null> {
  return backend() === "postgres"
    ? patchPostgresClient(args)
    : withFileState(state => {
        const record = fileUser(state, args.userId).clients[args.clientId]
        if (!record || record.deletedAt) return null
        const next = patchedRecord(record, args.patch, args.unsetFields, args.expectedVersions, Boolean(args.force))
        fileUser(state, args.userId).clients[args.clientId] = next
        return syncedFromRecord(next)
      }, true)
}

export async function mutateWorkspaceClientLatest(args: {
  userId: string
  clientId: string
  mutate: (current: Client) => {
    patch: Partial<Client>
    unsetFields?: (keyof Client)[]
  } | null
  maxAttempts?: number
}): Promise<SyncedClient | null> {
  let lastConflict: WorkspaceConflictError | null = null
  const maxAttempts = Math.max(1, Math.min(8, args.maxAttempts || 4))

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const current = (await listWorkspaceClients(args.userId))
      .find(item => item.client.id === args.clientId)
    if (!current) return null
    const mutation = args.mutate(current.client)
    if (!mutation) return current

    try {
      return await patchWorkspaceClient({
        userId: args.userId,
        clientId: args.clientId,
        patch: mutation.patch,
        unsetFields: mutation.unsetFields || [],
        expectedVersions: current.versions,
      })
    } catch (error) {
      if (!(error instanceof WorkspaceConflictError)) throw error
      lastConflict = error
    }
  }

  throw lastConflict || new Error("云端数据并发更新失败")
}

export async function deleteWorkspaceClient(userId: string, clientId: string): Promise<boolean> {
  if (backend() === "postgres") {
    await ensureWorkspaceSchema()
    const result = await pool().query(
      `UPDATE geo_workspace_clients
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [userId, clientId],
    )
    return Boolean(result.rowCount)
  }
  return withFileState(state => {
    const record = fileUser(state, userId).clients[clientId]
    if (!record || record.deletedAt) return false
    record.deletedAt = new Date().toISOString()
    return true
  }, true)
}

export async function importLegacyWorkspaceClients(
  userId: string,
  importIdValue: string,
  values: unknown[],
): Promise<WorkspaceImportResult> {
  const importId = importIdValue.trim().slice(0, 240)
  if (!importId) throw new WorkspaceValidationError("导入标识不能为空")
  const clients = values.slice(0, 500).map(normalizeClientPayload)
  return backend() === "postgres"
    ? importPostgresClients(userId, importId, clients)
    : withFileState(state => importFileClients(state, userId, importId, clients), true)
}

function recordFromClient(client: Client): WorkspaceRecord {
  const sections = splitClientData(client)
  const versions = emptyWorkspaceVersions()
  versions.core = 1
  for (const section of WORKSPACE_SECTIONS) {
    if (section !== "core" && Object.keys(sections[section]).length > 0) versions[section] = 1
  }
  return { sections, versions }
}

function syncedFromRecord(record: WorkspaceRecord): SyncedClient {
  return {
    client: composeClientData(record.sections),
    versions: { ...record.versions },
  }
}

function patchedRecord(
  record: WorkspaceRecord,
  patch: Partial<Client>,
  unsetFields: (keyof Client)[],
  expectedVersions: WorkspaceVersions,
  force: boolean,
): WorkspaceRecord {
  const requestedSections = sectionsForClientPatch(patch, unsetFields)
  if (requestedSections.length === 0) return record

  const sections = structuredClone(record.sections)
  for (const section of WORKSPACE_SECTIONS) sections[section] ||= {}
  for (const [field, value] of Object.entries(patch) as [keyof Client, unknown][]) {
    const section = sectionForClientField(field)
    if (section) sections[section]![field] = value
  }
  for (const field of unsetFields) {
    const section = sectionForClientField(field)
    if (section) delete sections[section]![field]
  }

  const normalized = normalizeClientPayload(composeClientData(sections))
  const previewSections = splitClientData(normalized)
  const touched = requestedSections.filter(section => (
    !isDeepStrictEqual(record.sections[section] || {}, previewSections[section] || {})
  ))
  if (touched.length === 0) return record

  const current = syncedFromRecord(record)
  const conflicts = touched.filter(section => expectedVersions[section] !== record.versions[section])
  if (!force && conflicts.length > 0) throw new WorkspaceConflictError(current, conflicts)

  const now = new Date().toISOString()
  normalized.updatedAt = now
  const normalizedSections = splitClientData(normalized)
  const versions = { ...record.versions }
  for (const section of touched) {
    sections[section] = normalizedSections[section]
    versions[section] += 1
  }
  sections.core = normalizedSections.core
  return { sections, versions }
}

async function listPostgresClients(userId: string): Promise<SyncedClient[]> {
  await ensureWorkspaceSchema()
  const result = await pool().query<{
    id: string
    core: Record<string, unknown>
    core_version: number
    section: WorkspaceSection | null
    data: Record<string, unknown> | null
    section_version: number | null
  }>(
    `SELECT c.id, c.core, c.version AS core_version,
            s.section, s.data, s.version AS section_version
     FROM geo_workspace_clients c
     LEFT JOIN geo_workspace_sections s
       ON s.user_id = c.user_id AND s.client_id = c.id
     WHERE c.user_id = $1 AND c.deleted_at IS NULL
     ORDER BY c.updated_at DESC`,
    [userId],
  )
  return recordsFromRows(result.rows)
}

async function listPostgresClientSummaries(
  userId: string,
): Promise<WorkspaceClientSummary[]> {
  await ensureWorkspaceSchema()
  const result = await pool().query<{
    core: Record<string, unknown>
    section_versions: Record<string, number> | null
  }>(
    `SELECT c.core,
            COALESCE(
              jsonb_object_agg(s.section, s.version)
                FILTER (WHERE s.section IS NOT NULL),
              '{}'::jsonb
            ) AS section_versions
     FROM geo_workspace_clients c
     LEFT JOIN geo_workspace_sections s
       ON s.user_id = c.user_id AND s.client_id = c.id
     WHERE c.user_id = $1 AND c.deleted_at IS NULL
     GROUP BY c.user_id, c.id, c.core, c.updated_at
     ORDER BY c.updated_at DESC`,
    [userId],
  )
  return result.rows.map(row => summaryFromCore(row.core, row.section_versions || {}))
}

async function getPostgresClientSections(
  userId: string,
  clientId: string,
  requestedSections: WorkspaceSection[],
): Promise<WorkspaceSectionSnapshot | null> {
  await ensureWorkspaceSchema()
  const [coreResult, sectionResult] = await Promise.all([
    pool().query<{
      core: Record<string, unknown>
      version: number
    }>(
      `SELECT core, version
       FROM geo_workspace_clients
       WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [userId, clientId],
    ),
    pool().query<{
      section: WorkspaceSection
      version: number
      data: Record<string, unknown> | null
    }>(
      `SELECT section, version,
              CASE WHEN section = ANY($3::text[]) THEN data ELSE NULL END AS data
       FROM geo_workspace_sections
       WHERE user_id = $1 AND client_id = $2`,
      [userId, clientId, requestedSections.filter(section => section !== "core")],
    ),
  ])
  const core = coreResult.rows[0]
  if (!core) return null
  const versions = emptyWorkspaceVersions()
  versions.core = Number(core.version || 0)
  const sections: WorkspaceSectionSnapshot["sections"] = { core: core.core }
  for (const row of sectionResult.rows) {
    if (!WORKSPACE_SECTIONS.includes(row.section)) continue
    versions[row.section] = Number(row.version || 0)
    if (row.data && requestedSections.includes(row.section)) {
      sections[row.section] = row.data
    }
  }
  return {
    clientId,
    sections,
    versions,
    loadedSections: requestedSections,
  }
}

async function createPostgresClient(userId: string, client: Client): Promise<SyncedClient> {
  await ensureWorkspaceSchema()
  const db = await pool().connect()
  try {
    await db.query("BEGIN")
    const existing = await selectPostgresClient(db, userId, client.id, true)
    if (existing) {
      await db.query("COMMIT")
      return existing
    }
    const record = recordFromClient(client)
    await insertPostgresRecord(db, userId, record)
    await db.query("COMMIT")
    return syncedFromRecord(record)
  } catch (error) {
    await db.query("ROLLBACK")
    throw error
  } finally {
    db.release()
  }
}

async function patchPostgresClient(args: {
  userId: string
  clientId: string
  patch: Partial<Client>
  unsetFields: (keyof Client)[]
  expectedVersions: WorkspaceVersions
  force?: boolean
}): Promise<SyncedClient | null> {
  await ensureWorkspaceSchema()
  const db = await pool().connect()
  try {
    await db.query("BEGIN")
    const current = await selectPostgresClient(db, args.userId, args.clientId, true)
    if (!current) {
      await db.query("ROLLBACK")
      return null
    }
    const currentRecord = recordFromSynced(current)
    const nextRecord = patchedRecord(
      currentRecord,
      args.patch,
      args.unsetFields,
      args.expectedVersions,
      Boolean(args.force),
    )
    const touched = WORKSPACE_SECTIONS.filter(
      section => nextRecord.versions[section] !== currentRecord.versions[section],
    )
    if (touched.length === 0) {
      await db.query("COMMIT")
      return current
    }
    const now = nextRecord.sections.core?.updatedAt || new Date().toISOString()

    if (touched.includes("core")) {
      await db.query(
        `UPDATE geo_workspace_clients
         SET core = $3::jsonb, version = $4, updated_at = $5
         WHERE user_id = $1 AND id = $2`,
        [args.userId, args.clientId, JSON.stringify(nextRecord.sections.core), nextRecord.versions.core, now],
      )
    } else {
      await db.query(
        `UPDATE geo_workspace_clients
         SET core = $3::jsonb, updated_at = $4
         WHERE user_id = $1 AND id = $2`,
        [args.userId, args.clientId, JSON.stringify(nextRecord.sections.core), now],
      )
    }

    for (const section of touched.filter(item => item !== "core")) {
      await db.query(
        `INSERT INTO geo_workspace_sections (user_id, client_id, section, data, version, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         ON CONFLICT (user_id, client_id, section)
         DO UPDATE SET data = EXCLUDED.data, version = EXCLUDED.version, updated_at = EXCLUDED.updated_at`,
        [args.userId, args.clientId, section, JSON.stringify(nextRecord.sections[section] || {}), nextRecord.versions[section], now],
      )
    }
    await db.query("COMMIT")
    return syncedFromRecord(nextRecord)
  } catch (error) {
    await db.query("ROLLBACK")
    throw error
  } finally {
    db.release()
  }
}

async function importPostgresClients(
  userId: string,
  importId: string,
  clients: Client[],
): Promise<WorkspaceImportResult> {
  await ensureWorkspaceSchema()
  const db = await pool().connect()
  try {
    await db.query("BEGIN")
    const prior = await db.query(
      `SELECT imported_count, duplicated_count
       FROM geo_workspace_imports WHERE user_id = $1 AND import_id = $2`,
      [userId, importId],
    )
    if (prior.rowCount) {
      await db.query("COMMIT")
      return {
        importedCount: Number(prior.rows[0].imported_count),
        duplicatedCount: Number(prior.rows[0].duplicated_count),
        alreadyImported: true,
        clients: await listPostgresClients(userId),
      }
    }

    let duplicatedCount = 0
    for (const original of clients) {
      let client = original
      const existing = await selectPostgresClient(db, userId, client.id, true)
      if (existing) {
        duplicatedCount += 1
        client = {
          ...client,
          id: randomUUID(),
          name: `${client.name}（本机导入）`.slice(0, 160),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      }
      await insertPostgresRecord(db, userId, recordFromClient(client))
    }
    await db.query(
      `INSERT INTO geo_workspace_imports
         (user_id, import_id, imported_count, duplicated_count)
       VALUES ($1, $2, $3, $4)`,
      [userId, importId, clients.length, duplicatedCount],
    )
    await db.query("COMMIT")
    return {
      importedCount: clients.length,
      duplicatedCount,
      alreadyImported: false,
      clients: await listPostgresClients(userId),
    }
  } catch (error) {
    await db.query("ROLLBACK")
    throw error
  } finally {
    db.release()
  }
}

async function insertPostgresRecord(db: PoolClient, userId: string, record: WorkspaceRecord): Promise<void> {
  const client = composeClientData(record.sections)
  await db.query(
    `DELETE FROM geo_workspace_clients
     WHERE user_id = $1 AND id = $2 AND deleted_at IS NOT NULL`,
    [userId, client.id],
  )
  await db.query(
    `INSERT INTO geo_workspace_clients
       (user_id, id, core, version, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6)`,
    [userId, client.id, JSON.stringify(record.sections.core), record.versions.core, client.createdAt, client.updatedAt],
  )
  for (const section of WORKSPACE_SECTIONS) {
    if (section === "core" || record.versions[section] === 0) continue
    await db.query(
      `INSERT INTO geo_workspace_sections
         (user_id, client_id, section, data, version, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [userId, client.id, section, JSON.stringify(record.sections[section] || {}), record.versions[section], client.updatedAt],
    )
  }
}

async function selectPostgresClient(
  db: PoolClient,
  userId: string,
  clientId: string,
  lock: boolean,
): Promise<SyncedClient | null> {
  const coreResult = await db.query<{
    core: Record<string, unknown>
    version: number
  }>(
    `SELECT core, version FROM geo_workspace_clients
     WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL${lock ? " FOR UPDATE" : ""}`,
    [userId, clientId],
  )
  if (!coreResult.rowCount) return null
  const sectionResult = await db.query<{
    section: WorkspaceSection
    data: Record<string, unknown>
    version: number
  }>(
    `SELECT section, data, version FROM geo_workspace_sections
     WHERE user_id = $1 AND client_id = $2${lock ? " FOR UPDATE" : ""}`,
    [userId, clientId],
  )
  const versions = emptyWorkspaceVersions()
  versions.core = Number(coreResult.rows[0].version)
  const sections: WorkspaceRecord["sections"] = { core: coreResult.rows[0].core }
  for (const row of sectionResult.rows) {
    if (!WORKSPACE_SECTIONS.includes(row.section)) continue
    sections[row.section] = row.data
    versions[row.section] = Number(row.version)
  }
  return syncedFromRecord({ sections, versions })
}

function recordsFromRows(rows: Array<{
  id: string
  core: Record<string, unknown>
  core_version: number
  section: WorkspaceSection | null
  data: Record<string, unknown> | null
  section_version: number | null
}>): SyncedClient[] {
  const records = new Map<string, WorkspaceRecord>()
  for (const row of rows) {
    let record = records.get(row.id)
    if (!record) {
      const versions = emptyWorkspaceVersions()
      versions.core = Number(row.core_version)
      record = { sections: { core: row.core }, versions }
      records.set(row.id, record)
    }
    if (row.section && WORKSPACE_SECTIONS.includes(row.section) && row.data) {
      record.sections[row.section] = row.data
      record.versions[row.section] = Number(row.section_version || 0)
    }
  }
  return [...records.values()].map(syncedFromRecord)
}

function recordFromSynced(value: SyncedClient): WorkspaceRecord {
  return {
    sections: splitClientData(value.client),
    versions: { ...value.versions },
  }
}

function filePath(): string {
  return process.env.WORKSPACE_FILE || DEFAULT_FILE_PATH
}

async function withFileState<T>(
  action: (state: FileWorkspaceState) => T | Promise<T>,
  persist = false,
): Promise<T> {
  const previous = workspaceGlobal.__geoWorkspaceFileQueue || Promise.resolve()
  const operation = previous.catch(() => undefined).then(async () => {
    const state = await loadFileState()
    const result = await action(state)
    if (persist) await saveFileState(state)
    return result
  })
  workspaceGlobal.__geoWorkspaceFileQueue = operation.then(() => undefined, () => undefined)
  return operation
}

async function loadFileState(): Promise<FileWorkspaceState> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(/* turbopackIgnore: true */ filePath(), "utf8"),
    ) as FileWorkspaceState
    if (parsed && typeof parsed === "object" && parsed.users) return parsed
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : ""
    if (code !== "ENOENT") console.warn("[workspace-file] load failed", error)
  }
  return { users: {} }
}

async function saveFileState(state: FileWorkspaceState): Promise<void> {
  const target = filePath()
  await fs.mkdir(/* turbopackIgnore: true */ path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(/* turbopackIgnore: true */ temporary, JSON.stringify(state), "utf8")
  await fs.rename(/* turbopackIgnore: true */ temporary, target)
}

function fileUser(state: FileWorkspaceState, userId: string): FileUserState {
  state.users[userId] ||= { clients: {}, imports: {} }
  return state.users[userId]
}

function listFileClients(state: FileWorkspaceState, userId: string): SyncedClient[] {
  return Object.values(fileUser(state, userId).clients)
    .filter(record => !record.deletedAt)
    .map(syncedFromRecord)
    .sort((a, b) => b.client.updatedAt.localeCompare(a.client.updatedAt))
}

function listFileClientSummaries(
  state: FileWorkspaceState,
  userId: string,
): WorkspaceClientSummary[] {
  return Object.values(fileUser(state, userId).clients)
    .filter(record => !record.deletedAt)
    .map(record => summaryFromCore(record.sections.core || {}, record.versions))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function snapshotFromRecord(
  clientId: string,
  record: WorkspaceRecord,
  requestedSections: WorkspaceSection[],
): WorkspaceSectionSnapshot {
  const sections: WorkspaceSectionSnapshot["sections"] = {}
  for (const section of requestedSections) {
    sections[section] = structuredClone(record.sections[section] || {})
  }
  return {
    clientId,
    sections,
    versions: { ...record.versions },
    loadedSections: requestedSections,
  }
}

function summaryFromCore(
  core: Record<string, unknown>,
  versions: Partial<Record<WorkspaceSection, number>>,
): WorkspaceClientSummary {
  const questions = Array.isArray(core.questions) ? core.questions : []
  const selectedModels = Array.isArray(core.selectedModels) ? core.selectedModels : []
  const completedModules = WORKSPACE_SECTIONS.filter(section => (
    section !== "core"
    && section !== "jobs"
    && section !== "knowledgeBase"
    && Number(versions[section] || 0) > 0
  ))
  const subjectType: AnalysisSubjectType = core.subjectType === "person" ? "person" : "brand"
  return {
    id: String(core.id || ""),
    name: String(core.name || "未命名客户"),
    subjectType,
    ourBrand: String(core.ourBrand || ""),
    industry: String(core.industry || ""),
    website: String(core.website || ""),
    createdAt: String(core.createdAt || ""),
    updatedAt: String(core.updatedAt || core.createdAt || ""),
    questionCount: questions.length,
    selectedModelCount: selectedModels.length,
    completedModules,
    versions: normalizeWorkspaceVersions(versions),
  }
}

function importFileClients(
  state: FileWorkspaceState,
  userId: string,
  importId: string,
  clients: Client[],
): WorkspaceImportResult {
  const user = fileUser(state, userId)
  const prior = user.imports[importId]
  if (prior) {
    return {
      importedCount: prior.importedCount,
      duplicatedCount: Number(prior.duplicatedCount || 0),
      alreadyImported: true,
      clients: listFileClients(state, userId),
    }
  }
  let duplicatedCount = 0
  for (const original of clients) {
    let client = original
    if (user.clients[client.id] && !user.clients[client.id].deletedAt) {
      duplicatedCount += 1
      client = {
        ...client,
        id: randomUUID(),
        name: `${client.name}（本机导入）`.slice(0, 160),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    }
    user.clients[client.id] = recordFromClient(client)
  }
  user.imports[importId] = {
    importedAt: new Date().toISOString(),
    importedCount: clients.length,
    duplicatedCount,
  }
  return {
    importedCount: clients.length,
    duplicatedCount,
    alreadyImported: false,
    clients: listFileClients(state, userId),
  }
}
