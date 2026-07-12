import "server-only"

import { randomUUID } from "crypto"
import { kv } from "@/lib/kv"
import { createInternalApiHeaders } from "@/lib/internal-api"
import { aggregatePenetration } from "@/lib/score-utils"
import { estimateFeatureCredits } from "@/lib/pricing"
import { settleReservedCredits, type CreditReservation } from "@/lib/with-credits"
import { mutateWorkspaceClientLatest } from "@/lib/workspace-store"
import type {
  ModelKey,
  PenetrationByModel,
  PenetrationItem,
  PenetrationJobRecord,
  PenetrationResult,
} from "@/types"

export interface PenetrationJobRequest {
  clientId: string
  ourBrand: string
  brandAliases: string[]
  industry: string
  questions: string[]
  competitors: string[]
  models: ModelKey[]
}

type StoredPenetrationJob = PenetrationJobRecord & {
  request: PenetrationJobRequest
  ownerUserId: string
  reservedCredits: number
  batchBaseUrls: string[]
  creditsSettledAt?: string
}

type PenetrationBatch = {
  questions: string[]
  models: ModelKey[]
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

const jobKey = (id: string) => `geo:penetration-jobs:${id}`

function nowIso(): string {
  return new Date().toISOString()
}

function toPublicJob(job: StoredPenetrationJob): PenetrationJobRecord {
  const publicJob: Partial<StoredPenetrationJob> = { ...job }
  delete publicJob.request
  delete publicJob.ownerUserId
  delete publicJob.reservedCredits
  delete publicJob.batchBaseUrls
  delete publicJob.creditsSettledAt
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

function buildBatches(questions: string[], models: ModelKey[]): PenetrationBatch[] {
  const questionBatchSize = Math.max(
    1,
    Math.floor(PENETRATION_JOB_SLOT_BATCH_LIMIT / Math.max(1, models.length)),
  )
  const batches: PenetrationBatch[] = []
  for (let start = 0; start < questions.length; start += questionBatchSize) {
    batches.push({
      questions: questions.slice(start, start + questionBatchSize),
      models,
    })
  }
  return batches
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
  if (current.status === "cancelled" && patch.status !== "cancelled") return current
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

function mergeStrings(current: string[], incoming: string[]): string[] {
  return Array.from(new Set([...current, ...incoming].map(item => item.trim()).filter(Boolean)))
}

function mergeModelErrors(
  current: Partial<Record<ModelKey, string>>,
  incoming: Partial<Record<ModelKey, string>>,
): Partial<Record<ModelKey, string>> {
  const merged = { ...current }
  for (const [model, message] of Object.entries(incoming) as Array<[ModelKey, string]>) {
    if (!message) continue
    merged[model] = merged[model] && merged[model] !== message
      ? `${merged[model]}；${message}`
      : message
  }
  return merged
}

function mergeByModel(
  current: PenetrationByModel,
  incoming: PenetrationByModel,
): PenetrationByModel {
  const merged: PenetrationByModel = {}
  for (const [model, items] of Object.entries(current) as Array<[ModelKey, PenetrationItem[] | undefined]>) {
    if (items?.length) merged[model] = [...items]
  }
  for (const [model, items] of Object.entries(incoming) as Array<[ModelKey, PenetrationItem[] | undefined]>) {
    if (!items?.length) continue
    merged[model] = [...(merged[model] || []), ...items]
  }
  return merged
}

function successfulSlotCount(byModel: PenetrationByModel | undefined): number {
  if (!byModel) return 0
  return Object.values(byModel).reduce((total, items) => {
    return total + (items || []).filter(item => item.answer.trim().length > 0).length
  }, 0)
}

async function settleJobCredits(id: string, usedSlots: number): Promise<void> {
  if (settlingJobs.has(id)) return
  settlingJobs.add(id)
  try {
    const job = await getStoredJob(id)
    if (!job || job.creditsSettledAt) return
    const reservation: CreditReservation = {
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
      userId: job.ownerUserId,
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

async function runJob(jobId: string): Promise<void> {
  if (activeJobs.has(jobId)) return
  activeJobs.add(jobId)

  try {
    let job = await getStoredJob(jobId)
    if (!job) return
    if (["succeeded", "failed", "cancelled"].includes(job.status)) return

    job = await patchJob(job.id, {
      status: "running",
      startedAt: job.startedAt || nowIso(),
      error: undefined,
    }) || job

    const batches = buildBatches(job.request.questions, job.request.models)
    for (let index = job.completedBatches; index < batches.length; index++) {
      await assertNotCancelled(job.id)
      const data = await fetchBatch(job, batches[index])
      job = await getStoredJob(job.id) || job

      const byModel = mergeByModel(job.result?.byModel || {}, data.byModel || {})
      const generatedAt = data.generatedAt || nowIso()
      const result: PenetrationResult = {
        byModel,
        aggregated: aggregatePenetration(
          byModel,
          job.request.ourBrand,
          job.request.brandAliases,
          job.request.competitors,
        ),
        generatedAt,
      }

      job = await patchJob(job.id, {
        result,
        completedBatches: index + 1,
        completedSlots: Math.min(
          job.totalSlots,
          job.completedSlots + batches[index].questions.length * batches[index].models.length,
        ),
        skipped: mergeStrings(job.skipped, data.skipped || []),
        modelErrors: mergeModelErrors(job.modelErrors, data.modelErrors || {}),
      }) || job
    }

    await persistJobResultToWorkspace(job)
    const usedSlots = successfulSlotCount(job.result?.byModel)
    await settleJobCreditsQuietly(job.id, usedSlots)
    await patchJob(job.id, {
      status: "succeeded",
      completedSlots: job.totalSlots,
      completedBatches: job.totalBatches,
      finishedAt: nowIso(),
    })
  } catch (error) {
    const current = await getStoredJob(jobId)
    const usedSlots = successfulSlotCount(current?.result?.byModel)
    await settleJobCreditsQuietly(jobId, usedSlots)

    if (isCancelledError(error) || current?.status === "cancelled") {
      await patchJob(jobId, {
        status: "cancelled",
        error: PENETRATION_JOB_CANCELLED_MESSAGE,
        finishedAt: nowIso(),
      })
      return
    }

    console.error("[penetration-jobs] job failed:", jobId, error)
    await patchJob(jobId, {
      status: "failed",
      error: error instanceof Error ? error.message : "疑问句检测后台任务失败",
      finishedAt: nowIso(),
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
  reservation: CreditReservation
  skipped: string[]
}): Promise<PenetrationJobRecord> {
  const batches = buildBatches(args.request.questions, args.request.models)
  const now = nowIso()
  const stored: StoredPenetrationJob = {
    id: args.id || `pjob_${randomUUID().replace(/-/g, "")}`,
    clientId: args.request.clientId,
    status: "queued",
    totalSlots: args.request.questions.length * args.request.models.length,
    completedSlots: 0,
    totalBatches: batches.length,
    completedBatches: 0,
    skipped: args.skipped,
    modelErrors: {},
    createdAt: now,
    updatedAt: now,
    request: args.request,
    ownerUserId: args.ownerUserId,
    reservedCredits: args.reservation.amount,
    batchBaseUrls: buildBatchBaseUrls(),
  }

  await saveJob(stored)
  void runJob(stored.id)
  return toPublicJob(stored)
}

export async function getPenetrationJob(
  id: string,
  ownerUserId: string,
): Promise<PenetrationJobRecord | null> {
  const job = await getStoredJob(id)
  if (!job || job.ownerUserId !== ownerUserId) return null
  if ((job.status === "queued" || job.status === "running") && !activeJobs.has(job.id)) {
    void runJob(job.id)
  }
  return toPublicJob(job)
}

export async function cancelPenetrationJob(
  id: string,
  ownerUserId: string,
): Promise<PenetrationJobRecord | null> {
  const job = await getStoredJob(id)
  if (!job || job.ownerUserId !== ownerUserId) return null
  if (["succeeded", "failed", "cancelled"].includes(job.status)) return toPublicJob(job)

  const usedSlots = successfulSlotCount(job.result?.byModel)
  await settleJobCreditsQuietly(id, usedSlots)
  const cancelled = await patchJob(id, {
    status: "cancelled",
    error: PENETRATION_JOB_CANCELLED_MESSAGE,
    finishedAt: nowIso(),
  }) || job

  activeAbortControllers.get(id)?.abort()
  activeAbortControllers.delete(id)
  return toPublicJob(cancelled)
}
