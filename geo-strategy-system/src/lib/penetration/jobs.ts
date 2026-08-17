import "server-only"

import { randomUUID } from "crypto"
import { kv } from "@/lib/kv"
import { syncPenetrationJobTask } from "@/lib/task-center/adapters"
import {
  clearTaskCancellation,
  registerTaskAbortController,
  signalTaskCancellation,
} from "@/lib/task-cancellation"
import {
  dispatchDurableTaskOrFallback,
  durableTaskQueueEnabled,
  getDurableTaskQueueSnapshot,
  inspectDurableTaskDispatch,
  type TaskWorkerOutcome,
} from "@/lib/task-queue"
import { createInternalApiHeaders } from "@/lib/internal-api"
import { sanitizeAiUpstreamMessage } from "@/lib/ai-secrets"
import { buildPenetrationBatchResult } from "@/lib/penetration/result-merge"
import {
  getPenetrationSlotValidationError,
  isCompletePenetrationItem,
  nextPenetrationCapacityRetryAt,
  nextPenetrationRetryAtForError,
} from "@/lib/penetration/slot-policy"
import {
  formatPenetrationProviderError,
  isPermanentPenetrationProviderError,
  isTransientPenetrationCapacityError,
} from "@/lib/penetration/provider-errors"
import {
  releasePenetrationWaveBatchReservation,
  releasePenetrationWaveReservations,
  selectPenetrationDueWave,
  selectPenetrationDueWaveV3,
} from "@/lib/penetration/wave-scheduler"
import { estimateFeatureCredits } from "@/lib/pricing"
import { settleReservedCredits, type CreditReservation } from "@/lib/with-credits"
import { mutateWorkspaceClientLatest } from "@/lib/workspace-store"
import {
  buildPenetrationHistoryRecord,
  savePenetrationHistoryRecord,
} from "@/lib/penetration/history-store"
import { buildPenetrationSystemOutputRecord } from "@/lib/system-output/builders"
import { saveSystemOutputRecord } from "@/lib/system-output/store"
import type {
  AnalysisSubjectType,
  ModelKey,
  PenetrationByModel,
  PenetrationHistoryStatus,
  PenetrationJobOperation,
  PenetrationJobRecord,
  PenetrationItem,
  PenetrationModelProgress,
  PenetrationQuestionIntentHint,
  PenetrationResult,
  PersonSubjectProfile,
} from "@/types"

export interface PenetrationJobRequest {
  clientId: string
  clientName?: string
  runId: string
  operation: PenetrationJobOperation
  subjectType: AnalysisSubjectType
  personProfile?: PersonSubjectProfile
  ourBrand: string
  brandAliases: string[]
  industry: string
  website?: string
  questions: string[]
  questionIntents?: PenetrationQuestionIntentHint[]
  competitors: string[]
  selectedModels?: ModelKey[]
  models: ModelKey[]
  slotSelection?: Array<{
    model: ModelKey
    questionIndex: number
  }>
  origin?: "manual" | "automation"
  automationScheduleId?: string
  automationExecutionId?: string
  automationTrigger?: "scheduled" | "manual"
}

type StoredPenetrationJob = PenetrationJobRecord & {
  request: PenetrationJobRequest
  ownerUserId: string
  workspaceOwnerUserId: string
  teamId?: string
  reservedCredits: number
  creditReservation?: CreditReservation
  batchBaseUrls: string[]
  baseResult?: PenetrationResult
  creditsSettledAt?: string
  slotStates?: Record<string, StoredPenetrationSlotState>
  partialPersistedSlots?: number
  partialPersistedAt?: string
}

type PenetrationSlotRuntimeStatus =
  | "queued"
  | "running"
  | "retry_wait"
  | "success"
  | "provider_blocked"

type StoredPenetrationSlotState = {
  model: ModelKey
  questionIndex: number
  status: PenetrationSlotRuntimeStatus
  attempts: number
  capacityDeferrals?: number
  lastError?: string
  nextRetryAt?: string
  updatedAt: string
}

type PenetrationBatch = {
  questions: string[]
  models: ModelKey[]
  sampleStart: number
  schedulerReservation?: {
    token: string
    keys: string[]
  }
}

type PenetrationBatchResponse = {
  error?: string
  byModel?: PenetrationByModel
  generatedAt?: string
  skipped?: string[]
  modelErrors?: Partial<Record<ModelKey, string>>
  pipelineStage?: "sample" | "judge" | "complete"
}

const PENETRATION_JOB_SLOT_BATCH_LIMIT = 6
const PENETRATION_SCHEDULER_V3 = process.env.PENETRATION_SCHEDULER_V3
  ?.trim().toLowerCase() !== "false"
const PENETRATION_SCHEDULER_V2 = process.env.PENETRATION_SCHEDULER_V2
  ?.trim().toLowerCase() !== "false"
const PENETRATION_JOB_BATCH_TIMEOUT_MS = 15 * 60 * 1000
const PENETRATION_JOB_MAX_BATCH_ATTEMPTS = 2
const PENETRATION_JOB_TTL_SECONDS = 60 * 60 * 24 * 7
const PENETRATION_JOB_CANCELLED_MESSAGE = "用户已停止检测"
const PENETRATION_JOB_RUN_LEASE_SECONDS = 30 * 60
const PENETRATION_PENDING_SET_KEY = "geo:penetration-jobs:pending"
const PENETRATION_PARTIAL_PERSIST_SLOT_INTERVAL = Math.max(
  1,
  Math.min(50, Math.floor(Number(process.env.PENETRATION_PARTIAL_PERSIST_SLOT_INTERVAL) || 6)),
)
const PENETRATION_PARTIAL_PERSIST_MIN_INTERVAL_MS = Math.max(
  2_000,
  Math.min(60_000, Number(process.env.PENETRATION_PARTIAL_PERSIST_MIN_INTERVAL_MS) || 10_000),
)
const MAX_CONCURRENT_PENETRATION_JOBS = Math.max(
  1,
  Math.min(8, Math.floor(Number(process.env.PENETRATION_JOB_CONCURRENCY) || 3)),
)
const MAX_CONCURRENT_PENETRATION_JOBS_PER_USER = Math.max(
  1,
  Math.min(
    2,
    Math.floor(Number(process.env.PENETRATION_JOB_PER_USER_CONCURRENCY) || 1),
  ),
)

const memoryJobs = new Map<string, StoredPenetrationJob>()
const activeJobs = new Set<string>()
const activeJobOwners = new Map<string, string>()
const activeOwnerCounts = new Map<string, number>()
const queuedJobs: string[] = []
const queuedJobIds = new Set<string>()
const activeAbortControllers = new Map<string, AbortController>()
const settlingJobs = new Set<string>()
const historySavingJobs = new Set<string>()
const resumeTimers = new Map<string, ReturnType<typeof setTimeout>>()
let schedulerRunning = false
let schedulerRequested = false
let queueRecoveryPromise: Promise<void> | null = null
let queueRecoveryCompleted = false

const jobKey = (id: string) => `geo:penetration-jobs:${id}`
const jobLeaseKey = (id: string) => `geo:penetration-job-leases:${id}`

function nowIso(): string {
  return new Date().toISOString()
}

function toPublicJob(job: StoredPenetrationJob): PenetrationJobRecord {
  const retryableSlots = Object.values(job.slotStates || {})
    .filter(state => state.status === "provider_blocked")
    .map(state => ({
      model: state.model,
      question: job.request.questions[state.questionIndex] || "",
      questionIndex: state.questionIndex,
      error: state.lastError || "联网回答未达到完整性标准",
    }))
    .filter(slot => slot.question)
  const publicJob: Partial<StoredPenetrationJob> = { ...job }
  delete publicJob.request
  delete publicJob.ownerUserId
  delete publicJob.workspaceOwnerUserId
  delete publicJob.teamId
  delete publicJob.reservedCredits
  delete publicJob.creditReservation
  delete publicJob.batchBaseUrls
  delete publicJob.baseResult
  delete publicJob.creditsSettledAt
  delete publicJob.slotStates
  delete publicJob.partialPersistedSlots
  delete publicJob.partialPersistedAt
  const queueIndex = queuedJobs.indexOf(job.id)
  if (queueIndex >= 0) {
    publicJob.queuePosition = queueIndex + 1
    publicJob.queueDepth = queuedJobs.length
    publicJob.queueReason = activeOwnerCount(job.ownerUserId)
      >= MAX_CONCURRENT_PENETRATION_JOBS_PER_USER
      ? "user_limit"
      : activeJobs.size >= MAX_CONCURRENT_PENETRATION_JOBS
        ? "capacity"
        : "queued"
  } else if (resumeTimers.has(job.id)) {
    publicJob.queueDepth = queuedJobs.length
    publicJob.queueReason = "retry_wait"
  } else {
    delete publicJob.queuePosition
    delete publicJob.queueDepth
    delete publicJob.queueReason
  }
  const result = publicJob as PenetrationJobRecord
  if (retryableSlots.length > 0) result.retryableSlots = retryableSlots
  return result
}

function uniqueBaseUrls(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = value?.trim().replace(/\/+$/, "")
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function buildBatchBaseUrls(): string[] {
  return uniqueBaseUrls([
    `http://127.0.0.1:${process.env.PORT || "3000"}`,
    process.env.GEO_INTERNAL_BASE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ])
}

function slotKey(model: ModelKey, questionIndex: number): string {
  return `${model}:${questionIndex}`
}

function expectedSampleId(job: StoredPenetrationJob, model: ModelKey, questionIndex: number): string {
  return `${job.request.runId}_${model}_${questionIndex + 1}`
}

function initialSlotStates(job: StoredPenetrationJob): Record<string, StoredPenetrationSlotState> {
  const now = nowIso()
  const states: Record<string, StoredPenetrationSlotState> = {}
  const selectedSlots = job.request.slotSelection?.length
    ? new Set(job.request.slotSelection.map(slot => slotKey(slot.model, slot.questionIndex)))
    : null
  for (const model of job.request.models) {
    const existing = job.result?.byModel[model] || []
    for (let questionIndex = 0; questionIndex < job.request.questions.length; questionIndex++) {
      if (selectedSlots && !selectedSlots.has(slotKey(model, questionIndex))) continue
      const sampleId = expectedSampleId(job, model, questionIndex)
      const item = existing.find(candidate => candidate.sampleId === sampleId)
      states[slotKey(model, questionIndex)] = {
        model,
        questionIndex,
        status: isCompletePenetrationItem(item) ? "success" : "queued",
        attempts: isCompletePenetrationItem(item) ? 1 : 0,
        updatedAt: now,
      }
    }
  }
  return states
}

function requestedSlotCount(request: PenetrationJobRequest): number {
  return request.slotSelection?.length
    || request.questions.length * request.models.length
}

function isRecoverableSlot(state: StoredPenetrationSlotState): boolean {
  return state.status === "queued" || state.status === "running" || state.status === "retry_wait"
}

function isRetryingSlot(state: StoredPenetrationSlotState): boolean {
  return state.status === "retry_wait" && state.attempts > 0
}

function isDueSlot(state: StoredPenetrationSlotState, nowMs: number): boolean {
  if (state.status === "queued") return true
  if (state.status !== "retry_wait") return false
  return !state.nextRetryAt || Date.parse(state.nextRetryAt) <= nowMs
}

function summarizeSlotStates(
  job: StoredPenetrationJob,
  states: Record<string, StoredPenetrationSlotState>,
): Pick<
  StoredPenetrationJob,
  | "completedSlots"
  | "completedBatches"
  | "phase"
  | "retryRound"
  | "nextRetryAt"
  | "totalAttempts"
  | "retryingSlots"
  | "blockedSlots"
  | "activeSlots"
  | "queuedSlots"
  | "waitingSlots"
  | "modelProgress"
  | "modelErrors"
> {
  const values = Object.values(states)
  const completedSlots = values.filter(state => state.status === "success").length
  const retryingSlots = values.filter(isRetryingSlot).length
  const blockedSlots = values.filter(state => state.status === "provider_blocked").length
  const activeSlots = values.filter(state => state.status === "running").length
  const queuedSlots = values.filter(state => state.status === "queued").length
  const waitingSlots = values.filter(state => state.status === "retry_wait").length
  const totalAttempts = values.reduce((sum, state) => sum + state.attempts, 0)
  const retryRound = Math.max(0, ...values.map(state => Math.max(0, state.attempts - 1)))
  const retryTimes = values
    .filter(state => state.status === "retry_wait" && !!state.nextRetryAt)
    .map(state => state.nextRetryAt as string)
    .sort()
  const modelProgress: Partial<Record<ModelKey, PenetrationModelProgress>> = {}
  const modelErrors: Partial<Record<ModelKey, string>> = {}

  for (const model of job.request.models) {
    const modelStates = values.filter(state => state.model === model)
    modelProgress[model] = {
      total: modelStates.length,
      succeeded: modelStates.filter(state => state.status === "success").length,
      retrying: modelStates.filter(isRetryingSlot).length,
      blocked: modelStates.filter(state => state.status === "provider_blocked").length,
      attempts: modelStates.reduce((sum, state) => sum + state.attempts, 0),
      active: modelStates.filter(state => state.status === "running").length,
      queued: modelStates.filter(state => state.status === "queued").length,
      waiting: modelStates.filter(state => state.status === "retry_wait").length,
    }
    const latestError = modelStates
      .filter(state => state.status !== "success" && !!state.lastError)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.lastError
    if (latestError) modelErrors[model] = latestError
  }

  let completedBatches = 0
  for (let questionIndex = 0; questionIndex < job.request.questions.length; questionIndex++) {
    const questionStates = values.filter(state => state.questionIndex === questionIndex)
    if (
      questionStates.length > 0
      && questionStates.every(state => state.status === "success")
    ) {
      completedBatches++
    }
  }

  const hasRetried = retryingSlots > 0
  const phase = completedSlots === job.totalSlots
    ? "finalizing"
    : hasRetried
      ? "retrying"
      : totalAttempts === 0 && activeSlots === 0
        ? "preflight"
        : "sampling"

  return {
    completedSlots,
    completedBatches,
    phase,
    retryRound,
    nextRetryAt: retryTimes[0],
    totalAttempts,
    retryingSlots,
    blockedSlots,
    activeSlots,
    queuedSlots,
    waitingSlots,
    modelProgress,
    modelErrors,
  }
}

function sameModels(left: ModelKey[], right: ModelKey[]): boolean {
  return left.length === right.length && left.every((model, index) => model === right[index])
}

function selectDueBatch(
  job: StoredPenetrationJob,
  states: Record<string, StoredPenetrationSlotState>,
  nowMs: number,
): PenetrationBatch | null {
  const dueModelsAt = (questionIndex: number) => job.request.models.filter(model => {
    const state = states[slotKey(model, questionIndex)]
    return !!state && isDueSlot(state, nowMs)
  })

  let sampleStart = -1
  let models: ModelKey[] = []
  for (let index = 0; index < job.request.questions.length; index++) {
    const due = dueModelsAt(index)
    if (due.length === 0) continue
    sampleStart = index
    // TokenHub HY3 uses a long-lived search connection and is materially more
    // stable when it does not share an internal batch with the other providers.
    models = due.length > 1 && due.includes("hunyuan")
      ? due.filter(model => model !== "hunyuan")
      : due
    break
  }
  if (sampleStart < 0 || models.length === 0) return null

  const maxQuestions = models.includes("hunyuan")
    ? 1
    : Math.max(1, Math.floor(PENETRATION_JOB_SLOT_BATCH_LIMIT / models.length))
  let count = 1
  while (count < maxQuestions && sampleStart + count < job.request.questions.length) {
    if (!sameModels(models, dueModelsAt(sampleStart + count))) break
    count++
  }

  return {
    questions: job.request.questions.slice(sampleStart, sampleStart + count),
    models,
    sampleStart,
  }
}

async function saveJob(job: StoredPenetrationJob): Promise<void> {
  memoryJobs.set(job.id, job)
  await kv.set(jobKey(job.id), job, { ex: PENETRATION_JOB_TTL_SECONDS })
  await syncPenetrationJobTask(job)
}

async function getStoredJob(id: string): Promise<StoredPenetrationJob | null> {
  const memory = memoryJobs.get(id)
  try {
    const stored = await kv.get<StoredPenetrationJob>(jobKey(id))
    if (stored) {
      memoryJobs.set(id, stored)
      return stored
    }
  } catch (error) {
    console.warn("[penetration-jobs] KV read failed, using memory fallback:", error)
  }
  return memory || null
}

async function patchJob(
  id: string,
  patch: Partial<StoredPenetrationJob>,
): Promise<StoredPenetrationJob | null> {
  const current = await getStoredJob(id)
  if (!current) return null
  if (
    ["succeeded", "blocked", "failed", "cancelled"].includes(current.status)
    && patch.status
    && patch.status !== current.status
  ) return current
  const next = { ...current, ...patch, updatedAt: nowIso() }
  await saveJob(next)
  return next
}

async function markJobPending(id: string): Promise<void> {
  try {
    await kv.sadd(PENETRATION_PENDING_SET_KEY, id)
  } catch (error) {
    console.warn("[penetration-jobs] failed to persist pending job", id, error)
  }
}

async function clearPendingJob(id: string): Promise<void> {
  try {
    await kv.srem(PENETRATION_PENDING_SET_KEY, id)
  } catch (error) {
    console.warn("[penetration-jobs] failed to clear pending job", id, error)
  }
}

class PenetrationJobCancelledError extends Error {
  constructor() {
    super(PENETRATION_JOB_CANCELLED_MESSAGE)
    this.name = "PenetrationJobCancelledError"
  }
}

function isCancelledError(error: unknown): boolean {
  return error instanceof PenetrationJobCancelledError
    || (error instanceof Error && error.name === "PenetrationJobCancelledError")
}

async function assertNotCancelled(id: string): Promise<void> {
  const current = await getStoredJob(id)
  if (current?.status === "cancelled") throw new PenetrationJobCancelledError()
}

function clearResumeTimer(id: string): void {
  const timer = resumeTimers.get(id)
  if (timer) clearTimeout(timer)
  resumeTimers.delete(id)
}

function scheduleResume(id: string, atIso: string): void {
  const delay = Math.max(250, Date.parse(atIso) - Date.now())
  void dispatchPenetrationJob(id, delay)
}

function mergeStrings(current: string[], incoming: string[]): string[] {
  return Array.from(new Set([...current, ...incoming].map(item => item.trim()).filter(Boolean)))
}

function successfulSlotCount(byModel: PenetrationByModel | undefined): number {
  if (!byModel) return 0
  return Object.values(byModel).reduce((total, items) => {
    return total + (items || []).filter(isCompletePenetrationItem).length
  }, 0)
}

function successfulNewSlotCount(job: StoredPenetrationJob | null | undefined): number {
  if (!job) return 0
  return Math.max(
    0,
    successfulSlotCount(job.result?.byModel) - successfulSlotCount(job.baseResult?.byModel),
  )
}

async function settleJobCredits(id: string, usedSlots: number): Promise<void> {
  if (settlingJobs.has(id)) return
  settlingJobs.add(id)
  try {
    const job = await getStoredJob(id)
    if (!job || job.creditsSettledAt) return
    const reservation: CreditReservation = job.creditReservation || {
      userId: job.ownerUserId,
      amount: job.reservedCredits,
      balanceAfterReserve: 0,
      ledgerContext: {
        featureKey: "penetrationSlot",
        source: "penetration-job",
        sourceId: id,
        description: "渗透率检测",
        metadata: {
          clientId: job.clientId,
          requestedSlots: job.totalSlots,
        },
      },
    }
    await settleReservedCredits(
      reservation,
      estimateFeatureCredits("penetrationSlot", usedSlots),
    )
    await patchJob(id, { creditsSettledAt: nowIso() })
  } finally {
    settlingJobs.delete(id)
  }
}

async function settleJobCreditsQuietly(id: string, usedSlots: number): Promise<void> {
  try {
    await settleJobCredits(id, usedSlots)
  } catch (error) {
    console.error("[penetration-jobs] credit settlement failed", id, usedSlots, error)
  }
}

async function persistJobResultToWorkspace(
  job: StoredPenetrationJob,
  options: { finalize?: boolean } = {},
): Promise<boolean> {
  if (!job.result) return false
  const finalize = options.finalize !== false
  try {
    const saved = await mutateWorkspaceClientLatest({
      userId: job.workspaceOwnerUserId || job.ownerUserId,
      clientId: job.clientId,
      mutate: current => {
        if (current.penetrationJobId && current.penetrationJobId !== job.id) return null
        return {
          patch: { penetration: job.result },
          ...(finalize && current.penetrationJobId === job.id
            ? { unsetFields: ["penetrationJobId"] as const }
            : {}),
        }
      },
    })
    if (!saved) {
      console.warn("[penetration-jobs] workspace client not found", job.id, job.clientId)
      return false
    }
    return true
  } catch (error) {
    console.error("[penetration-jobs] workspace result persistence failed", job.id, error)
    return false
  }
}

function shouldPersistPartialJobResult(job: StoredPenetrationJob): boolean {
  if (!job.result || job.completedSlots <= (job.partialPersistedSlots || 0)) return false
  if (!job.partialPersistedAt) return true
  const completedDelta = job.completedSlots - (job.partialPersistedSlots || 0)
  const elapsedMs = Date.now() - Date.parse(job.partialPersistedAt)
  return completedDelta >= PENETRATION_PARTIAL_PERSIST_SLOT_INTERVAL
    || !Number.isFinite(elapsedMs)
    || elapsedMs >= PENETRATION_PARTIAL_PERSIST_MIN_INTERVAL_MS
}

async function persistPartialJobResult(
  job: StoredPenetrationJob,
): Promise<StoredPenetrationJob> {
  if (!shouldPersistPartialJobResult(job)) return job
  const saved = await persistJobResultToWorkspace(job, { finalize: false })
  if (!saved) return job
  const persistedAt = nowIso()
  return await patchJob(job.id, {
    partialPersistedSlots: job.completedSlots,
    partialPersistedAt: persistedAt,
  }) || { ...job, partialPersistedSlots: job.completedSlots, partialPersistedAt: persistedAt }
}

type PenetrationHistoryJobPatch = Pick<
  PenetrationJobRecord,
  "historyRecordId" | "historySavedAt" | "historySavePending"
>

async function persistTerminalHistory(args: {
  job: StoredPenetrationJob
  status: PenetrationHistoryStatus
  error?: string
  finishedAt: string
}): Promise<PenetrationHistoryJobPatch> {
  if (args.job.historySavedAt) {
    return {
      historyRecordId: args.job.historyRecordId || args.job.id,
      historySavedAt: args.job.historySavedAt,
      historySavePending: false,
    }
  }
  if (historySavingJobs.has(args.job.id)) {
    return {
      historyRecordId: args.job.id,
      historySavePending: true,
    }
  }

  historySavingJobs.add(args.job.id)
  try {
    const record = buildPenetrationHistoryRecord({
      id: args.job.id,
      actorUserId: args.job.ownerUserId,
      request: {
        clientId: args.job.request.clientId,
        clientName: args.job.request.clientName?.trim()
          || args.job.request.ourBrand.trim()
          || args.job.request.clientId,
        subjectType: args.job.request.subjectType || "brand",
        personProfile: args.job.request.personProfile,
        ourBrand: args.job.request.ourBrand,
        brandAliases: args.job.request.brandAliases,
        industry: args.job.request.industry,
        website: args.job.request.website?.trim() || "",
        questions: args.job.request.questions,
        questionIntents: args.job.request.questionIntents,
        competitors: args.job.request.competitors,
        models: args.job.request.selectedModels || args.job.request.models,
        activeModels: args.job.request.models,
        skippedModels: args.job.skipped,
        operation: args.job.request.operation,
        origin: args.job.request.origin,
        automationScheduleId: args.job.request.automationScheduleId,
        automationExecutionId: args.job.request.automationExecutionId,
        automationTrigger: args.job.request.automationTrigger,
      },
      status: args.status,
      result: args.job.result,
      error: args.error,
      completedSlots: args.job.completedSlots,
      totalSlots: args.job.totalSlots,
      createdAt: args.job.createdAt,
      completedAt: args.finishedAt,
    })
    const workspaceOwnerUserId = args.job.workspaceOwnerUserId || args.job.ownerUserId
    await savePenetrationHistoryRecord(workspaceOwnerUserId, record)
    await saveSystemOutputRecord(
      workspaceOwnerUserId,
      buildPenetrationSystemOutputRecord(workspaceOwnerUserId, record),
    )
    return {
      historyRecordId: record.id,
      historySavedAt: nowIso(),
      historySavePending: false,
    }
  } catch (error) {
    console.error("[penetration-jobs] history persistence failed", args.job.id, error)
    return {
      historyRecordId: args.job.id,
      historySavePending: true,
    }
  } finally {
    historySavingJobs.delete(args.job.id)
  }
}

function historyStatusForJob(job: StoredPenetrationJob): PenetrationHistoryStatus | null {
  if (job.status === "succeeded") return "succeeded"
  if (job.status === "blocked") return "partial"
  if (job.status === "cancelled") return "cancelled"
  if (job.status === "failed") return "failed"
  return null
}

async function retryTerminalHistory(job: StoredPenetrationJob): Promise<void> {
  const status = historyStatusForJob(job)
  if (!status || job.historySavedAt || historySavingJobs.has(job.id)) return
  const finishedAt = job.finishedAt || nowIso()
  const historyPatch = await persistTerminalHistory({
    job,
    status,
    error: job.error,
    finishedAt,
  })
  await patchJob(job.id, {
    status: job.status,
    ...historyPatch,
  })
}

async function readBatchResponse(response: Response): Promise<PenetrationBatchResponse> {
  const text = await response.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text) as PenetrationBatchResponse
  } catch {
    throw new Error(`检测批次返回格式异常（HTTP ${response.status}）`)
  }
}

async function fetchBatch(job: StoredPenetrationJob, batch: PenetrationBatch): Promise<PenetrationBatchResponse> {
  let lastError: unknown

  for (let attempt = 0; attempt < PENETRATION_JOB_MAX_BATCH_ATTEMPTS; attempt++) {
    await assertNotCancelled(job.id)

    for (const baseUrl of job.batchBaseUrls) {
      await assertNotCancelled(job.id)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), PENETRATION_JOB_BATCH_TIMEOUT_MS)
      activeAbortControllers.set(job.id, controller)
      const unregisterTaskController = registerTaskAbortController(
        "penetration",
        job.id,
        controller,
      )

      try {
        const response = await fetch(`${baseUrl}/api/penetration`, {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            ...createInternalApiHeaders("penetration-job"),
          },
          body: JSON.stringify({
            ...job.request,
            questions: batch.questions,
            models: batch.models,
            sampleStart: batch.sampleStart,
            pipelineStage: PENETRATION_SCHEDULER_V3 ? "sample" : "complete",
          }),
          signal: controller.signal,
        })
        const data = await readBatchResponse(response)
        if (!response.ok) {
          throw new Error(data.error || `检测批次请求失败（HTTP ${response.status}）`)
        }
        if (!data.byModel || !data.generatedAt) {
          throw new Error("检测批次没有返回完整结果")
        }
        await assertNotCancelled(job.id)
        return data
      } catch (error) {
        await assertNotCancelled(job.id)
        lastError = controller.signal.aborted
          ? new Error("检测批次执行超时，后台将自动重试")
          : error
      } finally {
        clearTimeout(timeout)
        unregisterTaskController()
        if (activeAbortControllers.get(job.id) === controller) {
          activeAbortControllers.delete(job.id)
        }
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("检测批次执行失败")
}

async function fetchBatchJudge(
  job: StoredPenetrationJob,
  batch: PenetrationBatch,
  sampledByModel: PenetrationByModel,
): Promise<PenetrationBatchResponse> {
  let lastError: unknown
  for (let attempt = 0; attempt < PENETRATION_JOB_MAX_BATCH_ATTEMPTS; attempt++) {
    await assertNotCancelled(job.id)
    for (const baseUrl of job.batchBaseUrls) {
      const controller = new AbortController()
      const timeout = setTimeout(
        () => controller.abort(),
        Math.min(PENETRATION_JOB_BATCH_TIMEOUT_MS, 3 * 60 * 1000),
      )
      activeAbortControllers.set(job.id, controller)
      const unregisterTaskController = registerTaskAbortController(
        "penetration",
        job.id,
        controller,
      )
      try {
        const response = await fetch(`${baseUrl}/api/penetration`, {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            ...createInternalApiHeaders("penetration-job"),
          },
          body: JSON.stringify({
            ...job.request,
            questions: batch.questions,
            models: batch.models,
            sampleStart: batch.sampleStart,
            pipelineStage: "judge",
            sampledByModel,
          }),
          signal: controller.signal,
        })
        const data = await readBatchResponse(response)
        if (!response.ok) {
          throw new Error(data.error || `裁判批次请求失败（HTTP ${response.status}）`)
        }
        if (!data.byModel || !data.generatedAt) {
          throw new Error("裁判批次没有返回完整结果")
        }
        return data
      } catch (error) {
        await assertNotCancelled(job.id)
        lastError = controller.signal.aborted
          ? new Error("裁判批次执行超时，已保留原始联网回答")
          : error
      } finally {
        clearTimeout(timeout)
        unregisterTaskController()
        if (activeAbortControllers.get(job.id) === controller) {
          activeAbortControllers.delete(job.id)
        }
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("裁判批次执行失败，已保留原始联网回答")
}

type PenetrationAttemptItem = PenetrationItem & { error?: string; judgeError?: string }

function penetrationSlotError(
  item: PenetrationAttemptItem | undefined,
  modelError: string | undefined,
  batchError: string,
): string {
  // A model-level summary may describe a different question in the same batch.
  // Once this slot has its own item, only that item's error belongs to the slot.
  if (item) return item.error || ""
  return modelError || batchError
}

function cloneSlotStates(
  states: Record<string, StoredPenetrationSlotState>,
): Record<string, StoredPenetrationSlotState> {
  return Object.fromEntries(
    Object.entries(states).map(([key, state]) => [key, { ...state }]),
  )
}

function blockRemainingModelSlots(
  states: Record<string, StoredPenetrationSlotState>,
  model: ModelKey,
  error: string,
  updatedAt: string,
): void {
  for (const state of Object.values(states)) {
    if (state.model !== model || state.status === "success") continue
    state.status = "provider_blocked"
    state.lastError = error
    state.nextRetryAt = undefined
    state.updatedAt = updatedAt
  }
}

function returnedItemFor(
  job: StoredPenetrationJob,
  data: PenetrationBatchResponse | undefined,
  batch: PenetrationBatch,
  model: ModelKey,
  questionOffset: number,
): PenetrationAttemptItem | undefined {
  const items = (data?.byModel?.[model] || []) as PenetrationAttemptItem[]
  const questionIndex = batch.sampleStart + questionOffset
  const sampleId = expectedSampleId(job, model, questionIndex)
  return items.find(item => item.sampleId === sampleId) || items[questionOffset]
}

async function processDueBatch(
  job: StoredPenetrationJob,
  batch: PenetrationBatch,
): Promise<StoredPenetrationJob> {
  let states = cloneSlotStates(job.slotStates || initialSlotStates(job))
  const startedAt = nowIso()
  for (const model of batch.models) {
    for (let offset = 0; offset < batch.questions.length; offset++) {
      const state = states[slotKey(model, batch.sampleStart + offset)]
      if (!state || !isRecoverableSlot(state)) continue
      state.status = "running"
      state.nextRetryAt = undefined
      state.updatedAt = startedAt
    }
  }

  job = await patchJob(job.id, {
    slotStates: states,
    ...summarizeSlotStates(job, states),
  }) || job

  let data: PenetrationBatchResponse | undefined
  let batchError = ""
  try {
    data = await fetchBatch(job, batch)
  } catch (error) {
    if (isCancelledError(error)) throw error
    batchError = error instanceof Error ? error.message : "检测批次执行失败"
  }
  await assertNotCancelled(job.id)

  const latest = await getStoredJob(job.id)
  if (latest) job = latest
  states = cloneSlotStates(job.slotStates || states)
  const completedAt = nowIso()
  const validIncoming: PenetrationByModel = {}

  for (const model of batch.models) {
    for (let offset = 0; offset < batch.questions.length; offset++) {
      const questionIndex = batch.sampleStart + offset
      const key = slotKey(model, questionIndex)
      const state = states[key]
      if (!state || state.status !== "running") continue

      const item = returnedItemFor(job, data, batch, model, offset)
      const attempts = state.attempts + 1
      const itemError = penetrationSlotError(item, data?.modelErrors?.[model], batchError)
      const validationError = itemError || getPenetrationSlotValidationError(item)

      if (!validationError && item) {
        item.webVerified = true
        state.status = "success"
        state.attempts = attempts
        state.capacityDeferrals = 0
        state.lastError = undefined
        state.nextRetryAt = undefined
        state.updatedAt = completedAt
        ;(validIncoming[model] ||= []).push(item)
        continue
      }

      const message = formatPenetrationProviderError(
        model,
        validationError || "模型联网回答未通过完整性校验",
      )
      if (isTransientPenetrationCapacityError(message)) {
        const deferrals = (state.capacityDeferrals || 0) + 1
        state.status = "retry_wait"
        state.capacityDeferrals = deferrals
        state.lastError = "当前独立账号并发已满，任务已保留并将在空闲后自动继续"
        state.updatedAt = completedAt
        state.nextRetryAt = nextPenetrationCapacityRetryAt(
          deferrals,
          Date.parse(completedAt),
          `${job.id}:${key}:capacity:${deferrals}`,
        )
        continue
      }
      state.attempts = attempts
      state.capacityDeferrals = 0
      state.lastError = message
      state.updatedAt = completedAt

      if (isPermanentPenetrationProviderError(message)) {
        blockRemainingModelSlots(states, model, message, completedAt)
        continue
      }

      const retryAt = nextPenetrationRetryAtForError(
        message,
        attempts,
        Date.parse(completedAt),
        `${job.id}:${key}:${attempts}`,
      )
      if (retryAt) {
        state.status = "retry_wait"
        state.nextRetryAt = retryAt
      } else {
        state.status = "provider_blocked"
        state.nextRetryAt = undefined
        state.lastError = `连续 ${attempts} 次独立联网补采仍未得到完整回答：${message}`
      }
    }
  }

  const hasValidIncoming = Object.values(validIncoming).some(items => (items || []).length > 0)
  const generatedAt = data?.generatedAt || completedAt
  const result = hasValidIncoming
    ? buildPenetrationBatchResult({
        operation: job.request.operation || "replace",
        currentResult: job.result,
        baseResult: job.baseResult,
        incomingByModel: validIncoming,
        ourBrand: job.request.ourBrand,
        brandAliases: job.request.brandAliases,
        competitors: job.request.competitors,
        subjectType: job.request.subjectType || "brand",
        generatedAt,
        plannedQuestions: job.request.operation === "append"
          ? undefined
          : job.request.questions,
        questionIntents: job.request.questionIntents,
        plannedSlots: job.request.operation === "append"
          ? (
              job.baseResult?.aggregated.plannedSlots
              ?? job.baseResult?.aggregated.totalSlots
              ?? 0
            ) + job.totalSlots
          : job.totalSlots,
        modelCount: job.request.operation === "append" ? undefined : job.request.models.length,
      })
    : job.result
  const progress = summarizeSlotStates(job, states)

  return await patchJob(job.id, {
    slotStates: states,
    result,
    skipped: mergeStrings(job.skipped, data?.skipped || []),
    ...progress,
  }) || { ...job, slotStates: states, result, ...progress }
}

type SettledPenetrationBatch = {
  index: number
  batch: PenetrationBatch
  data?: PenetrationBatchResponse
  error?: unknown
}

type SettledPenetrationJudgeBatch = {
  batch: PenetrationBatch
  sampledByModel: PenetrationByModel
  data?: PenetrationBatchResponse
  error?: unknown
}

function monotonicGeneratedAt(current: string | undefined, candidate: string): string {
  const currentMs = current ? Date.parse(current) : 0
  const candidateMs = Date.parse(candidate)
  if (!Number.isFinite(candidateMs)) {
    return Number.isFinite(currentMs) && currentMs > 0
      ? new Date(currentMs + 1).toISOString()
      : nowIso()
  }
  if (!Number.isFinite(currentMs) || candidateMs > currentMs) {
    return candidate
  }
  return new Date(currentMs + 1).toISOString()
}

async function processDueWave(
  initialJob: StoredPenetrationJob,
  batches: PenetrationBatch[],
): Promise<StoredPenetrationJob> {
  let job = initialJob
  let states = cloneSlotStates(job.slotStates || initialSlotStates(job))
  const startedAt = nowIso()
  for (const batch of batches) {
    for (const model of batch.models) {
      for (let offset = 0; offset < batch.questions.length; offset++) {
        const state = states[slotKey(model, batch.sampleStart + offset)]
        if (!state || !isRecoverableSlot(state)) continue
        state.status = "running"
        state.nextRetryAt = undefined
        state.updatedAt = startedAt
      }
    }
  }

  job = await patchJob(job.id, {
    slotStates: states,
    ...summarizeSlotStates(job, states),
  }) || job

  let nextBatchIndex = batches.length
  const pending = batches.map((batch, index) => ({
    index,
    promise: fetchBatch(job, batch)
      .then((data): SettledPenetrationBatch => ({ index, batch, data }))
      .catch((error): SettledPenetrationBatch => ({
        index,
        batch,
        error,
      }))
      .finally(() => releasePenetrationWaveBatchReservation(batch)),
  }))
  const successfulModelsInWave = new Set<ModelKey>()
  const permanentFailures = new Map<ModelKey, Array<{
    key: string
    message: string
    completedAt: string
  }>>()
  const rollingRefillSlotLimit = batches.reduce(
    (sum, batch) => sum + batch.questions.length,
    0,
  ) * 2
  let rollingRefillSlots = 0
  const judgePipelineConcurrency = Math.max(
    1,
    Math.min(4, Math.floor(Number(process.env.PENETRATION_V3_JUDGE_HTTP_CONCURRENCY) || 2)),
  )
  const judgeLaneTails = Array.from(
    { length: judgePipelineConcurrency },
    () => Promise.resolve(),
  )
  const pendingJudgeBatches: Array<Promise<SettledPenetrationJudgeBatch>> = []
  let judgeLaneCursor = 0

  function enqueueBatchJudge(
    batch: PenetrationBatch,
    data: PenetrationBatchResponse | undefined,
  ): void {
    if (data?.pipelineStage !== "sample" || !data.byModel) return
    const lane = judgeLaneCursor++ % judgeLaneTails.length
    const sampledByModel = data.byModel
    const task = judgeLaneTails[lane]
      .then(() => fetchBatchJudge(job, batch, sampledByModel))
      .then((judged): SettledPenetrationJudgeBatch => ({ batch, sampledByModel, data: judged }))
      .catch((error): SettledPenetrationJudgeBatch => ({ batch, sampledByModel, error }))
    judgeLaneTails[lane] = task.then(() => undefined)
    pendingJudgeBatches.push(task)
  }

  async function enqueueRollingBatches(nextBatches: PenetrationBatch[]): Promise<void> {
    if (nextBatches.length === 0) return
    const refillStartedAt = nowIso()
    const latest = await getStoredJob(job.id)
    if (latest) job = latest
    states = cloneSlotStates(job.slotStates || states)
    for (const batch of nextBatches) {
      for (const model of batch.models) {
        for (let offset = 0; offset < batch.questions.length; offset++) {
          const state = states[slotKey(model, batch.sampleStart + offset)]
          if (!state || !isDueSlot(state, Date.now())) continue
          state.status = "running"
          state.nextRetryAt = undefined
          state.updatedAt = refillStartedAt
        }
      }
    }
    job = await patchJob(job.id, {
      slotStates: states,
      ...summarizeSlotStates(job, states),
    }) || { ...job, slotStates: states }

    for (const batch of nextBatches) {
      const index = nextBatchIndex++
      pending.push({
        index,
        promise: fetchBatch(job, batch)
          .then((data): SettledPenetrationBatch => ({ index, batch, data }))
          .catch((error): SettledPenetrationBatch => ({
            index,
            batch,
            error,
          }))
          .finally(() => releasePenetrationWaveBatchReservation(batch)),
      })
    }
  }

  while (pending.length > 0) {
    const settled = await Promise.race(pending.map(item => item.promise))
    const pendingIndex = pending.findIndex(item => item.index === settled.index)
    if (pendingIndex >= 0) pending.splice(pendingIndex, 1)
    if (isCancelledError(settled.error)) throw settled.error
    await assertNotCancelled(job.id)

    const latest = await getStoredJob(job.id)
    if (latest) job = latest
    states = cloneSlotStates(job.slotStates || states)
    const completedAt = nowIso()
    const validIncoming: PenetrationByModel = {}
    const batchError = settled.error instanceof Error
      ? settled.error.message
      : settled.error
        ? "检测批次执行失败"
        : ""

    for (const model of settled.batch.models) {
      for (let offset = 0; offset < settled.batch.questions.length; offset++) {
        const questionIndex = settled.batch.sampleStart + offset
        const key = slotKey(model, questionIndex)
        const state = states[key]
        if (!state || state.status !== "running") continue

        const item = returnedItemFor(job, settled.data, settled.batch, model, offset)
        const attempts = state.attempts + 1
        const itemError = penetrationSlotError(
          item,
          settled.data?.modelErrors?.[model],
          batchError,
        )
        const validationError = itemError || getPenetrationSlotValidationError(item)

        if (!validationError && item) {
          item.webVerified = true
          state.status = "success"
          state.attempts = attempts
          state.capacityDeferrals = 0
          state.lastError = undefined
          state.nextRetryAt = undefined
          state.updatedAt = completedAt
          ;(validIncoming[model] ||= []).push(item)
          successfulModelsInWave.add(model)
          continue
        }

        const message = formatPenetrationProviderError(
          model,
          validationError || "模型联网回答未通过完整性校验",
        )
        if (isTransientPenetrationCapacityError(message)) {
          const deferrals = (state.capacityDeferrals || 0) + 1
          state.status = "retry_wait"
          state.capacityDeferrals = deferrals
          state.lastError = "当前独立账号并发已满，任务已保留并将在空闲后自动继续"
          state.updatedAt = completedAt
          state.nextRetryAt = nextPenetrationCapacityRetryAt(
            deferrals,
            Date.parse(completedAt),
            `${job.id}:${key}:capacity:${deferrals}`,
          )
          continue
        }
        state.attempts = attempts
        state.capacityDeferrals = 0
        state.lastError = message
        state.updatedAt = completedAt
        if (isPermanentPenetrationProviderError(message)) {
          state.status = "provider_blocked"
          state.nextRetryAt = undefined
          const failures = permanentFailures.get(model) || []
          failures.push({ key, message, completedAt })
          permanentFailures.set(model, failures)
          continue
        }

        const retryAt = nextPenetrationRetryAtForError(
          message,
          attempts,
          Date.parse(completedAt),
          `${job.id}:${key}:${attempts}`,
        )
        if (retryAt) {
          state.status = "retry_wait"
          state.nextRetryAt = retryAt
        } else {
          state.status = "provider_blocked"
          state.nextRetryAt = undefined
          state.lastError = `连续 ${attempts} 次独立联网补采仍未得到完整回答：${message}`
        }
      }
    }

    const hasValidIncoming = Object.values(validIncoming)
      .some(items => (items || []).length > 0)
    const generatedAt = monotonicGeneratedAt(
      job.result?.generatedAt,
      settled.data?.generatedAt || completedAt,
    )
    const result = hasValidIncoming
      ? buildPenetrationBatchResult({
          operation: job.request.operation || "replace",
          currentResult: job.result,
          baseResult: job.baseResult,
          incomingByModel: validIncoming,
          ourBrand: job.request.ourBrand,
          brandAliases: job.request.brandAliases,
          competitors: job.request.competitors,
          subjectType: job.request.subjectType || "brand",
          generatedAt,
          plannedQuestions: job.request.operation === "append"
            ? undefined
            : job.request.questions,
          questionIntents: job.request.questionIntents,
          plannedSlots: job.request.operation === "append"
            ? (
                job.baseResult?.aggregated.plannedSlots
                ?? job.baseResult?.aggregated.totalSlots
                ?? 0
              ) + job.totalSlots
            : job.totalSlots,
          modelCount: job.request.operation === "append"
            ? undefined
            : job.request.models.length,
        })
      : job.result
    const progress = summarizeSlotStates(job, states)

    job = await patchJob(job.id, {
      slotStates: states,
      result,
      skipped: mergeStrings(job.skipped, settled.data?.skipped || []),
      ...progress,
    }) || { ...job, slotStates: states, result, ...progress }
    job = await persistPartialJobResult(job)
    enqueueBatchJudge(settled.batch, settled.data)

    const remainingRefillSlots = rollingRefillSlotLimit - rollingRefillSlots
    if (
      PENETRATION_SCHEDULER_V3
      && pending.length > 0
      && remainingRefillSlots > 0
    ) {
      const candidates = await selectPenetrationDueWaveV3({
        models: job.request.models,
        questions: job.request.questions,
        states,
        nowMs: Date.now(),
        rotationSeed: (progress.totalAttempts || 0) + nextBatchIndex,
        allowElasticCapacity: true,
      })
      const accepted: PenetrationBatch[] = []
      const unusedReservations: PenetrationBatch[] = []
      let slotsLeft = remainingRefillSlots
      for (const candidate of candidates) {
        const acceptedCount = Math.min(slotsLeft, candidate.questions.length)
        const reservation = candidate.schedulerReservation
        if (acceptedCount > 0) {
          accepted.push({
            ...candidate,
            questions: candidate.questions.slice(0, acceptedCount),
            schedulerReservation: reservation
              ? {
                  token: reservation.token,
                  keys: reservation.keys.slice(0, acceptedCount),
                }
              : undefined,
          })
          slotsLeft -= acceptedCount
        }
        const unusedKeys = reservation?.keys.slice(acceptedCount) || []
        if (unusedKeys.length > 0) {
          unusedReservations.push({
            ...candidate,
            questions: [],
            schedulerReservation: {
              token: reservation!.token,
              keys: unusedKeys,
            },
          })
        }
      }
      await releasePenetrationWaveReservations(unusedReservations)
      rollingRefillSlots += accepted.reduce(
        (sum, batch) => sum + batch.questions.length,
        0,
      )
      await enqueueRollingBatches(accepted)
    }
  }

  const judgedBatches = await Promise.all(pendingJudgeBatches)
  for (const judged of judgedBatches) {
    if (judged.error || !judged.data?.byModel) {
      const message = sanitizeAiUpstreamMessage(
        judged.error instanceof Error ? judged.error.message : "品牌实体整理失败",
        500,
      )
      console.warn(
        "[penetration-jobs] independent judge stage failed; raw answers retained",
        job.id,
        message,
      )
      const failedByModel: PenetrationByModel = {}
      for (const [model, items] of Object.entries(judged.sampledByModel) as Array<[
        ModelKey,
        PenetrationItem[] | undefined,
      ]>) {
        failedByModel[model] = (items || []).map(item => item.answer?.trim()
          ? {
              ...item,
              extraction: {
                status: "failed",
                attempts: 0,
                extractedAt: nowIso(),
                version: 2,
                error: message,
              },
              judgeError: message,
            } as PenetrationAttemptItem
          : item)
      }
      const latest = await getStoredJob(job.id)
      if (latest) job = latest
      const failedResult = buildPenetrationBatchResult({
        operation: job.request.operation || "replace",
        currentResult: job.result,
        baseResult: job.baseResult,
        incomingByModel: failedByModel,
        ourBrand: job.request.ourBrand,
        brandAliases: job.request.brandAliases,
        competitors: job.request.competitors,
        subjectType: job.request.subjectType || "brand",
        generatedAt: monotonicGeneratedAt(job.result?.generatedAt, nowIso()),
        plannedQuestions: job.request.operation === "append"
          ? undefined
          : job.request.questions,
        questionIntents: job.request.questionIntents,
        plannedSlots: job.request.operation === "append"
          ? (job.baseResult?.aggregated.plannedSlots
            ?? job.baseResult?.aggregated.totalSlots
            ?? 0) + job.totalSlots
          : job.totalSlots,
        modelCount: job.request.operation === "append"
          ? undefined
          : job.request.models.length,
      })
      job = await patchJob(job.id, { result: failedResult })
        || { ...job, result: failedResult }
      job = await persistPartialJobResult(job)
      continue
    }
    const incomingByModel: PenetrationByModel = {}
    for (const [model, items] of Object.entries(judged.data.byModel) as Array<[
      ModelKey,
      PenetrationItem[] | undefined,
    ]>) {
      const completeItems = (items || []).filter(isCompletePenetrationItem)
      if (completeItems.length > 0) incomingByModel[model] = completeItems
    }
    if (!Object.values(incomingByModel).some(items => (items || []).length > 0)) continue
    const latest = await getStoredJob(job.id)
    if (latest) job = latest
    const judgedResult = buildPenetrationBatchResult({
      operation: job.request.operation || "replace",
      currentResult: job.result,
      baseResult: job.baseResult,
      incomingByModel,
      ourBrand: job.request.ourBrand,
      brandAliases: job.request.brandAliases,
      competitors: job.request.competitors,
      subjectType: job.request.subjectType || "brand",
      generatedAt: monotonicGeneratedAt(
        job.result?.generatedAt,
        judged.data.generatedAt || nowIso(),
      ),
      plannedQuestions: job.request.operation === "append"
        ? undefined
        : job.request.questions,
      questionIntents: job.request.questionIntents,
      plannedSlots: job.request.operation === "append"
        ? (
            job.baseResult?.aggregated.plannedSlots
            ?? job.baseResult?.aggregated.totalSlots
            ?? 0
          ) + job.totalSlots
        : job.totalSlots,
      modelCount: job.request.operation === "append"
        ? undefined
        : job.request.models.length,
    })
    job = await patchJob(job.id, { result: judgedResult })
      || { ...job, result: judgedResult }
    job = await persistPartialJobResult(job)
  }

  if (permanentFailures.size > 0) {
    const resolvedAt = nowIso()
    for (const [model, failures] of permanentFailures) {
      if (successfulModelsInWave.has(model)) {
        for (const failure of failures) {
          const state = states[failure.key]
          if (!state || state.status !== "provider_blocked") continue
          const retryAt = nextPenetrationRetryAtForError(
            failure.message,
            state.attempts,
            Date.parse(failure.completedAt),
            `${job.id}:${failure.key}:${state.attempts}:alternate-account`,
          )
          if (!retryAt) continue
          state.status = "retry_wait"
          state.nextRetryAt = retryAt
          state.lastError = "同模型其他独立账号已返回成功，本题将切换可用账号继续补采"
          state.updatedAt = resolvedAt
        }
        continue
      }
      blockRemainingModelSlots(
        states,
        model,
        failures[0]?.message || "模型当前不可用",
        resolvedAt,
      )
    }
    const progress = summarizeSlotStates(job, states)
    job = await patchJob(job.id, {
      slotStates: states,
      ...progress,
    }) || {
      ...job,
      slotStates: states,
      ...progress,
    }
  }
  return job
}

function activeOwnerCount(ownerUserId: string): number {
  return activeOwnerCounts.get(ownerUserId) || 0
}

function markJobActive(job: StoredPenetrationJob): void {
  activeJobs.add(job.id)
  activeJobOwners.set(job.id, job.ownerUserId)
  activeOwnerCounts.set(job.ownerUserId, activeOwnerCount(job.ownerUserId) + 1)
}

function releaseActiveJob(jobId: string): void {
  activeJobs.delete(jobId)
  const ownerUserId = activeJobOwners.get(jobId)
  activeJobOwners.delete(jobId)
  if (!ownerUserId) return
  const next = Math.max(0, activeOwnerCount(ownerUserId) - 1)
  if (next === 0) activeOwnerCounts.delete(ownerUserId)
  else activeOwnerCounts.set(ownerUserId, next)
}

function requestSchedulerRun(): void {
  if (schedulerRunning) {
    schedulerRequested = true
    return
  }
  queueMicrotask(() => {
    void drainJobQueue()
  })
}

function queueLocalJob(jobId: string): void {
  if (activeJobs.has(jobId) || queuedJobIds.has(jobId) || resumeTimers.has(jobId)) return
  queuedJobs.push(jobId)
  queuedJobIds.add(jobId)
  requestSchedulerRun()
}

function scheduleLocalResume(jobId: string, delayMs: number): void {
  clearResumeTimer(jobId)
  const timer = setTimeout(() => {
    resumeTimers.delete(jobId)
    queueLocalJob(jobId)
  }, Math.max(250, delayMs))
  timer.unref?.()
  resumeTimers.set(jobId, timer)
}

async function dispatchPenetrationJob(jobId: string, delayMs = 0): Promise<void> {
  await dispatchDurableTaskOrFallback(
    "penetration",
    jobId,
    () => {
      if (delayMs > 250) scheduleLocalResume(jobId, delayMs)
      else queueLocalJob(jobId)
    },
    { delayMs },
  )
}

function queueJob(jobId: string): void {
  void dispatchPenetrationJob(jobId)
}

async function recoverPendingJobs(): Promise<void> {
  let ids: string[] = []
  try {
    ids = await kv.smembers<string[]>(PENETRATION_PENDING_SET_KEY)
  } catch (error) {
    console.warn("[penetration-jobs] failed to recover persistent queue", error)
    throw error
  }

  const loadedJobs = await Promise.all(ids.map(async id => ({
    id,
    job: await getStoredJob(id),
  })))
  for (const item of loadedJobs) {
    if (!item.job) await clearPendingJob(item.id)
  }
  const jobs = loadedJobs
    .map(item => item.job)
    .filter((job): job is StoredPenetrationJob => Boolean(job))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))

  for (const job of jobs) {
    if (["succeeded", "blocked", "failed", "cancelled"].includes(job.status)) {
      await clearPendingJob(job.id)
      continue
    }
    const retryAtMs = job.nextRetryAt ? Date.parse(job.nextRetryAt) : 0
    await dispatchPenetrationJob(
      job.id,
      retryAtMs > Date.now() ? retryAtMs - Date.now() : 0,
    )
  }
}

async function ensurePendingJobsRecovered(): Promise<void> {
  if (queueRecoveryCompleted) return
  if (!queueRecoveryPromise) {
    queueRecoveryPromise = recoverPendingJobs()
      .then(() => {
        queueRecoveryCompleted = true
      })
      .catch(error => {
        console.warn("[penetration-jobs] persistent queue recovery failed", error)
      })
      .finally(() => {
        queueRecoveryPromise = null
      })
  }
  await queueRecoveryPromise
}

export async function resumePendingPenetrationJobs(): Promise<void> {
  await ensurePendingJobsRecovered()
}

export function getPenetrationQueueSnapshot() {
  return {
    active: activeJobs.size,
    activeLimit: MAX_CONCURRENT_PENETRATION_JOBS,
    queued: queuedJobs.length,
    delayed: resumeTimers.size,
    activeUsers: activeOwnerCounts.size,
    perUserLimit: MAX_CONCURRENT_PENETRATION_JOBS_PER_USER,
  }
}

async function drainJobQueue(): Promise<void> {
  if (schedulerRunning) {
    schedulerRequested = true
    return
  }
  schedulerRunning = true
  schedulerRequested = false

  try {
    while (
      activeJobs.size < MAX_CONCURRENT_PENETRATION_JOBS
      && queuedJobs.length > 0
    ) {
      const candidates = queuedJobs.length
      let selected: StoredPenetrationJob | null = null

      for (let index = 0; index < candidates; index++) {
        const jobId = queuedJobs.shift()
        if (!jobId) break
        queuedJobIds.delete(jobId)
        if (activeJobs.has(jobId)) continue

        const job = await getStoredJob(jobId)
        if (!job || ["succeeded", "blocked", "failed", "cancelled"].includes(job.status)) {
          await clearPendingJob(jobId)
          continue
        }
        if (resumeTimers.has(jobId)) continue
        if (activeOwnerCount(job.ownerUserId) >= MAX_CONCURRENT_PENETRATION_JOBS_PER_USER) {
          queuedJobs.push(jobId)
          queuedJobIds.add(jobId)
          continue
        }

        selected = job
        break
      }

      if (!selected) break
      markJobActive(selected)
      void runJobSlice(selected.id)
    }
  } finally {
    schedulerRunning = false
    if (schedulerRequested) {
      schedulerRequested = false
      setTimeout(requestSchedulerRun, 0)
    }
  }
}

async function runJobSlice(jobId: string): Promise<void> {
  clearResumeTimer(jobId)
  let shouldRequeue = false
  const leaseToken = `${process.pid}:${randomUUID()}`
  let ownsLease = false

  try {
    if (!durableTaskQueueEnabled("penetration")) {
      ownsLease = Boolean(await kv.set(jobLeaseKey(jobId), leaseToken, {
        nx: true,
        ex: PENETRATION_JOB_RUN_LEASE_SECONDS,
      }))
      if (!ownsLease) {
        scheduleResume(jobId, new Date(Date.now() + 2_000).toISOString())
        return
      }
    }

    let job = await getStoredJob(jobId)
    if (!job) return
    if (["succeeded", "blocked", "failed", "cancelled"].includes(job.status)) return

    let states = cloneSlotStates(job.slotStates || initialSlotStates(job))
    const resumedAt = nowIso()
    for (const state of Object.values(states)) {
      if (state.status !== "running") continue
      state.status = "retry_wait"
      state.nextRetryAt = resumedAt
      state.lastError = state.lastError || "服务进程中断后正在恢复本次独立联网采样"
      state.updatedAt = resumedAt
    }

    job = await patchJob(job.id, {
      status: "running",
      startedAt: job.startedAt || nowIso(),
      error: undefined,
      queueReason: undefined,
      slotStates: states,
      totalBatches: job.request.questions.length,
      ...summarizeSlotStates(job, states),
    }) || job

    await assertNotCancelled(job.id)
    job = await getStoredJob(job.id) || job
    states = cloneSlotStates(job.slotStates || initialSlotStates(job))
    const progress = summarizeSlotStates(job, states)

    if (progress.completedSlots === job.totalSlots) {
      job = await patchJob(job.id, { phase: "finalizing", ...progress }) || job
      await persistJobResultToWorkspace(job)
      const usedSlots = successfulNewSlotCount(job)
      await settleJobCreditsQuietly(job.id, usedSlots)
      const finishedAt = nowIso()
      const historyPatch = await persistTerminalHistory({
        job,
        status: "succeeded",
        finishedAt,
      })
      await patchJob(job.id, {
        status: "succeeded",
        phase: "finalizing",
        completedSlots: job.totalSlots,
        completedBatches: job.totalBatches,
        retryingSlots: 0,
        blockedSlots: 0,
        modelErrors: {},
        nextRetryAt: undefined,
        finishedAt,
        ...historyPatch,
      })
      return
    }

    const recoverableSlots = Object.values(states).filter(isRecoverableSlot)
    if (recoverableSlots.length === 0) {
      job = await patchJob(job.id, progress) || job
      await persistJobResultToWorkspace(job)
      const usedSlots = successfulNewSlotCount(job)
      await settleJobCreditsQuietly(job.id, usedSlots)
      const error = `仍有 ${progress.blockedSlots || 0} 个槽位在多轮独立联网补采后未达标。已保留 ${progress.completedSlots} 个完整结果，未达标槽位不计费、不进入渗透率统计。`
      const finishedAt = nowIso()
      const historyPatch = await persistTerminalHistory({
        job,
        status: "partial",
        error,
        finishedAt,
      })
      await patchJob(job.id, {
        status: "blocked",
        error,
        nextRetryAt: undefined,
        finishedAt,
        ...historyPatch,
      })
      return
    }

    const nowMs = Date.now()
    const batches: PenetrationBatch[] = PENETRATION_SCHEDULER_V3
      ? await selectPenetrationDueWaveV3({
          models: job.request.models,
          questions: job.request.questions,
          states,
          nowMs,
          rotationSeed: progress.totalAttempts || 0,
        })
      : PENETRATION_SCHEDULER_V2
        ? await selectPenetrationDueWave({
          models: job.request.models,
          questions: job.request.questions,
          states,
          nowMs,
          rotationSeed: progress.totalAttempts || 0,
        })
        : [selectDueBatch(job, states, nowMs)].filter(
            (batch): batch is PenetrationBatch => Boolean(batch),
          )
    if (batches.length === 0) {
      const hasDueSlots = Object.values(states).some(state => isDueSlot(state, nowMs))
      const capacityPollMs = Math.max(
        500,
        Math.min(
          5_000,
          Number(process.env.PENETRATION_V3_CAPACITY_POLL_MS) || 1_000,
        ),
      )
      const nextRetryAt = hasDueSlots
        ? new Date(Date.now() + capacityPollMs).toISOString()
        : progress.nextRetryAt || new Date(Date.now() + 2_000).toISOString()
      await patchJob(job.id, {
        ...progress,
        status: "running",
        nextRetryAt,
        queueReason: hasDueSlots ? "capacity" : "retry_wait",
      })
      scheduleResume(job.id, nextRetryAt)
      return
    }

    if (PENETRATION_SCHEDULER_V3 || PENETRATION_SCHEDULER_V2) {
      try {
        await processDueWave(job, batches)
      } finally {
        await releasePenetrationWaveReservations(batches)
      }
    } else {
      await persistPartialJobResult(await processDueBatch(job, batches[0]))
    }
    shouldRequeue = true
  } catch (error) {
    const current = await getStoredJob(jobId)
    if (current?.result) {
      await persistJobResultToWorkspace(current)
    }
    const usedSlots = successfulNewSlotCount(current)
    await settleJobCreditsQuietly(jobId, usedSlots)

    if (isCancelledError(error) || current?.status === "cancelled") {
      const finishedAt = current?.finishedAt || nowIso()
      const historyPatch = current
        ? await persistTerminalHistory({
            job: current,
            status: "cancelled",
            error: PENETRATION_JOB_CANCELLED_MESSAGE,
            finishedAt,
          })
        : { historySavePending: true }
      await patchJob(jobId, {
        status: "cancelled",
        error: PENETRATION_JOB_CANCELLED_MESSAGE,
        finishedAt,
        ...historyPatch,
      })
      return
    }

    console.error("[penetration-jobs] job failed:", jobId, error)
    const message = error instanceof Error ? error.message : "疑问句检测后台任务失败"
    const finishedAt = nowIso()
    const historyPatch = current
      ? await persistTerminalHistory({
          job: current,
          status: "failed",
          error: message,
          finishedAt,
        })
      : { historySavePending: true }
    await patchJob(jobId, {
      status: "failed",
      error: message,
      finishedAt,
      ...historyPatch,
    })
  } finally {
    if (ownsLease) {
      try {
        const currentLease = await kv.get<string>(jobLeaseKey(jobId))
        if (currentLease === leaseToken) await kv.del(jobLeaseKey(jobId))
      } catch (error) {
        console.warn("[penetration-jobs] failed to release job lease", jobId, error)
      }
    }
    releaseActiveJob(jobId)
    activeAbortControllers.delete(jobId)
    const latest = await getStoredJob(jobId)
    if (!latest || ["succeeded", "blocked", "failed", "cancelled"].includes(latest.status)) {
      await clearPendingJob(jobId)
    } else if (shouldRequeue) {
      queueJob(jobId)
    }
    requestSchedulerRun()
  }
}

export async function createPenetrationJob(args: {
  id?: string
  request: PenetrationJobRequest
  ownerUserId: string
  workspaceOwnerUserId?: string
  teamId?: string
  reservation: CreditReservation
  skipped: string[]
  baseResult?: PenetrationResult
}): Promise<PenetrationJobRecord> {
  const now = nowIso()
  const stored: StoredPenetrationJob = {
    id: args.id || `pjob_${randomUUID().replace(/-/g, "")}`,
    clientId: args.request.clientId,
    status: "queued",
    operation: args.request.operation,
    totalSlots: requestedSlotCount(args.request),
    completedSlots: 0,
    totalBatches: args.request.questions.length,
    completedBatches: 0,
    phase: "preflight",
    retryRound: 0,
    totalAttempts: 0,
    retryingSlots: 0,
    blockedSlots: 0,
    activeSlots: 0,
    queuedSlots: requestedSlotCount(args.request),
    waitingSlots: 0,
    schedulerVersion: PENETRATION_SCHEDULER_V3
      ? "v3"
      : PENETRATION_SCHEDULER_V2
        ? "v2"
        : "v1",
    skipped: args.skipped,
    modelErrors: {},
    createdAt: now,
    updatedAt: now,
    request: args.request,
    ownerUserId: args.ownerUserId,
    workspaceOwnerUserId: args.workspaceOwnerUserId || args.ownerUserId,
    teamId: args.teamId,
    reservedCredits: args.reservation.amount,
    creditReservation: args.reservation,
    batchBaseUrls: buildBatchBaseUrls(),
    baseResult: args.request.operation === "append" ? args.baseResult : undefined,
  }
  stored.slotStates = initialSlotStates(stored)
  Object.assign(stored, summarizeSlotStates(stored, stored.slotStates))

  await saveJob(stored)
  await markJobPending(stored.id)
  await dispatchPenetrationJob(stored.id)
  return toPublicJob(await getStoredJob(stored.id) || stored)
}

export async function getPenetrationJob(
  id: string,
  requesterUserId: string,
): Promise<PenetrationJobRecord | null> {
  const job = await getStoredJob(id)
  if (
    !job
    || (job.ownerUserId !== requesterUserId && job.workspaceOwnerUserId !== requesterUserId)
  ) return null

  const publicJob = toPublicJob(job)
  if (job.status === "queued" || job.status === "running") {
    if (durableTaskQueueEnabled("penetration")) {
      const dispatch = await inspectDurableTaskDispatch("penetration", job.id, {
        repairStaleClaim: true,
      })
      if (!dispatch.claimed || dispatch.staleClaim) {
        await dispatchPenetrationJob(job.id)
      }
      const queueSnapshot = await getDurableTaskQueueSnapshot("penetration")
      publicJob.queueDepth = queueSnapshot.active
        + queueSnapshot.waiting
        + queueSnapshot.delayed
      if (dispatch.queueState === "delayed") {
        publicJob.queueReason = "retry_wait"
      } else if (
        dispatch.queueState === "waiting"
        || dispatch.queueState === "prioritized"
        || dispatch.queueState === "missing"
      ) {
        publicJob.queueReason = "queued"
      } else if (dispatch.queueState === "active") {
        delete publicJob.queueReason
      }
    } else if (!activeJobs.has(job.id) && !resumeTimers.has(job.id)) {
      void dispatchPenetrationJob(job.id)
    }
  }
  if (
    ["succeeded", "blocked", "failed", "cancelled"].includes(job.status)
    && !job.historySavedAt
  ) {
    void retryTerminalHistory(job)
  }
  return publicJob
}

export async function runPenetrationJobFromWorker(
  id: string,
): Promise<TaskWorkerOutcome> {
  const initial = await getStoredJob(id)
  if (!initial || ["succeeded", "blocked", "failed", "cancelled"].includes(initial.status)) {
    if (initial) await clearPendingJob(initial.id)
    return {}
  }
  if (
    activeJobs.has(id)
    || activeOwnerCount(initial.ownerUserId) >= MAX_CONCURRENT_PENETRATION_JOBS_PER_USER
  ) {
    return { requeue: true, delayMs: 1_000 }
  }

  markJobActive(initial)
  await runJobSlice(id)

  const latest = await getStoredJob(id)
  if (!latest || ["succeeded", "blocked", "failed", "cancelled"].includes(latest.status)) {
    return {}
  }
  const states = latest.slotStates || initialSlotStates(latest)
  const hasDueSlots = Object.values(states).some(state =>
    isDueSlot(state, Date.now()),
  )
  const retryAtMs = latest.nextRetryAt ? Date.parse(latest.nextRetryAt) : 0
  return {
    requeue: true,
    delayMs:
      latest.queueReason === "capacity" && retryAtMs > Date.now()
        ? retryAtMs - Date.now()
        : hasDueSlots
          ? 0
          : retryAtMs > Date.now()
            ? retryAtMs - Date.now()
            : 0,
  }
}

export async function cancelPenetrationJob(
  id: string,
  requesterUserId: string,
): Promise<PenetrationJobRecord | null> {
  const job = await getStoredJob(id)
  if (
    !job
    || (job.ownerUserId !== requesterUserId && job.workspaceOwnerUserId !== requesterUserId)
  ) return null
  if (["succeeded", "blocked", "failed", "cancelled"].includes(job.status)) return toPublicJob(job)
  if (job.result && job.completedSlots >= job.totalSlots) {
    await persistJobResultToWorkspace(job)
    await settleJobCreditsQuietly(id, successfulNewSlotCount(job))
    const finishedAt = job.finishedAt || nowIso()
    const historyPatch = await persistTerminalHistory({
      job,
      status: "succeeded",
      finishedAt,
    })
    const succeeded = await patchJob(id, {
      status: "succeeded",
      completedSlots: job.totalSlots,
      completedBatches: job.totalBatches,
      finishedAt,
      ...historyPatch,
    }) || job
    return toPublicJob(succeeded)
  }

  const cancelled = await patchJob(id, {
    status: "cancelled",
    error: PENETRATION_JOB_CANCELLED_MESSAGE,
    finishedAt: nowIso(),
  }) || job
  if (cancelled.status !== "cancelled") {
    await clearTaskCancellation("penetration", id)
    return toPublicJob(cancelled)
  }
  await signalTaskCancellation("penetration", id, requesterUserId)

  activeAbortControllers.get(id)?.abort()
  activeAbortControllers.delete(id)
  clearResumeTimer(id)
  await clearPendingJob(id)
  if (queuedJobIds.delete(id)) {
    const index = queuedJobs.indexOf(id)
    if (index >= 0) queuedJobs.splice(index, 1)
  }
  await settleJobCreditsQuietly(id, successfulNewSlotCount(cancelled))
  const historyPatch = await persistTerminalHistory({
    job: cancelled,
    status: "cancelled",
    error: PENETRATION_JOB_CANCELLED_MESSAGE,
    finishedAt: cancelled.finishedAt || nowIso(),
  })
  const saved = await patchJob(id, {
    status: "cancelled",
    ...historyPatch,
  }) || cancelled
  return toPublicJob(saved)
}
