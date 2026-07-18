import "server-only"

import { randomUUID } from "crypto"
import { kv } from "@/lib/kv"
import { createInternalApiHeaders } from "@/lib/internal-api"
import { buildPenetrationBatchResult } from "@/lib/penetration/result-merge"
import {
  getPenetrationSlotValidationError,
  isCompletePenetrationItem,
  nextPenetrationRetryAt,
} from "@/lib/penetration/slot-policy"
import {
  formatPenetrationProviderError,
  isPermanentPenetrationProviderError,
} from "@/lib/penetration/provider-errors"
import { estimateFeatureCredits } from "@/lib/pricing"
import { settleReservedCredits, type CreditReservation } from "@/lib/with-credits"
import { mutateWorkspaceClientLatest } from "@/lib/workspace-store"
import {
  buildPenetrationHistoryRecord,
  savePenetrationHistoryRecord,
} from "@/lib/penetration/history-store"
import type {
  AnalysisSubjectType,
  ModelKey,
  PenetrationByModel,
  PenetrationHistoryStatus,
  PenetrationJobOperation,
  PenetrationJobRecord,
  PenetrationItem,
  PenetrationModelProgress,
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
  competitors: string[]
  selectedModels?: ModelKey[]
  models: ModelKey[]
}

type StoredPenetrationJob = PenetrationJobRecord & {
  request: PenetrationJobRequest
  ownerUserId: string
  workspaceOwnerUserId: string
  reservedCredits: number
  creditReservation?: CreditReservation
  batchBaseUrls: string[]
  baseResult?: PenetrationResult
  creditsSettledAt?: string
  slotStates?: Record<string, StoredPenetrationSlotState>
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
  lastError?: string
  nextRetryAt?: string
  updatedAt: string
}

type PenetrationBatch = {
  questions: string[]
  models: ModelKey[]
  sampleStart: number
}

type PenetrationBatchResponse = {
  error?: string
  byModel?: PenetrationByModel
  generatedAt?: string
  skipped?: string[]
  modelErrors?: Partial<Record<ModelKey, string>>
}

const PENETRATION_JOB_SLOT_BATCH_LIMIT = 6
const PENETRATION_JOB_BATCH_TIMEOUT_MS = 15 * 60 * 1000
const PENETRATION_JOB_MAX_BATCH_ATTEMPTS = 2
const PENETRATION_JOB_TTL_SECONDS = 60 * 60 * 24 * 7
const PENETRATION_JOB_CANCELLED_MESSAGE = "用户已停止检测"

const memoryJobs = new Map<string, StoredPenetrationJob>()
const activeJobs = new Set<string>()
const activeAbortControllers = new Map<string, AbortController>()
const settlingJobs = new Set<string>()
const historySavingJobs = new Set<string>()
const resumeTimers = new Map<string, ReturnType<typeof setTimeout>>()

const jobKey = (id: string) => `geo:penetration-jobs:${id}`

function nowIso(): string {
  return new Date().toISOString()
}

function toPublicJob(job: StoredPenetrationJob): PenetrationJobRecord {
  const publicJob: Partial<StoredPenetrationJob> = { ...job }
  delete publicJob.request
  delete publicJob.ownerUserId
  delete publicJob.workspaceOwnerUserId
  delete publicJob.reservedCredits
  delete publicJob.creditReservation
  delete publicJob.batchBaseUrls
  delete publicJob.baseResult
  delete publicJob.creditsSettledAt
  delete publicJob.slotStates
  return publicJob as PenetrationJobRecord
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
  for (const model of job.request.models) {
    const existing = job.result?.byModel[model] || []
    for (let questionIndex = 0; questionIndex < job.request.questions.length; questionIndex++) {
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

function isRecoverableSlot(state: StoredPenetrationSlotState): boolean {
  return state.status === "queued" || state.status === "running" || state.status === "retry_wait"
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
  | "modelProgress"
  | "modelErrors"
> {
  const values = Object.values(states)
  const completedSlots = values.filter(state => state.status === "success").length
  const retryingSlots = values.filter(isRecoverableSlot).length
  const blockedSlots = values.filter(state => state.status === "provider_blocked").length
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
      retrying: modelStates.filter(isRecoverableSlot).length,
      blocked: modelStates.filter(state => state.status === "provider_blocked").length,
      attempts: modelStates.reduce((sum, state) => sum + state.attempts, 0),
    }
    const latestError = modelStates
      .filter(state => state.status !== "success" && !!state.lastError)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.lastError
    if (latestError) modelErrors[model] = latestError
  }

  let completedBatches = 0
  for (let questionIndex = 0; questionIndex < job.request.questions.length; questionIndex++) {
    if (job.request.models.every(model => states[slotKey(model, questionIndex)]?.status === "success")) {
      completedBatches++
    }
  }

  const hasRetried = values.some(state => state.attempts > 1 || state.status === "retry_wait")
  const phase = completedSlots === job.totalSlots
    ? "finalizing"
    : totalAttempts === 0
      ? "preflight"
      : hasRetried
        ? "retrying"
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
  if (current.status === "cancelled" && patch.status && patch.status !== "cancelled") return current
  const next = { ...current, ...patch, updatedAt: nowIso() }
  await saveJob(next)
  return next
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
  clearResumeTimer(id)
  const delay = Math.max(250, Date.parse(atIso) - Date.now())
  const timer = setTimeout(() => {
    resumeTimers.delete(id)
    void runJob(id)
  }, delay)
  timer.unref?.()
  resumeTimers.set(id, timer)
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

async function persistJobResultToWorkspace(job: StoredPenetrationJob): Promise<void> {
  if (!job.result) return
  try {
    const saved = await mutateWorkspaceClientLatest({
      userId: job.workspaceOwnerUserId || job.ownerUserId,
      clientId: job.clientId,
      mutate: current => {
        if (current.penetrationJobId && current.penetrationJobId !== job.id) return null
        return {
          patch: { penetration: job.result },
          unsetFields: current.penetrationJobId === job.id ? ["penetrationJobId"] : [],
        }
      },
    })
    if (!saved) {
      console.warn("[penetration-jobs] workspace client not found", job.id, job.clientId)
    }
  } catch (error) {
    console.error("[penetration-jobs] workspace result persistence failed", job.id, error)
  }
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
        competitors: args.job.request.competitors,
        models: args.job.request.selectedModels || args.job.request.models,
        activeModels: args.job.request.models,
        skippedModels: args.job.skipped,
        operation: args.job.request.operation,
      },
      status: args.status,
      result: args.job.result,
      error: args.error,
      completedSlots: args.job.completedSlots,
      totalSlots: args.job.totalSlots,
      createdAt: args.job.createdAt,
      completedAt: args.finishedAt,
    })
    await savePenetrationHistoryRecord(
      args.job.workspaceOwnerUserId || args.job.ownerUserId,
      record,
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
        if (activeAbortControllers.get(job.id) === controller) {
          activeAbortControllers.delete(job.id)
        }
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("检测批次执行失败")
}

type PenetrationAttemptItem = PenetrationItem & { error?: string; judgeError?: string }

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
      const itemError = item?.error || data?.modelErrors?.[model] || batchError
      const validationError = itemError || getPenetrationSlotValidationError(item)

      if (!validationError && item) {
        item.webVerified = true
        state.status = "success"
        state.attempts = attempts
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
      state.attempts = attempts
      state.lastError = message
      state.updatedAt = completedAt

      if (isPermanentPenetrationProviderError(message)) {
        blockRemainingModelSlots(states, model, message, completedAt)
        continue
      }

      const retryAt = nextPenetrationRetryAt(attempts, Date.parse(completedAt))
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

async function runJob(jobId: string): Promise<void> {
  if (activeJobs.has(jobId)) return
  clearResumeTimer(jobId)
  activeJobs.add(jobId)

  try {
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
      slotStates: states,
      totalBatches: job.request.questions.length,
      ...summarizeSlotStates(job, states),
    }) || job

    while (true) {
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

      const batch = selectDueBatch(job, states, Date.now())
      if (!batch) {
        const nextRetryAt = progress.nextRetryAt || new Date(Date.now() + 2_000).toISOString()
        await patchJob(job.id, { ...progress, status: "running", nextRetryAt })
        scheduleResume(job.id, nextRetryAt)
        return
      }

      job = await processDueBatch(job, batch)
    }
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
    activeJobs.delete(jobId)
    activeAbortControllers.delete(jobId)
  }
}

export async function createPenetrationJob(args: {
  id?: string
  request: PenetrationJobRequest
  ownerUserId: string
  workspaceOwnerUserId?: string
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
    totalSlots: args.request.questions.length * args.request.models.length,
    completedSlots: 0,
    totalBatches: args.request.questions.length,
    completedBatches: 0,
    phase: "preflight",
    retryRound: 0,
    totalAttempts: 0,
    retryingSlots: args.request.questions.length * args.request.models.length,
    blockedSlots: 0,
    skipped: args.skipped,
    modelErrors: {},
    createdAt: now,
    updatedAt: now,
    request: args.request,
    ownerUserId: args.ownerUserId,
    workspaceOwnerUserId: args.workspaceOwnerUserId || args.ownerUserId,
    reservedCredits: args.reservation.amount,
    creditReservation: args.reservation,
    batchBaseUrls: buildBatchBaseUrls(),
    baseResult: args.request.operation === "append" ? args.baseResult : undefined,
  }
  stored.slotStates = initialSlotStates(stored)
  Object.assign(stored, summarizeSlotStates(stored, stored.slotStates))

  await saveJob(stored)
  void runJob(stored.id)
  return toPublicJob(stored)
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
  if (
    (job.status === "queued" || job.status === "running")
    && !activeJobs.has(job.id)
    && !resumeTimers.has(job.id)
  ) {
    void runJob(job.id)
  }
  if (
    ["succeeded", "blocked", "failed", "cancelled"].includes(job.status)
    && !job.historySavedAt
  ) {
    void retryTerminalHistory(job)
  }
  return toPublicJob(job)
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

  const usedSlots = successfulNewSlotCount(job)
  await settleJobCreditsQuietly(id, usedSlots)
  const cancelled = await patchJob(id, {
    status: "cancelled",
    error: PENETRATION_JOB_CANCELLED_MESSAGE,
    finishedAt: nowIso(),
  }) || job

  activeAbortControllers.get(id)?.abort()
  activeAbortControllers.delete(id)
  clearResumeTimer(id)
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
