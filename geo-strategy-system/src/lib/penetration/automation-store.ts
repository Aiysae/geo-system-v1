import "server-only"

import fs from "fs/promises"
import path from "path"
import { createHash, randomUUID } from "crypto"
import { Pool, type PoolClient } from "pg"
import { PENETRATION_AUTOMATION_SCHEMA_SQL } from "@/lib/penetration/automation-schema"
import {
  nextPenetrationAutomationRun,
  normalizeAutomationDate,
  normalizeAutomationIntervalDays,
  normalizeAutomationThreshold,
  normalizeAutomationTimeLocal,
  normalizeMinimumAbsoluteDrop,
  normalizeMonthlyCreditLimit,
} from "@/lib/penetration/automation-time"
import {
  PENETRATION_AUTOMATION_TIMEZONE,
  type PenetrationAutomationExecution,
  type PenetrationAutomationExecutionStatus,
  type PenetrationAutomationInputSnapshot,
  type PenetrationAutomationSchedule,
  type PenetrationAutomationScheduleInput,
  type PenetrationAutomationTrigger,
} from "@/lib/penetration/automation-types"

type ScheduleRow = {
  owner_user_id: string
  id: string
  client_id: string
  client_name: string
  created_by_user_id: string
  actor_user_id: string
  billing_user_id: string
  team_id?: string | null
  status: PenetrationAutomationSchedule["status"]
  interval_days: number
  time_local: string
  timezone: string
  start_date: string
  relative_drop_threshold_pct: string | number
  minimum_absolute_drop_points: string | number
  in_app_enabled: boolean
  email_enabled: boolean
  monthly_credit_limit?: number | null
  next_run_at?: string | Date | null
  last_scheduled_for?: string | Date | null
  last_started_at?: string | Date | null
  last_completed_at?: string | Date | null
  last_execution_id?: string | null
  last_job_id?: string | null
  last_history_record_id?: string | null
  consecutive_failures: number
  last_error?: string | null
  created_at: string | Date
  updated_at: string | Date
  deleted_at?: string | Date | null
}

type ExecutionRow = {
  owner_user_id: string
  id: string
  schedule_id: string
  client_id: string
  client_name: string
  actor_user_id: string
  billing_user_id: string
  team_id?: string | null
  trigger: PenetrationAutomationTrigger
  scheduled_for: string | Date
  dedupe_key: string
  status: PenetrationAutomationExecutionStatus
  attempt_count: number
  next_attempt_at?: string | Date | null
  job_id?: string | null
  history_record_id?: string | null
  input_snapshot?: PenetrationAutomationInputSnapshot | null
  estimated_credits: number
  used_credits?: number | null
  baseline_history_record_id?: string | null
  baseline_rate?: string | number | null
  current_rate?: string | number | null
  absolute_drop_points?: string | number | null
  relative_drop_pct?: string | number | null
  comparable?: boolean | null
  comparison_reason?: string | null
  alert_triggered: boolean
  alert_sent_at?: string | Date | null
  error?: string | null
  created_at: string | Date
  started_at?: string | Date | null
  completed_at?: string | Date | null
  updated_at: string | Date
}

type StoredFileSchedule = PenetrationAutomationSchedule & { deletedAt?: string }
type StoredFileExecution = PenetrationAutomationExecution & { dedupeKey: string }
type AutomationFileState = {
  schedules: Record<string, StoredFileSchedule>
  executions: Record<string, StoredFileExecution>
}

export type UpsertPenetrationAutomationScheduleInput = PenetrationAutomationScheduleInput & {
  ownerUserId: string
  clientId: string
  clientName: string
  actorUserId: string
  billingUserId: string
  teamId?: string
  status?: PenetrationAutomationSchedule["status"]
}

export type PatchPenetrationAutomationExecution = Partial<Pick<
  PenetrationAutomationExecution,
  | "status"
  | "attemptCount"
  | "nextAttemptAt"
  | "jobId"
  | "historyRecordId"
  | "inputSnapshot"
  | "estimatedCredits"
  | "usedCredits"
  | "baselineHistoryRecordId"
  | "baselineRate"
  | "currentRate"
  | "absoluteDropPoints"
  | "relativeDropPct"
  | "comparable"
  | "comparisonReason"
  | "alertTriggered"
  | "alertSentAt"
  | "error"
  | "startedAt"
  | "completedAt"
>>

const DEFAULT_FILE_PATH = process.env.NODE_ENV === "production"
  ? "/var/lib/geo-system/penetration-automations.json"
  : path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "penetration-automations.json")

const storeGlobal = globalThis as typeof globalThis & {
  __geoPenetrationAutomationPool?: Pool
  __geoPenetrationAutomationSchemaPromise?: Promise<void>
  __geoPenetrationAutomationFileQueue?: Promise<unknown>
}

function backend(): "postgres" | "file" {
  const configured = String(process.env.PENETRATION_AUTOMATION_STORE || "").trim().toLowerCase()
  if (configured === "postgres" || configured === "file") return configured
  if (configured) throw new Error(`Unsupported PENETRATION_AUTOMATION_STORE: ${configured}`)
  return process.env.DATABASE_URL ? "postgres" : "file"
}

function pool(): Pool {
  if (storeGlobal.__geoPenetrationAutomationPool) return storeGlobal.__geoPenetrationAutomationPool
  const connectionString = String(process.env.DATABASE_URL || "").trim()
  if (!connectionString) throw new Error("DATABASE_URL is required when automation store uses postgres")
  storeGlobal.__geoPenetrationAutomationPool = new Pool({
    connectionString,
    max: Math.max(1, Math.min(4, Number(process.env.PENETRATION_AUTOMATION_DB_POOL_MAX) || 2)),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  })
  storeGlobal.__geoPenetrationAutomationPool.on("error", error => {
    console.error(`[penetration-automation-db] ${error.message}`)
  })
  return storeGlobal.__geoPenetrationAutomationPool
}

export async function ensurePenetrationAutomationSchema(): Promise<void> {
  if (backend() !== "postgres") return
  if (!storeGlobal.__geoPenetrationAutomationSchemaPromise) {
    storeGlobal.__geoPenetrationAutomationSchemaPromise = pool()
      .query(PENETRATION_AUTOMATION_SCHEMA_SQL)
      .then(() => undefined)
      .catch(error => {
        storeGlobal.__geoPenetrationAutomationSchemaPromise = undefined
        throw error
      })
  }
  await storeGlobal.__geoPenetrationAutomationSchemaPromise
}

function iso(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

function optionalNumber(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function scheduleFromRow(row: ScheduleRow): PenetrationAutomationSchedule {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    clientId: row.client_id,
    clientName: row.client_name,
    createdByUserId: row.created_by_user_id,
    actorUserId: row.actor_user_id,
    billingUserId: row.billing_user_id,
    teamId: row.team_id || undefined,
    status: row.status,
    intervalDays: Number(row.interval_days),
    timeLocal: row.time_local,
    timezone: PENETRATION_AUTOMATION_TIMEZONE,
    startDate: row.start_date,
    relativeDropThresholdPct: Number(row.relative_drop_threshold_pct),
    minimumAbsoluteDropPoints: Number(row.minimum_absolute_drop_points),
    inAppEnabled: row.in_app_enabled,
    emailEnabled: row.email_enabled,
    monthlyCreditLimit: optionalNumber(row.monthly_credit_limit),
    nextRunAt: iso(row.next_run_at),
    lastScheduledFor: iso(row.last_scheduled_for),
    lastStartedAt: iso(row.last_started_at),
    lastCompletedAt: iso(row.last_completed_at),
    lastExecutionId: row.last_execution_id || undefined,
    lastJobId: row.last_job_id || undefined,
    lastHistoryRecordId: row.last_history_record_id || undefined,
    consecutiveFailures: Number(row.consecutive_failures || 0),
    lastError: row.last_error || undefined,
    createdAt: iso(row.created_at) || new Date().toISOString(),
    updatedAt: iso(row.updated_at) || new Date().toISOString(),
  }
}

function executionFromRow(row: ExecutionRow): PenetrationAutomationExecution {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    ownerUserId: row.owner_user_id,
    clientId: row.client_id,
    clientName: row.client_name,
    actorUserId: row.actor_user_id,
    billingUserId: row.billing_user_id,
    teamId: row.team_id || undefined,
    trigger: row.trigger,
    scheduledFor: iso(row.scheduled_for) || new Date().toISOString(),
    status: row.status,
    attemptCount: Number(row.attempt_count || 0),
    nextAttemptAt: iso(row.next_attempt_at),
    jobId: row.job_id || undefined,
    historyRecordId: row.history_record_id || undefined,
    inputSnapshot: row.input_snapshot || undefined,
    estimatedCredits: Number(row.estimated_credits || 0),
    usedCredits: optionalNumber(row.used_credits),
    baselineHistoryRecordId: row.baseline_history_record_id || undefined,
    baselineRate: optionalNumber(row.baseline_rate),
    currentRate: optionalNumber(row.current_rate),
    absoluteDropPoints: optionalNumber(row.absolute_drop_points),
    relativeDropPct: optionalNumber(row.relative_drop_pct),
    comparable: row.comparable === null || row.comparable === undefined
      ? undefined
      : Boolean(row.comparable),
    comparisonReason: row.comparison_reason || undefined,
    alertTriggered: Boolean(row.alert_triggered),
    alertSentAt: iso(row.alert_sent_at),
    error: row.error || undefined,
    createdAt: iso(row.created_at) || new Date().toISOString(),
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    updatedAt: iso(row.updated_at) || new Date().toISOString(),
  }
}

function stripStoredSchedule(stored: StoredFileSchedule): PenetrationAutomationSchedule {
  const schedule: Partial<StoredFileSchedule> = { ...stored }
  delete schedule.deletedAt
  return schedule as PenetrationAutomationSchedule
}

function stripStoredExecution(stored: StoredFileExecution): PenetrationAutomationExecution {
  const execution: Partial<StoredFileExecution> = { ...stored }
  delete execution.dedupeKey
  return execution as PenetrationAutomationExecution
}

function scheduleKey(ownerUserId: string, id: string): string {
  return `${ownerUserId}\u0000${id}`
}

function executionKey(ownerUserId: string, id: string): string {
  return `${ownerUserId}\u0000${id}`
}

function automationFilePath(): string {
  return String(process.env.PENETRATION_AUTOMATION_FILE || DEFAULT_FILE_PATH)
}

async function loadFileState(): Promise<AutomationFileState> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(/* turbopackIgnore: true */ automationFilePath(), "utf8"),
    ) as AutomationFileState
    if (parsed?.schedules && parsed?.executions) return parsed
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : ""
    if (code !== "ENOENT") console.warn("[penetration-automation-file] load failed", error)
  }
  return { schedules: {}, executions: {} }
}

async function saveFileState(state: AutomationFileState): Promise<void> {
  const target = automationFilePath()
  await fs.mkdir(/* turbopackIgnore: true */ path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(/* turbopackIgnore: true */ temporary, JSON.stringify(state), "utf8")
  await fs.rename(/* turbopackIgnore: true */ temporary, target)
}

async function withFileState<T>(
  action: (state: AutomationFileState) => T | Promise<T>,
  persist = false,
): Promise<T> {
  const previous = storeGlobal.__geoPenetrationAutomationFileQueue || Promise.resolve()
  const operation = previous.catch(() => undefined).then(async () => {
    const state = await loadFileState()
    const result = await action(state)
    if (persist) await saveFileState(state)
    return result
  })
  storeGlobal.__geoPenetrationAutomationFileQueue = operation.then(() => undefined, () => undefined)
  return operation
}

function executionId(scheduleId: string, dedupeKey: string): string {
  const digest = createHash("sha256")
    .update(`${scheduleId}\u0000${dedupeKey}`)
    .digest("hex")
    .slice(0, 32)
  return `paexec_${digest}`
}

function normalizedScheduleInput(input: UpsertPenetrationAutomationScheduleInput) {
  const intervalDays = normalizeAutomationIntervalDays(input.intervalDays)
  const timeLocal = normalizeAutomationTimeLocal(input.timeLocal)
  const startDate = normalizeAutomationDate(input.startDate)
  return {
    ...input,
    clientName: String(input.clientName || "").trim().slice(0, 180),
    teamId: String(input.teamId || "").trim() || undefined,
    status: input.status === "paused" ? "paused" as const : "active" as const,
    intervalDays,
    timeLocal,
    startDate,
    relativeDropThresholdPct: normalizeAutomationThreshold(input.relativeDropThresholdPct),
    minimumAbsoluteDropPoints: normalizeMinimumAbsoluteDrop(input.minimumAbsoluteDropPoints),
    monthlyCreditLimit: normalizeMonthlyCreditLimit(input.monthlyCreditLimit),
  }
}

export async function getPenetrationAutomationScheduleByClient(
  ownerUserId: string,
  clientId: string,
): Promise<PenetrationAutomationSchedule | null> {
  if (backend() === "postgres") {
    await ensurePenetrationAutomationSchema()
    const result = await pool().query<ScheduleRow>(
      `SELECT * FROM geo_penetration_automation_schedules_v1
       WHERE owner_user_id = $1 AND client_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [ownerUserId, clientId],
    )
    return result.rows[0] ? scheduleFromRow(result.rows[0]) : null
  }
  return withFileState(state => {
    const found = Object.values(state.schedules).find(item => (
      item.ownerUserId === ownerUserId && item.clientId === clientId && !item.deletedAt
    ))
    if (!found) return null
    return stripStoredSchedule(found)
  })
}

export async function getPenetrationAutomationSchedule(
  ownerUserId: string,
  id: string,
): Promise<PenetrationAutomationSchedule | null> {
  if (backend() === "postgres") {
    await ensurePenetrationAutomationSchema()
    const result = await pool().query<ScheduleRow>(
      `SELECT * FROM geo_penetration_automation_schedules_v1
       WHERE owner_user_id = $1 AND id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [ownerUserId, id],
    )
    return result.rows[0] ? scheduleFromRow(result.rows[0]) : null
  }
  return withFileState(state => {
    const stored = state.schedules[scheduleKey(ownerUserId, id)]
    if (!stored || stored.deletedAt) return null
    return stripStoredSchedule(stored)
  })
}

export async function upsertPenetrationAutomationSchedule(
  rawInput: UpsertPenetrationAutomationScheduleInput,
): Promise<PenetrationAutomationSchedule> {
  const input = normalizedScheduleInput(rawInput)
  const current = await getPenetrationAutomationScheduleByClient(input.ownerUserId, input.clientId)
  const now = new Date().toISOString()
  const id = current?.id || `pauto_${randomUUID().replace(/-/g, "")}`
  const nextRunAt = input.status === "active"
    ? nextPenetrationAutomationRun({
        startDate: input.startDate,
        timeLocal: input.timeLocal,
        intervalDays: input.intervalDays,
        after: new Date(Date.now() - 1_000),
      })
    : undefined

  if (backend() === "postgres") {
    await ensurePenetrationAutomationSchema()
    const result = await pool().query<ScheduleRow>(
      `INSERT INTO geo_penetration_automation_schedules_v1 (
         owner_user_id, id, client_id, client_name, created_by_user_id,
         actor_user_id, billing_user_id, team_id, status, interval_days,
         time_local, timezone, start_date, relative_drop_threshold_pct,
         minimum_absolute_drop_points, in_app_enabled, email_enabled,
         monthly_credit_limit, next_run_at, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20
       )
       ON CONFLICT (owner_user_id, client_id) WHERE deleted_at IS NULL DO UPDATE SET
         client_name = EXCLUDED.client_name,
         actor_user_id = EXCLUDED.actor_user_id,
         billing_user_id = EXCLUDED.billing_user_id,
         team_id = EXCLUDED.team_id,
         status = EXCLUDED.status,
         interval_days = EXCLUDED.interval_days,
         time_local = EXCLUDED.time_local,
         timezone = EXCLUDED.timezone,
         start_date = EXCLUDED.start_date,
         relative_drop_threshold_pct = EXCLUDED.relative_drop_threshold_pct,
         minimum_absolute_drop_points = EXCLUDED.minimum_absolute_drop_points,
         in_app_enabled = EXCLUDED.in_app_enabled,
         email_enabled = EXCLUDED.email_enabled,
         monthly_credit_limit = EXCLUDED.monthly_credit_limit,
         next_run_at = EXCLUDED.next_run_at,
         last_error = NULL,
         consecutive_failures = CASE
           WHEN EXCLUDED.status = 'active' THEN 0
           ELSE geo_penetration_automation_schedules_v1.consecutive_failures
         END,
         updated_at = EXCLUDED.updated_at,
         deleted_at = NULL
       RETURNING *`,
      [
        input.ownerUserId,
        id,
        input.clientId,
        input.clientName,
        current?.createdByUserId || input.actorUserId,
        input.actorUserId,
        input.billingUserId,
        input.teamId || null,
        input.status,
        input.intervalDays,
        input.timeLocal,
        PENETRATION_AUTOMATION_TIMEZONE,
        input.startDate,
        input.relativeDropThresholdPct,
        input.minimumAbsoluteDropPoints,
        input.inAppEnabled,
        input.emailEnabled,
        input.monthlyCreditLimit ?? null,
        nextRunAt || null,
        now,
      ],
    )
    return scheduleFromRow(result.rows[0])
  }

  return withFileState(state => {
    const schedule: StoredFileSchedule = {
      ...(current || {
        id,
        ownerUserId: input.ownerUserId,
        clientId: input.clientId,
        createdByUserId: input.actorUserId,
        createdAt: now,
        consecutiveFailures: 0,
      }),
      clientName: input.clientName,
      actorUserId: input.actorUserId,
      billingUserId: input.billingUserId,
      teamId: input.teamId,
      status: input.status,
      intervalDays: input.intervalDays,
      timeLocal: input.timeLocal,
      timezone: PENETRATION_AUTOMATION_TIMEZONE,
      startDate: input.startDate,
      relativeDropThresholdPct: input.relativeDropThresholdPct,
      minimumAbsoluteDropPoints: input.minimumAbsoluteDropPoints,
      inAppEnabled: input.inAppEnabled,
      emailEnabled: input.emailEnabled,
      monthlyCreditLimit: input.monthlyCreditLimit,
      nextRunAt,
      consecutiveFailures: input.status === "active" ? 0 : current?.consecutiveFailures || 0,
      lastError: undefined,
      updatedAt: now,
      deletedAt: undefined,
    }
    state.schedules[scheduleKey(input.ownerUserId, id)] = schedule
    return stripStoredSchedule(schedule)
  }, true)
}

export async function setPenetrationAutomationScheduleStatus(input: {
  ownerUserId: string
  id: string
  status: PenetrationAutomationSchedule["status"]
}): Promise<PenetrationAutomationSchedule | null> {
  const current = await getPenetrationAutomationSchedule(input.ownerUserId, input.id)
  if (!current) return null
  return upsertPenetrationAutomationSchedule({
    ...current,
    status: input.status,
  })
}

export async function deletePenetrationAutomationSchedule(
  ownerUserId: string,
  id: string,
): Promise<boolean> {
  const now = new Date().toISOString()
  if (backend() === "postgres") {
    await ensurePenetrationAutomationSchema()
    const result = await pool().query(
      `UPDATE geo_penetration_automation_schedules_v1
       SET deleted_at = $3, status = 'paused', next_run_at = NULL, updated_at = $3
       WHERE owner_user_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [ownerUserId, id, now],
    )
    return (result.rowCount || 0) > 0
  }
  return withFileState(state => {
    const key = scheduleKey(ownerUserId, id)
    const current = state.schedules[key]
    if (!current || current.deletedAt) return false
    state.schedules[key] = {
      ...current,
      status: "paused",
      nextRunAt: undefined,
      deletedAt: now,
      updatedAt: now,
    }
    return true
  }, true)
}

function executionDedupeKey(
  scheduleId: string,
  trigger: PenetrationAutomationTrigger,
  scheduledFor: string,
): string {
  return `${scheduleId}:${trigger}:${scheduledFor}`
}

async function insertExecutionWithClient(
  client: PoolClient,
  schedule: PenetrationAutomationSchedule,
  trigger: PenetrationAutomationTrigger,
  scheduledFor: string,
): Promise<PenetrationAutomationExecution> {
  const dedupeKey = executionDedupeKey(schedule.id, trigger, scheduledFor)
  const id = executionId(schedule.id, dedupeKey)
  const now = new Date().toISOString()
  const result = await client.query<ExecutionRow>(
    `INSERT INTO geo_penetration_automation_executions_v1 (
       owner_user_id, id, schedule_id, client_id, client_name, actor_user_id,
       billing_user_id, team_id, trigger, scheduled_for, dedupe_key, status,
       attempt_count, estimated_credits, alert_triggered, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',0,0,FALSE,$12,$12)
     ON CONFLICT (owner_user_id, dedupe_key) DO UPDATE SET
       updated_at = geo_penetration_automation_executions_v1.updated_at
     RETURNING *`,
    [
      schedule.ownerUserId,
      id,
      schedule.id,
      schedule.clientId,
      schedule.clientName,
      schedule.actorUserId,
      schedule.billingUserId,
      schedule.teamId || null,
      trigger,
      scheduledFor,
      dedupeKey,
      now,
    ],
  )
  return executionFromRow(result.rows[0])
}

function insertFileExecution(
  state: AutomationFileState,
  schedule: PenetrationAutomationSchedule,
  trigger: PenetrationAutomationTrigger,
  scheduledFor: string,
): PenetrationAutomationExecution {
  const dedupeKey = executionDedupeKey(schedule.id, trigger, scheduledFor)
  const existing = Object.values(state.executions).find(item => (
    item.ownerUserId === schedule.ownerUserId && item.dedupeKey === dedupeKey
  ))
  if (existing) {
    return stripStoredExecution(existing)
  }
  const now = new Date().toISOString()
  const execution: StoredFileExecution = {
    id: executionId(schedule.id, dedupeKey),
    scheduleId: schedule.id,
    ownerUserId: schedule.ownerUserId,
    clientId: schedule.clientId,
    clientName: schedule.clientName,
    actorUserId: schedule.actorUserId,
    billingUserId: schedule.billingUserId,
    teamId: schedule.teamId,
    trigger,
    scheduledFor,
    dedupeKey,
    status: "pending",
    attemptCount: 0,
    estimatedCredits: 0,
    alertTriggered: false,
    createdAt: now,
    updatedAt: now,
  }
  state.executions[executionKey(schedule.ownerUserId, execution.id)] = execution
  return stripStoredExecution(execution)
}

export async function createPenetrationAutomationExecution(input: {
  schedule: PenetrationAutomationSchedule
  trigger: PenetrationAutomationTrigger
  scheduledFor?: string
}): Promise<PenetrationAutomationExecution> {
  const scheduledFor = iso(input.scheduledFor) || new Date().toISOString()
  if (backend() === "postgres") {
    await ensurePenetrationAutomationSchema()
    const client = await pool().connect()
    try {
      return await insertExecutionWithClient(client, input.schedule, input.trigger, scheduledFor)
    } finally {
      client.release()
    }
  }
  return withFileState(
    state => insertFileExecution(state, input.schedule, input.trigger, scheduledFor),
    true,
  )
}

export async function claimDuePenetrationAutomationExecutions(
  now = new Date(),
  limit = 50,
): Promise<PenetrationAutomationExecution[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)))
  if (backend() === "postgres") {
    await ensurePenetrationAutomationSchema()
    const client = await pool().connect()
    try {
      await client.query("BEGIN")
      const due = await client.query<ScheduleRow>(
        `SELECT s.*
         FROM geo_penetration_automation_schedules_v1 s
         WHERE s.deleted_at IS NULL
           AND s.status = 'active'
           AND s.next_run_at IS NOT NULL
           AND s.next_run_at <= $1
           AND NOT EXISTS (
             SELECT 1 FROM geo_penetration_automation_executions_v1 e
             WHERE e.owner_user_id = s.owner_user_id
               AND e.schedule_id = s.id
               AND e.status IN ('pending', 'submitted', 'running')
           )
         ORDER BY s.next_run_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [now.toISOString(), safeLimit],
      )
      const executions: PenetrationAutomationExecution[] = []
      for (const row of due.rows) {
        const schedule = scheduleFromRow(row)
        const scheduledFor = schedule.nextRunAt || now.toISOString()
        const execution = await insertExecutionWithClient(client, schedule, "scheduled", scheduledFor)
        executions.push(execution)
        const nextRunAt = nextPenetrationAutomationRun({
          startDate: schedule.startDate,
          timeLocal: schedule.timeLocal,
          intervalDays: schedule.intervalDays,
          after: now,
        })
        await client.query(
          `UPDATE geo_penetration_automation_schedules_v1
           SET next_run_at = $3, last_scheduled_for = $4,
               last_execution_id = $5, updated_at = $6
           WHERE owner_user_id = $1 AND id = $2`,
          [schedule.ownerUserId, schedule.id, nextRunAt, scheduledFor, execution.id, now.toISOString()],
        )
      }
      await client.query("COMMIT")
      return executions
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  return withFileState(state => {
    const activeScheduleIds = new Set(
      Object.values(state.executions)
        .filter(item => ["pending", "submitted", "running"].includes(item.status))
        .map(item => `${item.ownerUserId}\u0000${item.scheduleId}`),
    )
    const due = Object.values(state.schedules)
      .filter(item => !item.deletedAt && item.status === "active" && item.nextRunAt)
      .filter(item => Date.parse(item.nextRunAt!) <= now.getTime())
      .filter(item => !activeScheduleIds.has(`${item.ownerUserId}\u0000${item.id}`))
      .sort((left, right) => left.nextRunAt!.localeCompare(right.nextRunAt!))
      .slice(0, safeLimit)
    return due.map(schedule => {
      const scheduledFor = schedule.nextRunAt!
      const execution = insertFileExecution(state, schedule, "scheduled", scheduledFor)
      state.schedules[scheduleKey(schedule.ownerUserId, schedule.id)] = {
        ...schedule,
        nextRunAt: nextPenetrationAutomationRun({
          startDate: schedule.startDate,
          timeLocal: schedule.timeLocal,
          intervalDays: schedule.intervalDays,
          after: now,
        }),
        lastScheduledFor: scheduledFor,
        lastExecutionId: execution.id,
        updatedAt: now.toISOString(),
      }
      return execution
    })
  }, true)
}

export async function listActionablePenetrationAutomationExecutions(
  now = new Date(),
  limit = 100,
): Promise<PenetrationAutomationExecution[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)))
  if (backend() === "postgres") {
    await ensurePenetrationAutomationSchema()
    const result = await pool().query<ExecutionRow>(
      `SELECT * FROM geo_penetration_automation_executions_v1
       WHERE status IN ('pending', 'submitted', 'running')
         AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
       ORDER BY created_at ASC
       LIMIT $2`,
      [now.toISOString(), safeLimit],
    )
    return result.rows.map(executionFromRow)
  }
  return withFileState(state => Object.values(state.executions)
    .filter(item => ["pending", "submitted", "running"].includes(item.status))
    .filter(item => !item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= now.getTime())
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(0, safeLimit)
    .map(stripStoredExecution))
}

export async function getPenetrationAutomationExecution(
  ownerUserId: string,
  id: string,
): Promise<PenetrationAutomationExecution | null> {
  if (backend() === "postgres") {
    await ensurePenetrationAutomationSchema()
    const result = await pool().query<ExecutionRow>(
      `SELECT * FROM geo_penetration_automation_executions_v1
       WHERE owner_user_id = $1 AND id = $2 LIMIT 1`,
      [ownerUserId, id],
    )
    return result.rows[0] ? executionFromRow(result.rows[0]) : null
  }
  return withFileState(state => {
    const item = state.executions[executionKey(ownerUserId, id)]
    if (!item) return null
    return stripStoredExecution(item)
  })
}

const EXECUTION_PATCH_COLUMNS: Record<keyof PatchPenetrationAutomationExecution, string> = {
  status: "status",
  attemptCount: "attempt_count",
  nextAttemptAt: "next_attempt_at",
  jobId: "job_id",
  historyRecordId: "history_record_id",
  inputSnapshot: "input_snapshot",
  estimatedCredits: "estimated_credits",
  usedCredits: "used_credits",
  baselineHistoryRecordId: "baseline_history_record_id",
  baselineRate: "baseline_rate",
  currentRate: "current_rate",
  absoluteDropPoints: "absolute_drop_points",
  relativeDropPct: "relative_drop_pct",
  comparable: "comparable",
  comparisonReason: "comparison_reason",
  alertTriggered: "alert_triggered",
  alertSentAt: "alert_sent_at",
  error: "error",
  startedAt: "started_at",
  completedAt: "completed_at",
}

export async function patchPenetrationAutomationExecution(input: {
  ownerUserId: string
  id: string
  patch: PatchPenetrationAutomationExecution
}): Promise<PenetrationAutomationExecution | null> {
  const now = new Date().toISOString()
  if (backend() === "postgres") {
    await ensurePenetrationAutomationSchema()
    const entries = Object.entries(input.patch) as Array<[
      keyof PatchPenetrationAutomationExecution,
      PatchPenetrationAutomationExecution[keyof PatchPenetrationAutomationExecution],
    ]>
    if (entries.length === 0) return getPenetrationAutomationExecution(input.ownerUserId, input.id)
    const values: unknown[] = [input.ownerUserId, input.id]
    const assignments = entries.map(([key, value]) => {
      values.push(key === "inputSnapshot" && value ? JSON.stringify(value) : value ?? null)
      return `${EXECUTION_PATCH_COLUMNS[key]} = $${values.length}${key === "inputSnapshot" ? "::jsonb" : ""}`
    })
    values.push(now)
    const result = await pool().query<ExecutionRow>(
      `UPDATE geo_penetration_automation_executions_v1
       SET ${assignments.join(", ")}, updated_at = $${values.length}
       WHERE owner_user_id = $1 AND id = $2
       RETURNING *`,
      values,
    )
    return result.rows[0] ? executionFromRow(result.rows[0]) : null
  }
  return withFileState(state => {
    const key = executionKey(input.ownerUserId, input.id)
    const current = state.executions[key]
    if (!current) return null
    const next: StoredFileExecution = {
      ...current,
      ...input.patch,
      updatedAt: now,
    }
    state.executions[key] = next
    return stripStoredExecution(next)
  }, true)
}

export async function listPenetrationAutomationExecutions(input: {
  ownerUserId: string
  scheduleId: string
  limit?: number
}): Promise<PenetrationAutomationExecution[]> {
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit || 10)))
  if (backend() === "postgres") {
    await ensurePenetrationAutomationSchema()
    const result = await pool().query<ExecutionRow>(
      `SELECT * FROM geo_penetration_automation_executions_v1
       WHERE owner_user_id = $1 AND schedule_id = $2
       ORDER BY created_at DESC LIMIT $3`,
      [input.ownerUserId, input.scheduleId, limit],
    )
    return result.rows.map(executionFromRow)
  }
  return withFileState(state => Object.values(state.executions)
    .filter(item => item.ownerUserId === input.ownerUserId && item.scheduleId === input.scheduleId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit)
    .map(stripStoredExecution))
}

export async function sumPenetrationAutomationCredits(input: {
  ownerUserId: string
  scheduleId: string
  start: string
  end: string
}): Promise<number> {
  const countedStatuses: PenetrationAutomationExecutionStatus[] = [
    "submitted",
    "running",
    "succeeded",
    "partial",
    "failed",
    "cancelled",
  ]
  if (backend() === "postgres") {
    await ensurePenetrationAutomationSchema()
    const result = await pool().query<{ credits: string | number }>(
      `SELECT COALESCE(SUM(COALESCE(used_credits, estimated_credits)), 0) AS credits
       FROM geo_penetration_automation_executions_v1
       WHERE owner_user_id = $1 AND schedule_id = $2
         AND created_at >= $3 AND created_at < $4
         AND status = ANY($5::text[])`,
      [input.ownerUserId, input.scheduleId, input.start, input.end, countedStatuses],
    )
    return Number(result.rows[0]?.credits || 0)
  }
  return withFileState(state => Object.values(state.executions)
    .filter(item => item.ownerUserId === input.ownerUserId && item.scheduleId === input.scheduleId)
    .filter(item => item.createdAt >= input.start && item.createdAt < input.end)
    .filter(item => countedStatuses.includes(item.status))
    .reduce((sum, item) => sum + (item.usedCredits ?? item.estimatedCredits), 0))
}

export async function recordPenetrationAutomationScheduleProgress(input: {
  schedule: PenetrationAutomationSchedule
  execution: PenetrationAutomationExecution
  outcome: "started" | "succeeded" | "failed" | "skipped"
  error?: string
}): Promise<PenetrationAutomationSchedule | null> {
  const now = new Date().toISOString()
  if (backend() === "postgres") {
    await ensurePenetrationAutomationSchema()
    const result = await pool().query<ScheduleRow>(
      `UPDATE geo_penetration_automation_schedules_v1
       SET last_started_at = CASE WHEN $3 = 'started' THEN $4 ELSE last_started_at END,
           last_completed_at = CASE WHEN $3 = 'started' THEN last_completed_at ELSE $4 END,
           last_execution_id = $5,
           last_job_id = COALESCE($6, last_job_id),
           last_history_record_id = COALESCE($7, last_history_record_id),
           consecutive_failures = CASE
             WHEN $3 = 'failed' THEN consecutive_failures + 1
             WHEN $3 = 'started' THEN consecutive_failures
             ELSE 0
           END,
           last_error = $8,
           status = CASE
             WHEN $3 = 'failed' AND consecutive_failures + 1 >= 3 THEN 'paused'
             ELSE status
           END,
           next_run_at = CASE
             WHEN $3 = 'failed' AND consecutive_failures + 1 >= 3 THEN NULL
             ELSE next_run_at
           END,
           updated_at = $4
       WHERE owner_user_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [
        input.schedule.ownerUserId,
        input.schedule.id,
        input.outcome,
        now,
        input.execution.id,
        input.execution.jobId || null,
        input.execution.historyRecordId || null,
        input.error || null,
      ],
    )
    return result.rows[0] ? scheduleFromRow(result.rows[0]) : null
  }
  return withFileState(state => {
    const key = scheduleKey(input.schedule.ownerUserId, input.schedule.id)
    const current = state.schedules[key]
    if (!current || current.deletedAt) return null
    const consecutiveFailures = input.outcome === "failed"
      ? current.consecutiveFailures + 1
      : input.outcome === "started"
        ? current.consecutiveFailures
        : 0
    const autoPaused = consecutiveFailures >= 3
    const next: StoredFileSchedule = {
      ...current,
      lastStartedAt: input.outcome === "started" ? now : current.lastStartedAt,
      lastCompletedAt: input.outcome === "started" ? current.lastCompletedAt : now,
      lastExecutionId: input.execution.id,
      lastJobId: input.execution.jobId || current.lastJobId,
      lastHistoryRecordId: input.execution.historyRecordId || current.lastHistoryRecordId,
      consecutiveFailures,
      lastError: input.error,
      status: autoPaused ? "paused" : current.status,
      nextRunAt: autoPaused ? undefined : current.nextRunAt,
      updatedAt: now,
    }
    state.schedules[key] = next
    return stripStoredSchedule(next)
  }, true)
}
