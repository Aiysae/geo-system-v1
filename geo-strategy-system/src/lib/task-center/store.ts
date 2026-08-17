import "server-only"

import { createHash } from "crypto"
import { Pool } from "pg"
import { kv } from "@/lib/kv"
import { resolveOperationAccess } from "@/lib/team-access"
import {
  isTaskCenterTerminalStatus,
  type TaskCenterListResponse,
  type TaskCenterListQuery,
  type TaskCenterModule,
  type TaskCenterSource,
  type TaskCenterStatus,
  type TaskCenterTask,
  type TaskCenterTaskInput,
} from "@/types/task-center"

type StoredTaskCenterTask = Omit<TaskCenterTaskInput, "canCancel"> & {
  id: string
  canCancel: boolean
}

export type TaskCenterCancellationTarget = {
  id: string
  source: TaskCenterSource
  sourceJobId: string
  module: TaskCenterModule
  actorUserId: string
  workspaceOwnerUserId: string
  clientId: string
  status: TaskCenterStatus
  canCancel: boolean
  teamId?: string
}

type TaskCenterRow = {
  id: string
  source: string
  source_job_id: string
  kind: string
  module: string
  actor_user_id: string
  workspace_owner_user_id: string
  client_id: string
  client_name: string | null
  title: string
  status: string
  progress_percent: number
  stage: string
  error: string | null
  result_url: string | null
  can_cancel: boolean
  created_at: Date | string
  updated_at: Date | string
  started_at: Date | string | null
  finished_at: Date | string | null
  metadata: unknown
  read_at?: Date | string | null
}

type TaskCenterGlobal = typeof globalThis & {
  __geoTaskCenterPool?: Pool
  __geoTaskCenterSchemaPromise?: Promise<unknown>
}

const globalState = globalThis as TaskCenterGlobal
const TASK_TTL_SECONDS = 60 * 60 * 24 * 365
const MAX_LIST_LIMIT = 100
const TASK_CENTER_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS geo_tasks_v1 (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_job_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  module TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  workspace_owner_user_id TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  client_name TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  progress_percent INTEGER NOT NULL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT '',
  error TEXT,
  result_url TEXT,
  can_cancel BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source, source_job_id)
);
CREATE INDEX IF NOT EXISTS geo_tasks_v1_actor_created_idx
  ON geo_tasks_v1 (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS geo_tasks_v1_workspace_created_idx
  ON geo_tasks_v1 (workspace_owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS geo_tasks_v1_status_updated_idx
  ON geo_tasks_v1 (status, updated_at DESC);
CREATE TABLE IF NOT EXISTS geo_task_reads_v1 (
  task_id TEXT NOT NULL REFERENCES geo_tasks_v1(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS geo_task_reads_v1_user_read_idx
  ON geo_task_reads_v1 (user_id, read_at DESC);
`

const SOURCES: TaskCenterSource[] = [
  "background",
  "penetration",
  "difficulty",
  "question",
  "articleBatch",
  "articleMedia",
  "contentProduction",
  "report",
]
const MODULES: TaskCenterModule[] = [
  "penetration",
  "research",
  "diagnosis",
  "difficulty",
  "keyword",
  "article",
  "report",
]
const STATUSES: TaskCenterStatus[] = [
  "queued",
  "running",
  "retrying",
  "succeeded",
  "partial",
  "failed",
  "cancelled",
  "blocked",
]

function backend(): "postgres" | "kv" {
  const configured = String(process.env.TASK_CENTER_STORE || "").trim().toLowerCase()
  if (configured === "kv") return "kv"
  if (configured === "postgres") return "postgres"
  return process.env.DATABASE_URL ? "postgres" : "kv"
}

function pool(): Pool {
  if (globalState.__geoTaskCenterPool) return globalState.__geoTaskCenterPool
  const connectionString = String(process.env.DATABASE_URL || "").trim()
  if (!connectionString) throw new Error("DATABASE_URL is required for task center storage")
  globalState.__geoTaskCenterPool = new Pool({
    connectionString,
    max: Math.max(1, Math.min(6, Number(process.env.TASK_CENTER_DB_POOL_MAX) || 3)),
    ssl: /^(1|true|yes|on)$/i.test(String(process.env.DATABASE_SSL || ""))
      ? { rejectUnauthorized: false }
      : undefined,
  })
  return globalState.__geoTaskCenterPool
}

async function ensureSchema(): Promise<void> {
  if (backend() !== "postgres") return
  if (!globalState.__geoTaskCenterSchemaPromise) {
    globalState.__geoTaskCenterSchemaPromise = pool().query(TASK_CENTER_SCHEMA_SQL)
  }
  await globalState.__geoTaskCenterSchemaPromise
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24)
}

export function taskCenterTaskId(source: TaskCenterSource, sourceJobId: string): string {
  return `task_${source}_${sourceJobId}`
}

const taskKey = (id: string) => `geo:task-center:task:${id}`
const actorIndexKey = (userId: string) => `geo:task-center:actor:${hash(userId)}`
const workspaceIndexKey = (userId: string) => `geo:task-center:workspace:${hash(userId)}`
const readKey = (taskIdValue: string, userId: string) =>
  `geo:task-center:read:${hash(userId)}:${taskIdValue}`

function asIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined
}

function cleanText(value: unknown, max: number, fallback = ""): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max) || fallback
}

function enumValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  const candidate = String(value || "") as T
  return values.includes(candidate) ? candidate : fallback
}

function normalizeInput(input: TaskCenterTaskInput): StoredTaskCenterTask {
  const source = enumValue(input.source, SOURCES, "background")
  const sourceJobId = cleanText(input.sourceJobId, 220)
  const actorUserId = cleanText(input.actorUserId, 220)
  const workspaceOwnerUserId = cleanText(input.workspaceOwnerUserId, 220)
  if (!sourceJobId || !actorUserId || !workspaceOwnerUserId) {
    throw new Error("任务中心记录缺少任务或账号标识")
  }
  const createdAt = asIso(input.createdAt) || new Date().toISOString()
  const updatedAt = asIso(input.updatedAt) || createdAt
  return {
    id: taskCenterTaskId(source, sourceJobId),
    source,
    sourceJobId,
    kind: cleanText(input.kind, 120, source),
    module: enumValue(input.module, MODULES, "article"),
    actorUserId,
    workspaceOwnerUserId,
    clientId: cleanText(input.clientId, 220),
    clientName: cleanText(input.clientName, 180) || undefined,
    title: cleanText(input.title, 180, "后台任务"),
    status: enumValue(input.status, STATUSES, "queued"),
    progressPercent: Math.max(0, Math.min(100, Math.round(Number(input.progressPercent) || 0))),
    stage: cleanText(input.stage, 300),
    error: cleanText(input.error, 800) || undefined,
    resultUrl: cleanText(input.resultUrl, 500) || undefined,
    canCancel: input.canCancel === true,
    createdAt,
    updatedAt,
    startedAt: asIso(input.startedAt),
    finishedAt: asIso(input.finishedAt),
    metadata: input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? input.metadata
      : {},
  }
}

function normalizeStored(value: unknown): StoredTaskCenterTask | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  try {
    return normalizeInput(value as StoredTaskCenterTask)
  } catch {
    return null
  }
}

function fromRow(row: TaskCenterRow): StoredTaskCenterTask {
  return normalizeInput({
    source: enumValue(row.source, SOURCES, "background"),
    sourceJobId: row.source_job_id,
    kind: row.kind,
    module: enumValue(row.module, MODULES, "article"),
    actorUserId: row.actor_user_id,
    workspaceOwnerUserId: row.workspace_owner_user_id,
    clientId: row.client_id,
    clientName: row.client_name || undefined,
    title: row.title,
    status: enumValue(row.status, STATUSES, "queued"),
    progressPercent: row.progress_percent,
    stage: row.stage,
    error: row.error || undefined,
    resultUrl: row.result_url || undefined,
    canCancel: row.can_cancel,
    createdAt: asIso(row.created_at) || new Date().toISOString(),
    updatedAt: asIso(row.updated_at) || new Date().toISOString(),
    startedAt: asIso(row.started_at),
    finishedAt: asIso(row.finished_at),
    metadata: row.metadata && typeof row.metadata === "object"
      ? row.metadata as Record<string, unknown>
      : {},
  })
}

function isVisible(task: StoredTaskCenterTask, userId: string): boolean {
  return task.actorUserId === userId || task.workspaceOwnerUserId === userId
}

async function isAuthorizedVisible(
  task: StoredTaskCenterTask,
  userId: string,
): Promise<boolean> {
  if (!isVisible(task, userId)) return false
  if (task.workspaceOwnerUserId === userId || task.workspaceOwnerUserId === task.actorUserId) {
    return true
  }
  if (task.actorUserId !== userId || !task.clientId) return false
  const result = await resolveOperationAccess({
    userId,
    clientId: task.clientId,
    module: task.module,
    action: "view",
    teamId: typeof task.metadata?.teamId === "string"
      ? task.metadata.teamId
      : undefined,
  })
  return result.ok && result.access.dataOwnerUserId === task.workspaceOwnerUserId
}

async function publicTask(
  task: StoredTaskCenterTask,
  userId: string,
  readAt?: unknown,
): Promise<TaskCenterTask> {
  const wasRead = readAt !== undefined
    ? Boolean(readAt)
    : Boolean(await kv.get<string>(readKey(task.id, userId)))
  return {
    id: task.id,
    source: task.source,
    sourceJobId: task.sourceJobId,
    kind: task.kind,
    module: task.module,
    clientId: task.clientId,
    clientName: task.clientName,
    teamId: typeof task.metadata?.teamId === "string" ? task.metadata.teamId : undefined,
    title: task.title,
    status: task.status,
    progressPercent: task.progressPercent,
    stage: task.stage,
    error: task.error,
    resultUrl: task.resultUrl,
    canCancel: task.canCancel,
    scope: task.actorUserId === userId ? "mine" : "workspace",
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    unread: isTaskCenterTerminalStatus(task.status) && !wasRead,
  }
}

async function upsertPostgres(task: StoredTaskCenterTask): Promise<void> {
  await ensureSchema()
  await pool().query(
    `INSERT INTO geo_tasks_v1 (
      id, source, source_job_id, kind, module, actor_user_id, workspace_owner_user_id,
      client_id, client_name, title, status, progress_percent, stage, error, result_url,
      can_cancel, created_at, updated_at, started_at, finished_at, metadata
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
      $16, $17::timestamptz, $18::timestamptz, $19::timestamptz, $20::timestamptz, $21::jsonb
    )
    ON CONFLICT (id) DO UPDATE SET
      kind = EXCLUDED.kind,
      module = EXCLUDED.module,
      actor_user_id = EXCLUDED.actor_user_id,
      workspace_owner_user_id = EXCLUDED.workspace_owner_user_id,
      client_id = EXCLUDED.client_id,
      client_name = COALESCE(EXCLUDED.client_name, geo_tasks_v1.client_name),
      title = EXCLUDED.title,
      status = EXCLUDED.status,
      progress_percent = EXCLUDED.progress_percent,
      stage = EXCLUDED.stage,
      error = EXCLUDED.error,
      result_url = COALESCE(EXCLUDED.result_url, geo_tasks_v1.result_url),
      can_cancel = EXCLUDED.can_cancel,
      updated_at = EXCLUDED.updated_at,
      started_at = COALESCE(EXCLUDED.started_at, geo_tasks_v1.started_at),
      finished_at = EXCLUDED.finished_at,
      metadata = EXCLUDED.metadata`,
    [
      task.id,
      task.source,
      task.sourceJobId,
      task.kind,
      task.module,
      task.actorUserId,
      task.workspaceOwnerUserId,
      task.clientId,
      task.clientName || null,
      task.title,
      task.status,
      task.progressPercent,
      task.stage,
      task.error || null,
      task.resultUrl || null,
      task.canCancel,
      task.createdAt,
      task.updatedAt,
      task.startedAt || null,
      task.finishedAt || null,
      JSON.stringify(task.metadata || {}),
    ],
  )
}

async function upsertKv(task: StoredTaskCenterTask): Promise<void> {
  const existing = normalizeStored(await kv.get<StoredTaskCenterTask>(taskKey(task.id)))
  if (existing && existing.actorUserId !== task.actorUserId) {
    await kv.srem(actorIndexKey(existing.actorUserId), task.id)
  }
  if (existing && existing.workspaceOwnerUserId !== task.workspaceOwnerUserId) {
    await kv.srem(workspaceIndexKey(existing.workspaceOwnerUserId), task.id)
  }
  await kv.set(taskKey(task.id), task, { ex: TASK_TTL_SECONDS })
  await Promise.all([
    kv.sadd(actorIndexKey(task.actorUserId), task.id),
    kv.sadd(workspaceIndexKey(task.workspaceOwnerUserId), task.id),
  ])
}

export async function upsertTaskCenterTask(input: TaskCenterTaskInput): Promise<void> {
  const task = normalizeInput(input)
  if (backend() === "postgres") await upsertPostgres(task)
  else await upsertKv(task)
}

export async function syncTaskCenterTask(input: TaskCenterTaskInput): Promise<void> {
  try {
    await upsertTaskCenterTask(input)
  } catch (error) {
    console.error(
      "[task-center] task sync failed",
      input.source,
      input.sourceJobId,
      error instanceof Error ? error.message : error,
    )
  }
}

type TaskCursor = {
  rank: number
  updatedAt: string
  id: string
}

function taskRank(status: TaskCenterStatus): number {
  return isTaskCenterTerminalStatus(status) ? 1 : 0
}

function encodeCursor(task: Pick<TaskCenterTask, "id" | "status" | "updatedAt">): string {
  return Buffer.from(JSON.stringify({
    rank: taskRank(task.status),
    updatedAt: task.updatedAt,
    id: task.id,
  } satisfies TaskCursor), "utf8").toString("base64url")
}

function decodeCursor(value: string | undefined): TaskCursor | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<TaskCursor>
    const rank = Number(parsed.rank)
    const updatedAt = String(parsed.updatedAt || "")
    const id = String(parsed.id || "")
    if ((rank !== 0 && rank !== 1) || !Number.isFinite(Date.parse(updatedAt)) || !id) return undefined
    return { rank, updatedAt: new Date(updatedAt).toISOString(), id }
  } catch {
    return undefined
  }
}

function normalizeListQuery(value: number | TaskCenterListQuery): Required<Pick<TaskCenterListQuery, "limit">> & TaskCenterListQuery {
  const source = typeof value === "number" ? { limit: value } : value
  const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(Number(source.limit) || 50)))
  return {
    ...source,
    limit,
    clientId: cleanText(source.clientId, 220) || undefined,
    teamId: cleanText(source.teamId, 220) || undefined,
    modules: source.modules?.filter(module => MODULES.includes(module)),
    clientFilters: source.clientFilters
      ?.map(filter => ({
        clientId: cleanText(filter.clientId, 220),
        teamId: cleanText(filter.teamId, 220) || undefined,
      }))
      .filter(filter => Boolean(filter.clientId)),
  }
}

function matchesQuery(task: StoredTaskCenterTask, query: ReturnType<typeof normalizeListQuery>): boolean {
  const teamId = typeof task.metadata?.teamId === "string" ? task.metadata.teamId : undefined
  if (query.clientId && task.clientId !== query.clientId) return false
  if (query.teamId !== undefined && teamId !== query.teamId) return false
  if (query.status && task.status !== query.status) return false
  if (query.modules?.length && !query.modules.includes(task.module)) return false
  if (query.clientFilters?.length && !query.clientFilters.some(filter => (
    filter.clientId === task.clientId && filter.teamId === teamId
  ))) return false
  return true
}

function isAfterCursor(task: StoredTaskCenterTask, cursor: TaskCursor | undefined): boolean {
  if (!cursor) return true
  const rank = taskRank(task.status)
  if (rank !== cursor.rank) return rank > cursor.rank
  if (task.updatedAt !== cursor.updatedAt) return task.updatedAt < cursor.updatedAt
  return task.id < cursor.id
}

async function listPostgres(
  userId: string,
  query: ReturnType<typeof normalizeListQuery>,
): Promise<{ tasks: TaskCenterTask[]; nextCursor?: string }> {
  await ensureSchema()
  const params: unknown[] = [userId]
  const where = ["(task.actor_user_id = $1 OR task.workspace_owner_user_id = $1)"]
  const addParam = (value: unknown): string => {
    params.push(value)
    return `$${params.length}`
  }
  if (query.clientId) where.push(`task.client_id = ${addParam(query.clientId)}`)
  if (query.teamId !== undefined) {
    where.push(`COALESCE(task.metadata->>'teamId', '') = ${addParam(query.teamId || "")}`)
  }
  if (query.status) where.push(`task.status = ${addParam(query.status)}`)
  if (query.modules?.length) where.push(`task.module = ANY(${addParam(query.modules)}::text[])`)
  if (query.clientFilters?.length) {
    const filters = query.clientFilters.map(filter => {
      const client = addParam(filter.clientId)
      const team = addParam(filter.teamId || "")
      return `(task.client_id = ${client} AND COALESCE(task.metadata->>'teamId', '') = ${team})`
    })
    where.push(`(${filters.join(" OR ")})`)
  }
  const cursor = decodeCursor(query.cursor)
  if (query.cursor && !cursor) throw new Error("任务列表 cursor 无效")
  if (cursor) {
    const rank = addParam(cursor.rank)
    const updatedAt = addParam(cursor.updatedAt)
    const id = addParam(cursor.id)
    const rankSql = "CASE WHEN task.status IN ('queued', 'running', 'retrying') THEN 0 ELSE 1 END"
    where.push(`(${rankSql} > ${rank} OR (${rankSql} = ${rank} AND (task.updated_at < ${updatedAt}::timestamptz OR (task.updated_at = ${updatedAt}::timestamptz AND task.id < ${id}))))`)
  }
  const fetchLimit = Math.min(600, Math.max(query.limit + 1, query.limit * 5))
  params.push(fetchLimit)
  const result = await pool().query<TaskCenterRow>(
    `SELECT task.*, reads.read_at
     FROM geo_tasks_v1 task
     LEFT JOIN geo_task_reads_v1 reads
       ON reads.task_id = task.id AND reads.user_id = $1
     WHERE ${where.join(" AND ")}
     ORDER BY
       CASE WHEN task.status IN ('queued', 'running', 'retrying') THEN 0 ELSE 1 END,
       task.updated_at DESC,
       task.id DESC
     LIMIT $${params.length}`,
    params,
  )
  const checked = await Promise.all(result.rows.map(async row => ({
    row,
    task: fromRow(row),
    allowed: await isAuthorizedVisible(fromRow(row), userId),
  })))
  const allowed = checked.filter(item => item.allowed)
  const page = allowed.slice(0, query.limit)
  const tasks = await Promise.all(page.map(item => publicTask(item.task, userId, item.row.read_at)))
  const hasMore = allowed.length > query.limit || result.rows.length === fetchLimit
  const cursorTask = page.at(-1)?.task || (hasMore ? checked.at(-1)?.task : undefined)
  return {
    tasks,
    nextCursor: hasMore && cursorTask ? encodeCursor(cursorTask) : undefined,
  }
}

async function listKv(
  userId: string,
  query: ReturnType<typeof normalizeListQuery>,
): Promise<{ tasks: TaskCenterTask[]; nextCursor?: string }> {
  const [actorIds, workspaceIds] = await Promise.all([
    kv.smembers<string[]>(actorIndexKey(userId)),
    kv.smembers<string[]>(workspaceIndexKey(userId)),
  ])
  const ids = Array.from(new Set([...(actorIds || []), ...(workspaceIds || [])]))
  const loaded = await Promise.all(ids.map(id => kv.get<StoredTaskCenterTask>(taskKey(id))))
  const missing = ids.filter((_, index) => !loaded[index])
  if (missing.length > 0) {
    await Promise.all([
      kv.srem(actorIndexKey(userId), ...missing),
      kv.srem(workspaceIndexKey(userId), ...missing),
    ])
  }
  const candidates = loaded
    .map(normalizeStored)
    .filter((task): task is StoredTaskCenterTask => Boolean(
      task
      && isVisible(task, userId)
      && matchesQuery(task, query)
      && isAfterCursor(task, decodeCursor(query.cursor)),
    ))
  const allowed = await Promise.all(candidates.map(task => isAuthorizedVisible(task, userId)))
  const tasks = candidates
    .filter((_, index) => allowed[index])
    .sort((left, right) => {
      const leftActive = isTaskCenterTerminalStatus(left.status) ? 1 : 0
      const rightActive = isTaskCenterTerminalStatus(right.status) ? 1 : 0
      return leftActive - rightActive
        || right.updatedAt.localeCompare(left.updatedAt)
        || right.id.localeCompare(left.id)
    })
  if (query.cursor && !decodeCursor(query.cursor)) throw new Error("任务列表 cursor 无效")
  const page = tasks.slice(0, query.limit)
  return {
    tasks: await Promise.all(page.map(task => publicTask(task, userId))),
    nextCursor: tasks.length > query.limit && page.length > 0
      ? encodeCursor(page[page.length - 1])
      : undefined,
  }
}

export async function listTaskCenterTasks(
  userId: string,
  requested: number | TaskCenterListQuery = 50,
): Promise<TaskCenterListResponse> {
  const query = normalizeListQuery(requested)
  const page = backend() === "postgres"
    ? await listPostgres(userId, query)
    : await listKv(userId, query)
  return {
    tasks: page.tasks,
    activeCount: page.tasks.filter(task => !isTaskCenterTerminalStatus(task.status)).length,
    unreadCount: page.tasks.filter(task => task.unread).length,
    serverTime: new Date().toISOString(),
    nextCursor: page.nextCursor,
  }
}

export async function getTaskCenterTask(
  taskIdValue: string,
  userId: string,
): Promise<TaskCenterTask | null> {
  const task = await getStored(taskIdValue)
  if (!task || !await isAuthorizedVisible(task, userId)) return null
  return publicTask(task, userId)
}

async function getPostgres(id: string): Promise<StoredTaskCenterTask | null> {
  await ensureSchema()
  const result = await pool().query<TaskCenterRow>(
    "SELECT * FROM geo_tasks_v1 WHERE id = $1 OR source_job_id = $1 ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END LIMIT 1",
    [id],
  )
  return result.rows[0] ? fromRow(result.rows[0]) : null
}

async function getStored(id: string): Promise<StoredTaskCenterTask | null> {
  if (backend() === "postgres") return getPostgres(id)
  const exact = normalizeStored(await kv.get<StoredTaskCenterTask>(taskKey(id)))
  if (exact || id.startsWith("task_")) return exact
  for (const source of SOURCES) {
    const candidate = normalizeStored(await kv.get<StoredTaskCenterTask>(taskKey(taskCenterTaskId(source, id))))
    if (candidate) return candidate
  }
  return null
}

export async function markTaskCenterTaskRead(
  taskIdValue: string,
  userId: string,
): Promise<boolean> {
  const task = await getStored(taskIdValue)
  if (!task || !await isAuthorizedVisible(task, userId)) return false
  const readAt = new Date().toISOString()
  if (backend() === "postgres") {
    await ensureSchema()
    await pool().query(
      `INSERT INTO geo_task_reads_v1 (task_id, user_id, read_at)
       VALUES ($1, $2, $3::timestamptz)
       ON CONFLICT (task_id, user_id) DO UPDATE SET read_at = EXCLUDED.read_at`,
      [task.id, userId, readAt],
    )
  } else {
    await kv.set(readKey(task.id, userId), readAt, { ex: TASK_TTL_SECONDS })
  }
  return true
}

export async function markAllTaskCenterTasksRead(userId: string): Promise<number> {
  const response = await listTaskCenterTasks(userId, MAX_LIST_LIMIT)
  const unread = response.tasks.filter(task => task.unread)
  await Promise.all(unread.map(task => markTaskCenterTaskRead(task.id, userId)))
  return unread.length
}

export async function getTaskCenterCancellationTarget(
  taskIdValue: string,
  userId: string,
): Promise<TaskCenterCancellationTarget | null> {
  const task = await getStored(taskIdValue)
  if (!task || !await isAuthorizedVisible(task, userId)) return null

  const teamId = typeof task.metadata?.teamId === "string"
    ? task.metadata.teamId
    : undefined

  return {
    id: task.id,
    source: task.source,
    sourceJobId: task.sourceJobId,
    module: task.module,
    actorUserId: task.actorUserId,
    workspaceOwnerUserId: task.workspaceOwnerUserId,
    clientId: task.clientId,
    status: task.status,
    canCancel: task.canCancel,
    teamId,
  }
}
