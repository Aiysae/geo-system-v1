import "server-only"

import fs from "node:fs/promises"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { Pool, type PoolClient } from "pg"
import { CLIENT_FEEDBACK_AUTOMATION_SCHEMA_SQL } from "@/lib/client-feedback/automation-schema"
import {
  dueFeedbackAutomationPeriods,
  nextFeedbackAutomationRunAt,
  normalizeFeedbackAutomationDate,
  normalizeFeedbackAutomationTime,
} from "@/lib/client-feedback/automation-time"
import { decryptSensitiveData, encryptSensitiveData } from "@/lib/sensitive-data"
import type {
  ClientExecutionPeriodMode,
  ClientFeedbackAutomationDeliveryResult,
  ClientFeedbackAutomationExecution,
  ClientFeedbackAutomationSchedule,
  ClientFeedbackAutomationStatus,
} from "@/types/client-feedback"

type ScheduleRow = {
  owner_user_id: string
  id: string
  client_id: string
  client_name: string
  created_by_user_id: string
  actor_user_id: string
  team_id: string | null
  status: ClientFeedbackAutomationStatus
  weekly_enabled: boolean
  monthly_enabled: boolean
  time_local: string
  timezone: "Asia/Shanghai"
  start_date: string
  end_date: string
  period_mode: ClientExecutionPeriodMode
  recipient_emails_ciphertext: string
  send_empty_reports: boolean
  final_report_enabled: boolean
  next_run_at: string | Date | null
  last_weekly_period_end: string | null
  last_monthly_period_end: string | null
  last_started_at: string | Date | null
  last_completed_at: string | Date | null
  last_execution_id: string | null
  consecutive_failures: number
  last_error: string | null
  created_at: string | Date
  updated_at: string | Date
  deleted_at: string | Date | null
}

type ExecutionRow = {
  owner_user_id: string
  id: string
  schedule_id: string
  client_id: string
  client_name: string
  actor_user_id: string
  team_id: string | null
  trigger: ClientFeedbackAutomationExecution["trigger"]
  scheduled_for: string | Date
  dedupe_key: string
  periods: ClientFeedbackAutomationExecution["periods"]
  status: ClientFeedbackAutomationExecution["status"]
  attempt_count: number
  next_attempt_at: string | Date | null
  reports: ClientFeedbackAutomationExecution["reports"]
  deliveries: StoredDelivery[]
  error: string | null
  created_at: string | Date
  started_at: string | Date | null
  completed_at: string | Date | null
  updated_at: string | Date
}

type StoredSchedule = Omit<ClientFeedbackAutomationSchedule, "recipientEmails"> & {
  recipientEmailsCiphertext: string
  deletedAt?: string
}
type StoredDelivery = Omit<ClientFeedbackAutomationDeliveryResult, "email"> & {
  email?: string
  emailCiphertext?: string
}
type StoredExecution = Omit<ClientFeedbackAutomationExecution, "deliveries"> & {
  deliveries: StoredDelivery[]
  dedupeKey: string
}
type FileState = {
  schedules: Record<string, StoredSchedule>
  executions: Record<string, StoredExecution>
}

export type UpsertClientFeedbackAutomationScheduleInput = {
  ownerUserId: string
  clientId: string
  clientName: string
  actorUserId: string
  teamId?: string
  status?: ClientFeedbackAutomationStatus
  weeklyEnabled: boolean
  monthlyEnabled: boolean
  timeLocal: string
  startDate: string
  endDate: string
  periodMode: ClientExecutionPeriodMode
  recipientEmails: string[]
  sendEmptyReports: boolean
  finalReportEnabled: boolean
}

export type PatchClientFeedbackAutomationExecution = Partial<Pick<
  ClientFeedbackAutomationExecution,
  | "status"
  | "attemptCount"
  | "nextAttemptAt"
  | "reports"
  | "deliveries"
  | "error"
  | "startedAt"
  | "completedAt"
>>

export function clientFeedbackAutomationRetryPatch(
  execution: ClientFeedbackAutomationExecution,
): PatchClientFeedbackAutomationExecution {
  return {
    status: execution.reports.length ? "generated" : "pending",
    nextAttemptAt: new Date().toISOString(),
    completedAt: undefined,
    error: undefined,
    deliveries: execution.deliveries.map(delivery => delivery.status === "sent"
      ? delivery
      : { email: delivery.email, status: "pending" as const }),
  }
}

const DEFAULT_FILE_PATH = process.env.NODE_ENV === "production"
  ? "/var/lib/geo-system/client-feedback-automations.json"
  : path.join(process.cwd(), ".data", "client-feedback-automations.json")

const stateGlobal = globalThis as typeof globalThis & {
  __geoClientFeedbackAutomationPool?: Pool
  __geoClientFeedbackAutomationSchema?: Promise<void>
  __geoClientFeedbackAutomationFileQueue?: Promise<unknown>
}

function backend(): "postgres" | "file" {
  const configured = String(process.env.CLIENT_FEEDBACK_AUTOMATION_STORE || "").trim().toLowerCase()
  if (configured === "postgres" || configured === "file") return configured
  if (configured) throw new Error(`Unsupported CLIENT_FEEDBACK_AUTOMATION_STORE: ${configured}`)
  return process.env.DATABASE_URL ? "postgres" : "file"
}

function pool(): Pool {
  if (stateGlobal.__geoClientFeedbackAutomationPool) return stateGlobal.__geoClientFeedbackAutomationPool
  const connectionString = String(process.env.DATABASE_URL || "").trim()
  if (!connectionString) throw new Error("DATABASE_URL is required for feedback automation")
  stateGlobal.__geoClientFeedbackAutomationPool = new Pool({
    connectionString,
    max: Math.max(1, Math.min(4, Number(process.env.FEEDBACK_AUTOMATION_DB_POOL_MAX) || 2)),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  })
  stateGlobal.__geoClientFeedbackAutomationPool.on("error", error => {
    console.error("[feedback-automation-db]", error.message)
  })
  return stateGlobal.__geoClientFeedbackAutomationPool
}

export async function ensureClientFeedbackAutomationSchema(): Promise<void> {
  if (backend() !== "postgres") return
  if (!stateGlobal.__geoClientFeedbackAutomationSchema) {
    stateGlobal.__geoClientFeedbackAutomationSchema = pool()
      .query(CLIENT_FEEDBACK_AUTOMATION_SCHEMA_SQL)
      .then(() => undefined)
      .catch(error => {
        stateGlobal.__geoClientFeedbackAutomationSchema = undefined
        throw error
      })
  }
  await stateGlobal.__geoClientFeedbackAutomationSchema
}

function iso(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

function recipientEmails(ciphertext: string): string[] {
  const parsed = JSON.parse(decryptSensitiveData(ciphertext))
  return Array.isArray(parsed) ? parsed.map(String) : []
}

function encodeDeliveries(
  deliveries: ClientFeedbackAutomationDeliveryResult[],
): StoredDelivery[] {
  return deliveries.map(({ email, ...delivery }) => ({
    ...delivery,
    emailCiphertext: encryptSensitiveData(email),
  }))
}

function decodeDeliveries(value: unknown): ClientFeedbackAutomationDeliveryResult[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== "object") return []
    const stored = item as StoredDelivery
    const email = stored.emailCiphertext
      ? decryptSensitiveData(stored.emailCiphertext)
      : String(stored.email || "").trim()
    if (!email) return []
    return [{
      email,
      status: stored.status === "sent" || stored.status === "failed" ? stored.status : "pending",
      sentAt: iso(stored.sentAt),
      error: stored.error ? String(stored.error) : undefined,
    }]
  })
}

function scheduleFromRow(row: ScheduleRow): ClientFeedbackAutomationSchedule {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    clientId: row.client_id,
    clientName: row.client_name,
    createdByUserId: row.created_by_user_id,
    actorUserId: row.actor_user_id,
    teamId: row.team_id || undefined,
    status: row.status,
    weeklyEnabled: row.weekly_enabled,
    monthlyEnabled: row.monthly_enabled,
    timeLocal: row.time_local,
    timezone: "Asia/Shanghai",
    startDate: row.start_date,
    endDate: row.end_date,
    periodMode: row.period_mode === "calendar" ? "calendar" : "service",
    recipientEmails: recipientEmails(row.recipient_emails_ciphertext),
    sendEmptyReports: row.send_empty_reports,
    finalReportEnabled: row.final_report_enabled,
    nextRunAt: iso(row.next_run_at),
    lastWeeklyPeriodEnd: row.last_weekly_period_end || undefined,
    lastMonthlyPeriodEnd: row.last_monthly_period_end || undefined,
    lastStartedAt: iso(row.last_started_at),
    lastCompletedAt: iso(row.last_completed_at),
    lastExecutionId: row.last_execution_id || undefined,
    consecutiveFailures: Number(row.consecutive_failures || 0),
    lastError: row.last_error || undefined,
    createdAt: iso(row.created_at) || new Date().toISOString(),
    updatedAt: iso(row.updated_at) || new Date().toISOString(),
  }
}

function executionFromRow(row: ExecutionRow): ClientFeedbackAutomationExecution {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    ownerUserId: row.owner_user_id,
    clientId: row.client_id,
    clientName: row.client_name,
    actorUserId: row.actor_user_id,
    teamId: row.team_id || undefined,
    trigger: row.trigger,
    scheduledFor: iso(row.scheduled_for) || new Date().toISOString(),
    periods: Array.isArray(row.periods) ? row.periods : [],
    status: row.status,
    attemptCount: Number(row.attempt_count || 0),
    nextAttemptAt: iso(row.next_attempt_at),
    reports: Array.isArray(row.reports) ? row.reports : [],
    deliveries: decodeDeliveries(row.deliveries),
    error: row.error || undefined,
    createdAt: iso(row.created_at) || new Date().toISOString(),
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    updatedAt: iso(row.updated_at) || new Date().toISOString(),
  }
}

function scheduleKey(ownerUserId: string, id: string): string {
  return `${ownerUserId}\u0000${id}`
}

function executionKey(ownerUserId: string, id: string): string {
  return `${ownerUserId}\u0000${id}`
}

function filePath(): string {
  return String(process.env.CLIENT_FEEDBACK_AUTOMATION_FILE || DEFAULT_FILE_PATH)
}

async function loadFileState(): Promise<FileState> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath(), "utf8")) as Partial<FileState>
    return { schedules: parsed.schedules || {}, executions: parsed.executions || {} }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT") {
      console.warn("[feedback-automation-file] load failed", error)
    }
    return { schedules: {}, executions: {} }
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
  const previous = stateGlobal.__geoClientFeedbackAutomationFileQueue || Promise.resolve()
  const operation = previous.catch(() => undefined).then(async () => {
    const state = await loadFileState()
    const result = await action(state)
    if (persist) await saveFileState(state)
    return result
  })
  stateGlobal.__geoClientFeedbackAutomationFileQueue = operation.then(() => undefined, () => undefined)
  return operation
}

function stripSchedule(stored: StoredSchedule): ClientFeedbackAutomationSchedule {
  const schedule = { ...stored } as Partial<StoredSchedule>
  delete schedule.recipientEmailsCiphertext
  delete schedule.deletedAt
  return {
    ...schedule as Omit<ClientFeedbackAutomationSchedule, "recipientEmails">,
    recipientEmails: recipientEmails(stored.recipientEmailsCiphertext),
  }
}

function stripExecution(stored: StoredExecution): ClientFeedbackAutomationExecution {
  const execution = { ...stored } as Partial<StoredExecution>
  delete execution.dedupeKey
  return {
    ...execution as Omit<ClientFeedbackAutomationExecution, "deliveries">,
    deliveries: decodeDeliveries(stored.deliveries),
  }
}

function normalizeEmails(value: unknown): string[] {
  const input = Array.isArray(value) ? value : []
  const emails = [...new Set(input.map(item => String(item || "").trim().toLowerCase()).filter(Boolean))]
  if (emails.length < 1 || emails.length > 10) throw new Error("自动报送邮箱数量必须在 1–10 个之间")
  for (const email of emails) {
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`邮箱格式无效：${email}`)
    }
  }
  return emails
}

function normalizedInput(input: UpsertClientFeedbackAutomationScheduleInput) {
  const startDate = normalizeFeedbackAutomationDate(input.startDate, "正式开始日期")
  const endDate = normalizeFeedbackAutomationDate(input.endDate, "正式结束日期")
  if (endDate < startDate) throw new Error("正式结束日期不能早于开始日期")
  const spanDays = Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000)
  if (spanDays > 3_650) throw new Error("单个自动报送计划最长支持 10 年")
  if (!input.weeklyEnabled && !input.monthlyEnabled) throw new Error("请至少启用周报或月报中的一项")
  return {
    ...input,
    clientName: String(input.clientName || "").trim().slice(0, 180),
    teamId: String(input.teamId || "").trim() || undefined,
    status: input.status === "paused" ? "paused" as const : "active" as const,
    startDate,
    endDate,
    timeLocal: normalizeFeedbackAutomationTime(input.timeLocal),
    periodMode: input.periodMode === "calendar" ? "calendar" as const : "service" as const,
    recipientEmails: normalizeEmails(input.recipientEmails),
  }
}

export async function getClientFeedbackAutomationScheduleByClient(
  ownerUserId: string,
  clientId: string,
): Promise<ClientFeedbackAutomationSchedule | null> {
  if (backend() === "postgres") {
    await ensureClientFeedbackAutomationSchema()
    const result = await pool().query<ScheduleRow>(
      `SELECT * FROM geo_client_feedback_automation_schedules_v1
       WHERE owner_user_id = $1 AND client_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [ownerUserId, clientId],
    )
    return result.rows[0] ? scheduleFromRow(result.rows[0]) : null
  }
  return withFileState(state => {
    const found = Object.values(state.schedules).find(item => (
      item.ownerUserId === ownerUserId && item.clientId === clientId && !item.deletedAt
    ))
    return found ? stripSchedule(found) : null
  })
}

export async function getClientFeedbackAutomationSchedule(
  ownerUserId: string,
  id: string,
): Promise<ClientFeedbackAutomationSchedule | null> {
  if (backend() === "postgres") {
    await ensureClientFeedbackAutomationSchema()
    const result = await pool().query<ScheduleRow>(
      `SELECT * FROM geo_client_feedback_automation_schedules_v1
       WHERE owner_user_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
      [ownerUserId, id],
    )
    return result.rows[0] ? scheduleFromRow(result.rows[0]) : null
  }
  return withFileState(state => {
    const found = state.schedules[scheduleKey(ownerUserId, id)]
    return found && !found.deletedAt ? stripSchedule(found) : null
  })
}

export async function upsertClientFeedbackAutomationSchedule(
  rawInput: UpsertClientFeedbackAutomationScheduleInput,
): Promise<ClientFeedbackAutomationSchedule> {
  const input = normalizedInput(rawInput)
  const current = await getClientFeedbackAutomationScheduleByClient(input.ownerUserId, input.clientId)
  const now = new Date().toISOString()
  const id = current?.id || `cfauto_${randomUUID().replace(/-/g, "")}`
  const nextRunAt = input.status === "active"
    ? nextFeedbackAutomationRunAt({
        ...input,
        lastWeeklyPeriodEnd: current?.lastWeeklyPeriodEnd,
        lastMonthlyPeriodEnd: current?.lastMonthlyPeriodEnd,
      })
    : undefined
  const status: ClientFeedbackAutomationStatus = input.status === "paused"
    ? "paused"
    : nextRunAt
      ? "active"
      : "completed"
  const ciphertext = encryptSensitiveData(JSON.stringify(input.recipientEmails))

  if (backend() === "postgres") {
    await ensureClientFeedbackAutomationSchema()
    const result = await pool().query<ScheduleRow>(
      `INSERT INTO geo_client_feedback_automation_schedules_v1 (
         owner_user_id,id,client_id,client_name,created_by_user_id,actor_user_id,
         team_id,status,weekly_enabled,monthly_enabled,time_local,timezone,start_date,
         end_date,period_mode,recipient_emails_ciphertext,send_empty_reports,
         final_report_enabled,next_run_at,last_weekly_period_end,last_monthly_period_end,
         created_at,updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Asia/Shanghai',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21)
       ON CONFLICT (owner_user_id, client_id) WHERE deleted_at IS NULL DO UPDATE SET
         client_name=EXCLUDED.client_name,actor_user_id=EXCLUDED.actor_user_id,
         team_id=EXCLUDED.team_id,status=EXCLUDED.status,weekly_enabled=EXCLUDED.weekly_enabled,
         monthly_enabled=EXCLUDED.monthly_enabled,time_local=EXCLUDED.time_local,
         start_date=EXCLUDED.start_date,end_date=EXCLUDED.end_date,period_mode=EXCLUDED.period_mode,
         recipient_emails_ciphertext=EXCLUDED.recipient_emails_ciphertext,
         send_empty_reports=EXCLUDED.send_empty_reports,final_report_enabled=EXCLUDED.final_report_enabled,
         next_run_at=EXCLUDED.next_run_at,last_error=NULL,updated_at=EXCLUDED.updated_at,deleted_at=NULL
       RETURNING *`,
      [
        input.ownerUserId, id, input.clientId, input.clientName,
        current?.createdByUserId || input.actorUserId, input.actorUserId,
        input.teamId || null, status, input.weeklyEnabled, input.monthlyEnabled,
        input.timeLocal, input.startDate, input.endDate, input.periodMode, ciphertext,
        input.sendEmptyReports, input.finalReportEnabled, nextRunAt || null,
        current?.lastWeeklyPeriodEnd || null, current?.lastMonthlyPeriodEnd || null, now,
      ],
    )
    return scheduleFromRow(result.rows[0])
  }

  return withFileState(state => {
    const schedule: StoredSchedule = {
      id,
      ownerUserId: input.ownerUserId,
      clientId: input.clientId,
      createdByUserId: current?.createdByUserId || input.actorUserId,
      createdAt: current?.createdAt || now,
      consecutiveFailures: current?.consecutiveFailures || 0,
      clientName: input.clientName,
      actorUserId: input.actorUserId,
      teamId: input.teamId,
      status,
      weeklyEnabled: input.weeklyEnabled,
      monthlyEnabled: input.monthlyEnabled,
      timeLocal: input.timeLocal,
      timezone: "Asia/Shanghai",
      startDate: input.startDate,
      endDate: input.endDate,
      periodMode: input.periodMode,
      recipientEmailsCiphertext: ciphertext,
      sendEmptyReports: input.sendEmptyReports,
      finalReportEnabled: input.finalReportEnabled,
      nextRunAt,
      lastWeeklyPeriodEnd: current?.lastWeeklyPeriodEnd,
      lastMonthlyPeriodEnd: current?.lastMonthlyPeriodEnd,
      lastStartedAt: current?.lastStartedAt,
      lastCompletedAt: current?.lastCompletedAt,
      lastExecutionId: current?.lastExecutionId,
      lastError: undefined,
      updatedAt: now,
    }
    state.schedules[scheduleKey(input.ownerUserId, id)] = schedule
    return stripSchedule(schedule)
  }, true)
}

export async function setClientFeedbackAutomationScheduleStatus(input: {
  ownerUserId: string
  id: string
  status: "active" | "paused"
}): Promise<ClientFeedbackAutomationSchedule | null> {
  const current = await getClientFeedbackAutomationSchedule(input.ownerUserId, input.id)
  if (!current) return null
  return upsertClientFeedbackAutomationSchedule({ ...current, status: input.status })
}

export async function deleteClientFeedbackAutomationSchedule(ownerUserId: string, id: string): Promise<boolean> {
  const now = new Date().toISOString()
  if (backend() === "postgres") {
    await ensureClientFeedbackAutomationSchema()
    const result = await pool().query(
      `UPDATE geo_client_feedback_automation_schedules_v1
       SET deleted_at=$3,status='paused',next_run_at=NULL,updated_at=$3
       WHERE owner_user_id=$1 AND id=$2 AND deleted_at IS NULL`,
      [ownerUserId, id, now],
    )
    return (result.rowCount || 0) > 0
  }
  return withFileState(state => {
    const key = scheduleKey(ownerUserId, id)
    const current = state.schedules[key]
    if (!current || current.deletedAt) return false
    state.schedules[key] = { ...current, status: "paused", nextRunAt: undefined, deletedAt: now, updatedAt: now }
    return true
  }, true)
}

function executionDedupeKey(
  scheduleId: string,
  periods: ClientFeedbackAutomationExecution["periods"],
  trigger: string,
  idempotencyKey?: string,
): string {
  if (trigger === "manual" && idempotencyKey) return `${scheduleId}:manual:${idempotencyKey}`
  const keys = periods.map(period => `${period.type}:${period.start}:${period.end}`).sort().join("|")
  return `${scheduleId}:${trigger}:${keys}`
}

function executionId(scheduleId: string, dedupeKey: string): string {
  return `cfexec_${createHash("sha256").update(`${scheduleId}\u0000${dedupeKey}`).digest("hex").slice(0, 32)}`
}

async function insertExecutionWithClient(input: {
  client: PoolClient
  schedule: ClientFeedbackAutomationSchedule
  periods: ClientFeedbackAutomationExecution["periods"]
  trigger: ClientFeedbackAutomationExecution["trigger"]
  scheduledFor: string
  idempotencyKey?: string
}): Promise<ClientFeedbackAutomationExecution> {
  const dedupeKey = executionDedupeKey(input.schedule.id, input.periods, input.trigger, input.idempotencyKey)
  const id = executionId(input.schedule.id, dedupeKey)
  const now = new Date().toISOString()
  const deliveries = input.schedule.recipientEmails.map(email => ({ email, status: "pending" as const }))
  const result = await input.client.query<ExecutionRow>(
    `INSERT INTO geo_client_feedback_automation_executions_v1 (
       owner_user_id,id,schedule_id,client_id,client_name,actor_user_id,team_id,
       trigger,scheduled_for,dedupe_key,periods,status,attempt_count,reports,deliveries,created_at,updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'pending',0,'[]'::jsonb,$12::jsonb,$13,$13)
     ON CONFLICT (owner_user_id,dedupe_key) DO UPDATE SET updated_at=geo_client_feedback_automation_executions_v1.updated_at
     RETURNING *`,
    [
      input.schedule.ownerUserId, id, input.schedule.id, input.schedule.clientId,
      input.schedule.clientName, input.schedule.actorUserId, input.schedule.teamId || null,
      input.trigger, input.scheduledFor, dedupeKey, JSON.stringify(input.periods),
      JSON.stringify(encodeDeliveries(deliveries)), now,
    ],
  )
  return executionFromRow(result.rows[0])
}

function insertFileExecution(input: {
  state: FileState
  schedule: ClientFeedbackAutomationSchedule
  periods: ClientFeedbackAutomationExecution["periods"]
  trigger: ClientFeedbackAutomationExecution["trigger"]
  scheduledFor: string
  idempotencyKey?: string
}): ClientFeedbackAutomationExecution {
  const dedupeKey = executionDedupeKey(input.schedule.id, input.periods, input.trigger, input.idempotencyKey)
  const existing = Object.values(input.state.executions).find(item => (
    item.ownerUserId === input.schedule.ownerUserId && item.dedupeKey === dedupeKey
  ))
  if (existing) return stripExecution(existing)
  const now = new Date().toISOString()
  const execution: StoredExecution = {
    id: executionId(input.schedule.id, dedupeKey),
    scheduleId: input.schedule.id,
    ownerUserId: input.schedule.ownerUserId,
    clientId: input.schedule.clientId,
    clientName: input.schedule.clientName,
    actorUserId: input.schedule.actorUserId,
    teamId: input.schedule.teamId,
    trigger: input.trigger,
    scheduledFor: input.scheduledFor,
    dedupeKey,
    periods: input.periods,
    status: "pending",
    attemptCount: 0,
    reports: [],
    deliveries: encodeDeliveries(input.schedule.recipientEmails.map(email => ({
      email,
      status: "pending",
    }))),
    createdAt: now,
    updatedAt: now,
  }
  input.state.executions[executionKey(input.schedule.ownerUserId, execution.id)] = execution
  return stripExecution(execution)
}

export async function createClientFeedbackAutomationExecution(input: {
  schedule: ClientFeedbackAutomationSchedule
  periods: ClientFeedbackAutomationExecution["periods"]
  trigger: ClientFeedbackAutomationExecution["trigger"]
  scheduledFor?: string
  idempotencyKey?: string
}): Promise<ClientFeedbackAutomationExecution> {
  if (!input.periods.length) throw new Error("没有可生成的反馈报告周期")
  const scheduledFor = iso(input.scheduledFor) || new Date().toISOString()
  if (backend() === "postgres") {
    await ensureClientFeedbackAutomationSchema()
    const client = await pool().connect()
    try {
      return await insertExecutionWithClient({ ...input, client, scheduledFor })
    } finally {
      client.release()
    }
  }
  return withFileState(state => insertFileExecution({ ...input, state, scheduledFor }), true)
}

function nextState(schedule: ClientFeedbackAutomationSchedule, periods: ClientFeedbackAutomationExecution["periods"]) {
  const weeklyEnds = periods.filter(item => item.type === "weekly").map(item => item.end)
  const monthlyEnds = periods.filter(item => item.type === "monthly").map(item => item.end)
  const lastWeeklyPeriodEnd = weeklyEnds.sort().at(-1) || schedule.lastWeeklyPeriodEnd
  const lastMonthlyPeriodEnd = monthlyEnds.sort().at(-1) || schedule.lastMonthlyPeriodEnd
  const nextRunAt = nextFeedbackAutomationRunAt({
    ...schedule,
    lastWeeklyPeriodEnd,
    lastMonthlyPeriodEnd,
  })
  return { lastWeeklyPeriodEnd, lastMonthlyPeriodEnd, nextRunAt }
}

export async function claimDueClientFeedbackAutomationExecutions(now = new Date(), limit = 50): Promise<ClientFeedbackAutomationExecution[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)))
  if (backend() === "postgres") {
    await ensureClientFeedbackAutomationSchema()
    const client = await pool().connect()
    try {
      await client.query("BEGIN")
      const result = await client.query<ScheduleRow>(
        `SELECT * FROM geo_client_feedback_automation_schedules_v1
         WHERE deleted_at IS NULL AND status='active' AND next_run_at IS NOT NULL AND next_run_at <= $1
         ORDER BY next_run_at ASC LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [now.toISOString(), safeLimit],
      )
      const executions: ClientFeedbackAutomationExecution[] = []
      for (const row of result.rows) {
        const schedule = scheduleFromRow(row)
        const periods = dueFeedbackAutomationPeriods({ ...schedule, now })
        if (!periods.length) continue
        const execution = await insertExecutionWithClient({
          client,
          schedule,
          periods,
          trigger: "scheduled",
          scheduledFor: schedule.nextRunAt || now.toISOString(),
        })
        const next = nextState(schedule, periods)
        await client.query(
          `UPDATE geo_client_feedback_automation_schedules_v1 SET
             status=$3,next_run_at=$4,last_weekly_period_end=$5,last_monthly_period_end=$6,
             last_execution_id=$7,updated_at=$8
           WHERE owner_user_id=$1 AND id=$2`,
          [schedule.ownerUserId, schedule.id, next.nextRunAt ? "active" : "completed", next.nextRunAt || null,
            next.lastWeeklyPeriodEnd || null, next.lastMonthlyPeriodEnd || null, execution.id, now.toISOString()],
        )
        executions.push(execution)
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
    const due = Object.values(state.schedules)
      .filter(item => !item.deletedAt && item.status === "active" && item.nextRunAt && item.nextRunAt <= now.toISOString())
      .sort((left, right) => left.nextRunAt!.localeCompare(right.nextRunAt!))
      .slice(0, safeLimit)
    return due.flatMap(stored => {
      const schedule = stripSchedule(stored)
      const periods = dueFeedbackAutomationPeriods({ ...schedule, now })
      if (!periods.length) return []
      const execution = insertFileExecution({
        state,
        schedule,
        periods,
        trigger: "scheduled",
        scheduledFor: schedule.nextRunAt || now.toISOString(),
      })
      const next = nextState(schedule, periods)
      state.schedules[scheduleKey(schedule.ownerUserId, schedule.id)] = {
        ...stored,
        ...next,
        status: next.nextRunAt ? "active" : "completed",
        lastExecutionId: execution.id,
        updatedAt: now.toISOString(),
      }
      return [execution]
    })
  }, true)
}

export async function getClientFeedbackAutomationExecution(ownerUserId: string, id: string): Promise<ClientFeedbackAutomationExecution | null> {
  if (backend() === "postgres") {
    await ensureClientFeedbackAutomationSchema()
    const result = await pool().query<ExecutionRow>(
      `SELECT * FROM geo_client_feedback_automation_executions_v1 WHERE owner_user_id=$1 AND id=$2 LIMIT 1`,
      [ownerUserId, id],
    )
    return result.rows[0] ? executionFromRow(result.rows[0]) : null
  }
  return withFileState(state => {
    const found = state.executions[executionKey(ownerUserId, id)]
    return found ? stripExecution(found) : null
  })
}

export async function listClientFeedbackAutomationExecutions(input: {
  ownerUserId: string
  scheduleId: string
  limit?: number
}): Promise<ClientFeedbackAutomationExecution[]> {
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit || 12)))
  if (backend() === "postgres") {
    await ensureClientFeedbackAutomationSchema()
    const result = await pool().query<ExecutionRow>(
      `SELECT * FROM geo_client_feedback_automation_executions_v1
       WHERE owner_user_id=$1 AND schedule_id=$2 ORDER BY created_at DESC LIMIT $3`,
      [input.ownerUserId, input.scheduleId, limit],
    )
    return result.rows.map(executionFromRow)
  }
  return withFileState(state => Object.values(state.executions)
    .filter(item => item.ownerUserId === input.ownerUserId && item.scheduleId === input.scheduleId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit)
    .map(stripExecution))
}

export async function listActionableClientFeedbackAutomationExecutions(now = new Date(), limit = 100): Promise<ClientFeedbackAutomationExecution[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)))
  if (backend() === "postgres") {
    await ensureClientFeedbackAutomationSchema()
    const result = await pool().query<ExecutionRow>(
      `SELECT * FROM geo_client_feedback_automation_executions_v1
       WHERE status IN ('pending','running','generated')
         AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
       ORDER BY created_at ASC LIMIT $2`,
      [now.toISOString(), safeLimit],
    )
    return result.rows.map(executionFromRow)
  }
  return withFileState(state => Object.values(state.executions)
    .filter(item => ["pending", "running", "generated"].includes(item.status))
    .filter(item => !item.nextAttemptAt || item.nextAttemptAt <= now.toISOString())
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(0, safeLimit)
    .map(stripExecution))
}

const PATCH_COLUMNS: Record<keyof PatchClientFeedbackAutomationExecution, string> = {
  status: "status",
  attemptCount: "attempt_count",
  nextAttemptAt: "next_attempt_at",
  reports: "reports",
  deliveries: "deliveries",
  error: "error",
  startedAt: "started_at",
  completedAt: "completed_at",
}

export async function patchClientFeedbackAutomationExecution(input: {
  ownerUserId: string
  id: string
  patch: PatchClientFeedbackAutomationExecution
}): Promise<ClientFeedbackAutomationExecution | null> {
  const now = new Date().toISOString()
  if (backend() === "postgres") {
    await ensureClientFeedbackAutomationSchema()
    const entries = Object.entries(input.patch) as Array<[keyof PatchClientFeedbackAutomationExecution, unknown]>
    if (!entries.length) return getClientFeedbackAutomationExecution(input.ownerUserId, input.id)
    const values: unknown[] = [input.ownerUserId, input.id]
    const assignments = entries.map(([key, value]) => {
      const json = key === "reports" || key === "deliveries"
      const persisted = key === "deliveries"
        ? encodeDeliveries(Array.isArray(value) ? value as ClientFeedbackAutomationDeliveryResult[] : [])
        : value || []
      values.push(json ? JSON.stringify(persisted) : value ?? null)
      return `${PATCH_COLUMNS[key]}=$${values.length}${json ? "::jsonb" : ""}`
    })
    values.push(now)
    const result = await pool().query<ExecutionRow>(
      `UPDATE geo_client_feedback_automation_executions_v1
       SET ${assignments.join(",")},updated_at=$${values.length}
       WHERE owner_user_id=$1 AND id=$2 RETURNING *`,
      values,
    )
    return result.rows[0] ? executionFromRow(result.rows[0]) : null
  }
  return withFileState(state => {
    const key = executionKey(input.ownerUserId, input.id)
    const current = state.executions[key]
    if (!current) return null
    const { deliveries, ...patch } = input.patch
    const next: StoredExecution = {
      ...current,
      ...patch,
      ...(deliveries ? { deliveries: encodeDeliveries(deliveries) } : {}),
      updatedAt: now,
    }
    state.executions[key] = next
    return stripExecution(next)
  }, true)
}

export async function recordClientFeedbackAutomationScheduleProgress(input: {
  schedule: ClientFeedbackAutomationSchedule
  execution: ClientFeedbackAutomationExecution
  outcome: "started" | "succeeded" | "failed"
  error?: string
}): Promise<void> {
  const now = new Date().toISOString()
  const patch = {
    lastStartedAt: input.outcome === "started" ? now : input.schedule.lastStartedAt,
    lastCompletedAt: input.outcome !== "started" ? now : input.schedule.lastCompletedAt,
    consecutiveFailures: input.outcome === "failed" ? input.schedule.consecutiveFailures + 1 : input.outcome === "succeeded" ? 0 : input.schedule.consecutiveFailures,
    lastError: input.outcome === "failed" ? String(input.error || "自动报送失败").slice(0, 500) : input.outcome === "succeeded" ? undefined : input.schedule.lastError,
  }
  if (backend() === "postgres") {
    await ensureClientFeedbackAutomationSchema()
    await pool().query(
      `UPDATE geo_client_feedback_automation_schedules_v1 SET
         last_started_at=$3,last_completed_at=$4,consecutive_failures=$5,last_error=$6,
         last_execution_id=$7,updated_at=$8 WHERE owner_user_id=$1 AND id=$2`,
      [input.schedule.ownerUserId, input.schedule.id, patch.lastStartedAt || null,
        patch.lastCompletedAt || null, patch.consecutiveFailures, patch.lastError || null,
        input.execution.id, now],
    )
    return
  }
  await withFileState(state => {
    const key = scheduleKey(input.schedule.ownerUserId, input.schedule.id)
    const current = state.schedules[key]
    if (!current) return
    state.schedules[key] = { ...current, ...patch, lastExecutionId: input.execution.id, updatedAt: now }
  }, true)
}
