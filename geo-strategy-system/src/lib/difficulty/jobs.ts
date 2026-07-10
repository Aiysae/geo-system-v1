import "server-only"

import { randomUUID } from "crypto"
import {
  applyDifficultyStageResult,
  createDifficultyStageContext,
  difficultyStagesForMode,
  executeDifficultyStage,
  finalizeDifficultyAssessment,
  type DifficultyAssessmentInput,
  type DifficultyStageContext,
} from "@/lib/difficulty/assessment"
import { kv } from "@/lib/kv"
import { MODEL_LABELS } from "@/lib/llm"
import {
  refundReservedCredits,
  settleReservedCredits,
  type CreditReservation,
} from "@/lib/with-credits"
import type {
  DifficultyJobRecord,
  DifficultyModelSelection,
  DifficultyStageKey,
  ModelKey,
} from "@/types"

type StoredDifficultyJob = DifficultyJobRecord & {
  ownerUserId: string
  request: DifficultyAssessmentInput
  context: DifficultyStageContext
  modelCandidates: ModelKey[]
  disabledModels: ModelKey[]
  reservation: CreditReservation
  stageResults: Partial<Record<DifficultyStageKey, Record<string, unknown>>>
  finalParsed?: Record<string, unknown>
  creditsSettledAt?: string
}

const JOB_TTL_SECONDS = 60 * 60 * 24 * 7
const JOB_CANCELLED_MESSAGE = "用户已停止测评"
const MAX_MODEL_ATTEMPTS = 2
const MAX_CONCURRENT_JOBS = Math.max(
  1,
  Math.min(4, Math.floor(Number(process.env.DIFFICULTY_JOB_CONCURRENCY) || 2)),
)

const memoryJobs = new Map<string, StoredDifficultyJob>()
const activeJobs = new Set<string>()
const scheduledJobs = new Set<string>()
const pendingJobs: string[] = []
const settlingJobs = new Set<string>()

const jobKey = (id: string) => `geo:difficulty-jobs:${id}`

function nowIso(): string {
  return new Date().toISOString()
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function retryDelayMs(attempt: number): number {
  const configured = Number(process.env.DIFFICULTY_JOB_RETRY_DELAY_MS)
  if (Number.isFinite(configured) && configured >= 0) return configured
  return attempt <= 1 ? 1500 : 4000
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "未知错误")
  return message.replace(/sk-[A-Za-z0-9_.*-]{6,}/g, "sk-***").replace(/\s+/g, " ").slice(0, 500)
}

export function isRetryableDifficultyError(error: unknown): boolean {
  return /(429|rate.?limit|too many|busy|overload|任务量过大|请求过大|timeout|timed out|超时|ECONN|fetch failed|network|502|503|504|JSON|解析)/i.test(
    safeError(error),
  )
}

function toPublicJob(job: StoredDifficultyJob): DifficultyJobRecord {
  const publicJob: Partial<StoredDifficultyJob> = { ...job }
  delete publicJob.ownerUserId
  delete publicJob.request
  delete publicJob.context
  delete publicJob.modelCandidates
  delete publicJob.disabledModels
  delete publicJob.reservation
  delete publicJob.stageResults
  delete publicJob.finalParsed
  delete publicJob.creditsSettledAt
  return publicJob as DifficultyJobRecord
}

async function saveJob(job: StoredDifficultyJob): Promise<void> {
  memoryJobs.set(job.id, job)
  await kv.set(jobKey(job.id), job, { ex: JOB_TTL_SECONDS })
}

async function getStoredJob(id: string): Promise<StoredDifficultyJob | null> {
  const memory = memoryJobs.get(id)
  try {
    const stored = await kv.get<StoredDifficultyJob>(jobKey(id))
    if (stored) {
      memoryJobs.set(id, stored)
      return stored
    }
  } catch (error) {
    console.warn("[difficulty-jobs] KV read failed, using memory fallback:", safeError(error))
  }
  return memory || null
}

async function patchJob(
  id: string,
  patch: Partial<StoredDifficultyJob>,
): Promise<StoredDifficultyJob | null> {
  const current = await getStoredJob(id)
  if (!current) return null
  if (current.status === "cancelled" && patch.status && patch.status !== "cancelled") return current
  const next = { ...current, ...patch, updatedAt: nowIso() }
  await saveJob(next)
  return next
}

class DifficultyJobCancelledError extends Error {
  constructor() {
    super(JOB_CANCELLED_MESSAGE)
    this.name = "DifficultyJobCancelledError"
  }
}

function isCancelledError(error: unknown): boolean {
  return error instanceof DifficultyJobCancelledError
    || (error instanceof Error && error.name === "DifficultyJobCancelledError")
}

async function assertNotCancelled(id: string): Promise<void> {
  const current = await getStoredJob(id)
  if (current?.status === "cancelled") throw new DifficultyJobCancelledError()
}

async function settleSuccessfulJob(id: string): Promise<void> {
  if (settlingJobs.has(id)) return
  settlingJobs.add(id)
  try {
    const job = await getStoredJob(id)
    if (!job || job.creditsSettledAt) return
    await settleReservedCredits(job.reservation, job.reservation.amount)
    await patchJob(id, { creditsSettledAt: nowIso(), creditsRefunded: false })
  } finally {
    settlingJobs.delete(id)
  }
}

async function refundJob(id: string): Promise<void> {
  if (settlingJobs.has(id)) return
  settlingJobs.add(id)
  try {
    const job = await getStoredJob(id)
    if (!job || job.creditsSettledAt) return
    await refundReservedCredits(job.reservation)
    await patchJob(id, { creditsSettledAt: nowIso(), creditsRefunded: true })
  } catch (error) {
    console.error("[difficulty-jobs] credit refund failed", id, safeError(error))
  } finally {
    settlingJobs.delete(id)
  }
}

async function runStageWithFallback(
  jobId: string,
  stageKey: DifficultyStageKey,
): Promise<{ parsed: Record<string, unknown>; model: ModelKey }> {
  let lastError: unknown

  const initial = await getStoredJob(jobId)
  if (!initial) throw new Error("测评任务不存在或已过期")

  const candidates = initial.modelCandidates.filter(model => !(initial.disabledModels || []).includes(model))
  for (const model of candidates) {
    for (let attempt = 1; attempt <= MAX_MODEL_ATTEMPTS; attempt++) {
      await assertNotCancelled(jobId)
      const current = await getStoredJob(jobId)
      if (!current) throw new Error("测评任务不存在或已过期")
      await patchJob(jobId, {
        currentModel: model,
        attempts: current.attempts + 1,
      })

      try {
        const parsed = await executeDifficultyStage({
          stageKey,
          context: current.context,
          model,
        })
        await assertNotCancelled(jobId)
        return { parsed, model }
      } catch (error) {
        if (isCancelledError(error)) throw error
        lastError = error
        const latest = await getStoredJob(jobId)
        const modelErrors = { ...(latest?.modelErrors || {}) }
        modelErrors[model] = safeError(error)
        await patchJob(jobId, { modelErrors })

        const retryable = isRetryableDifficultyError(error)
        if (!retryable) {
          const disabledModels = Array.from(new Set([...(latest?.disabledModels || []), model]))
          await patchJob(jobId, { disabledModels })
          break
        }
        if (attempt >= MAX_MODEL_ATTEMPTS) break
        await sleep(retryDelayMs(attempt))
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("所有已配置模型均未完成当前阶段")
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

    const stages = difficultyStagesForMode(job.mode)
    for (let index = job.completedStages; index < stages.length; index++) {
      await assertNotCancelled(job.id)
      const stage = stages[index]
      job = await patchJob(job.id, {
        currentStage: stage.key,
        progressPercent: Math.round(index / stages.length * 100),
      }) || job

      const { parsed, model } = await runStageWithFallback(job.id, stage.key)
      await assertNotCancelled(job.id)
      job = await getStoredJob(job.id) || job

      const context: DifficultyStageContext = structuredClone(job.context)
      applyDifficultyStageResult(stage.key, parsed, context)
      const stageResults: Partial<Record<DifficultyStageKey, Record<string, unknown>>> = {
        ...job.stageResults,
        [stage.key]: parsed,
      }
      const stageModels: Partial<Record<DifficultyStageKey, ModelKey>> = {
        ...job.stageModels,
        [stage.key]: model,
      }
      job = await patchJob(job.id, {
        context,
        stageResults,
        stageModels,
        finalParsed: stage.key === "report" ? parsed : job.finalParsed,
        completedStages: index + 1,
        progressPercent: Math.round((index + 1) / stages.length * 100),
      }) || job
    }

    if (!job.finalParsed) throw new Error("多阶段评估未生成最终报告")
    const usedModels = Array.from(new Set(Object.values(job.stageModels)))
    const providerLabel = usedModels.map(model => MODEL_LABELS[model]).join(" → ")
    const result = finalizeDifficultyAssessment(job.finalParsed, job.context, providerLabel)

    await patchJob(job.id, {
      result,
      progressPercent: 100,
      currentStage: undefined,
      currentModel: undefined,
    })
    await settleSuccessfulJob(job.id)
    await patchJob(job.id, {
      status: "succeeded",
      finishedAt: nowIso(),
    })
  } catch (error) {
    const current = await getStoredJob(jobId)
    if (isCancelledError(error) || current?.status === "cancelled") {
      await patchJob(jobId, {
        status: "cancelled",
        error: JOB_CANCELLED_MESSAGE,
        finishedAt: current?.finishedAt || nowIso(),
      })
      await refundJob(jobId)
      return
    }

    console.error("[difficulty-jobs] job failed", jobId, safeError(error))
    await patchJob(jobId, {
      status: "failed",
      error: safeError(error),
      finishedAt: nowIso(),
    })
    await refundJob(jobId)
  } finally {
    activeJobs.delete(jobId)
  }
}

function drainQueue(): void {
  while (activeJobs.size < MAX_CONCURRENT_JOBS && pendingJobs.length > 0) {
    const jobId = pendingJobs.shift()
    if (!jobId) break
    scheduledJobs.delete(jobId)
    void runJob(jobId).finally(drainQueue)
  }
}

function scheduleJob(id: string): void {
  if (activeJobs.has(id) || scheduledJobs.has(id)) return
  scheduledJobs.add(id)
  pendingJobs.push(id)
  queueMicrotask(drainQueue)
}

export async function createDifficultyJob(args: {
  id: string
  clientId: string
  request: DifficultyAssessmentInput
  requestedModel: DifficultyModelSelection
  modelCandidates: ModelKey[]
  ownerUserId: string
  reservation: CreditReservation
}): Promise<DifficultyJobRecord> {
  const now = nowIso()
  const stored: StoredDifficultyJob = {
    id: args.id,
    clientId: args.clientId,
    status: "queued",
    mode: args.request.mode,
    industry: args.request.industry,
    city: args.request.city,
    targetBrand: args.request.targetBrand,
    website: args.request.website,
    requestedModel: args.requestedModel,
    completedStages: 0,
    totalStages: difficultyStagesForMode(args.request.mode).length,
    progressPercent: 0,
    attempts: 0,
    stageModels: {},
    modelErrors: {},
    createdAt: now,
    updatedAt: now,
    ownerUserId: args.ownerUserId,
    request: args.request,
    context: createDifficultyStageContext(args.request),
    modelCandidates: args.modelCandidates,
    disabledModels: [],
    reservation: args.reservation,
    stageResults: {},
  }

  await saveJob(stored)
  scheduleJob(stored.id)
  return toPublicJob(stored)
}

export function createDifficultyJobId(): string {
  return `djob_${randomUUID().replace(/-/g, "")}`
}

export async function getDifficultyJob(
  id: string,
  ownerUserId: string,
): Promise<DifficultyJobRecord | null> {
  const job = await getStoredJob(id)
  if (!job || job.ownerUserId !== ownerUserId) return null
  if ((job.status === "queued" || job.status === "running") && !activeJobs.has(id)) scheduleJob(id)
  if ((job.status === "failed" || job.status === "cancelled") && !job.creditsSettledAt) {
    await refundJob(id)
  }
  return toPublicJob(await getStoredJob(id) || job)
}

export async function cancelDifficultyJob(
  id: string,
  ownerUserId: string,
): Promise<DifficultyJobRecord | null> {
  const job = await getStoredJob(id)
  if (!job || job.ownerUserId !== ownerUserId) return null
  if (["succeeded", "failed", "cancelled"].includes(job.status)) {
    if ((job.status === "failed" || job.status === "cancelled") && !job.creditsSettledAt) {
      await refundJob(id)
    }
    return toPublicJob(await getStoredJob(id) || job)
  }

  // 最终报告已经持久化时，任务实质完成；避免完成与取消在结算窗口内相互覆盖。
  if (job.result) {
    await settleSuccessfulJob(id)
    const succeeded = await patchJob(id, {
      status: "succeeded",
      progressPercent: 100,
      finishedAt: job.finishedAt || nowIso(),
    }) || job
    return toPublicJob(await getStoredJob(id) || succeeded)
  }

  const cancelled = await patchJob(id, {
    status: "cancelled",
    error: JOB_CANCELLED_MESSAGE,
    finishedAt: nowIso(),
  }) || job
  await refundJob(id)
  return toPublicJob(await getStoredJob(id) || cancelled)
}
