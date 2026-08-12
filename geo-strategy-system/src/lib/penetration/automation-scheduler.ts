import "server-only"

import { createHash, randomUUID } from "crypto"
import { Job, Queue, Worker, type ConnectionOptions } from "bullmq"
import { getUserById } from "@/lib/auth"
import { ADAPTERS } from "@/lib/llm"
import { kv } from "@/lib/kv"
import {
  durableTaskQueueConnection,
  durableTaskQueueName,
} from "@/lib/task-queue"
import {
  buildPenetrationComparisonSignature,
  comparePenetrationAutomationResult,
} from "@/lib/penetration/automation-comparison"
import { sendPenetrationAutomationAlertEmail } from "@/lib/penetration/automation-email"
import {
  claimDuePenetrationAutomationExecutions,
  getPenetrationAutomationExecution,
  getPenetrationAutomationSchedule,
  listActionablePenetrationAutomationExecutions,
  patchPenetrationAutomationExecution,
  recordPenetrationAutomationScheduleProgress,
  sumPenetrationAutomationCredits,
} from "@/lib/penetration/automation-store"
import { shanghaiMonthRange } from "@/lib/penetration/automation-time"
import type {
  PenetrationAutomationExecution,
  PenetrationAutomationInputSnapshot,
  PenetrationAutomationSchedule,
} from "@/lib/penetration/automation-types"
import {
  PenetrationJobSubmissionError,
  submitPenetrationJob,
} from "@/lib/penetration/job-creation"
import { getPenetrationJob } from "@/lib/penetration/jobs"
import { getPenetrationModelReadiness } from "@/lib/penetration/model-readiness"
import {
  getPenetrationHistoryRecord,
  listPenetrationHistoryComparisonRecords,
} from "@/lib/penetration/history-store"
import { estimateFeatureCredits } from "@/lib/pricing"
import {
  notifyPenetrationAutomationAlert,
  notifyPenetrationAutomationAttention,
} from "@/lib/user-notifications"
import { listWorkspaceClients } from "@/lib/workspace-store"
import type { Client, ModelKey, PenetrationHistoryRequestSnapshot } from "@/types"

type AutomationQueuePayload =
  | { kind: "sweep" }
  | { kind: "execution"; ownerUserId: string; executionId: string }

const SCHEDULER_ID = "geo-penetration-automation-minute-v1"
const SWEEP_JOB_NAME = "penetration-automation-sweep"
const EXECUTION_JOB_NAME = "penetration-automation-execution"
const EXECUTION_LOCK_SECONDS = 4 * 60
const MAX_SUBMISSION_ATTEMPTS = 4

type SchedulerGlobal = typeof globalThis & {
  __geoPenetrationAutomationQueue?: Queue<AutomationQueuePayload>
}

const schedulerGlobal = globalThis as SchedulerGlobal

export function penetrationAutomationQueueName(): string {
  return `${durableTaskQueueName()}-penetration-automation`
}

export function penetrationAutomationSchedule(): { pattern: string; timezone: string } {
  return {
    pattern: String(process.env.PENETRATION_AUTOMATION_CRON || "* * * * *").trim(),
    timezone: "Asia/Shanghai",
  }
}

function queueConnection(): ConnectionOptions {
  return durableTaskQueueConnection()
}

function automationQueue(): Queue<AutomationQueuePayload> {
  if (schedulerGlobal.__geoPenetrationAutomationQueue) {
    return schedulerGlobal.__geoPenetrationAutomationQueue
  }
  const queue = new Queue<AutomationQueuePayload>(penetrationAutomationQueueName(), {
    connection: queueConnection(),
    prefix: String(process.env.TASK_QUEUE_PREFIX || "geo:bull"),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { age: 60 * 60 * 24 * 3, count: 5_000 },
      removeOnFail: { age: 60 * 60 * 24 * 14, count: 5_000 },
    },
  })
  queue.on("error", error => {
    console.error("[penetration-automation] queue error", error.message)
  })
  schedulerGlobal.__geoPenetrationAutomationQueue = queue
  return queue
}

function minuteJobId(now = new Date()): string {
  return `penetration-automation-sweep-${now.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
}

function executionJobId(ownerUserId: string, executionId: string): string {
  const digest = createHash("sha256")
    .update(`${ownerUserId}\u0000${executionId}`)
    .digest("hex")
    .slice(0, 32)
  return `penetration-automation-execution-${digest}`
}

function executionLockKey(ownerUserId: string, executionId: string): string {
  return `geo:penetration-automation:execution-lock:${createHash("sha256")
    .update(`${ownerUserId}\u0000${executionId}`)
    .digest("hex")}`
}

function retryAt(attempt: number): string {
  const delays = [60_000, 3 * 60_000, 10 * 60_000, 30 * 60_000]
  return new Date(Date.now() + delays[Math.min(attempt, delays.length - 1)]).toISOString()
}

function activeJobStatus(status: string): boolean {
  return status === "queued" || status === "running"
}

function terminalExecutionStatus(status: string): boolean {
  return ["succeeded", "partial", "failed", "skipped", "cancelled"].includes(status)
}

function modelList(value: unknown): ModelKey[] {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map(item => String(item).trim())
      .filter((model): model is ModelKey => model in ADAPTERS),
  ))
}

function questionList(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .map(item => String(item).trim())
    .filter(Boolean)
}

async function currentClient(schedule: PenetrationAutomationSchedule): Promise<Client | null> {
  return (await listWorkspaceClients(schedule.ownerUserId))
    .find(item => item.client.id === schedule.clientId)?.client || null
}

async function estimateScheduledCredits(schedule: PenetrationAutomationSchedule): Promise<number> {
  const client = await currentClient(schedule)
  if (!client) return 0
  const questions = questionList(client.questions)
  const requestedModels = modelList(client.selectedModels)
  const readiness = await Promise.all(requestedModels.map(getPenetrationModelReadiness))
  const activeModelCount = readiness.filter(item => item.ready).length
  return estimateFeatureCredits("penetrationSlot", questions.length * activeModelCount)
}

function buildInputSnapshot(input: {
  client: Client
  schedule: PenetrationAutomationSchedule
  request: {
    subjectType: PenetrationHistoryRequestSnapshot["subjectType"]
    personProfile?: PenetrationHistoryRequestSnapshot["personProfile"]
    ourBrand: string
    brandAliases: string[]
    industry: string
    website?: string
    competitors: string[]
    questions: string[]
    questionIntents?: PenetrationHistoryRequestSnapshot["questionIntents"]
    selectedModels?: ModelKey[]
    models: ModelKey[]
  }
  estimatedCredits: number
  slotCount: number
}): PenetrationAutomationInputSnapshot {
  const comparisonRequest: PenetrationHistoryRequestSnapshot = {
    clientId: input.client.id,
    clientName: input.client.name,
    subjectType: input.request.subjectType,
    personProfile: input.request.personProfile,
    ourBrand: input.request.ourBrand,
    brandAliases: input.request.brandAliases,
    industry: input.request.industry,
    website: input.request.website || input.client.website || "",
    questions: input.request.questions,
    questionIntents: input.request.questionIntents,
    competitors: input.request.competitors,
    models: input.request.selectedModels || input.request.models,
    activeModels: input.request.models,
    skippedModels: [],
    operation: "replace",
  }
  return {
    subjectType: input.request.subjectType || "brand",
    personProfile: input.request.personProfile,
    ourBrand: input.request.ourBrand,
    brandAliases: input.request.brandAliases,
    industry: input.request.industry,
    website: input.request.website || input.client.website,
    competitors: input.request.competitors,
    questions: input.request.questions,
    questionIntents: input.request.questionIntents || [],
    requestedModels: input.request.selectedModels || input.request.models,
    activeModels: input.request.models,
    questionCount: input.request.questions.length,
    modelCount: input.request.models.length,
    slotCount: input.slotCount,
    estimatedCredits: input.estimatedCredits,
    comparisonSignature: buildPenetrationComparisonSignature(comparisonRequest),
    relativeDropThresholdPct: input.schedule.relativeDropThresholdPct,
    minimumAbsoluteDropPoints: input.schedule.minimumAbsoluteDropPoints,
  }
}

async function notifyAttention(
  schedule: PenetrationAutomationSchedule,
  execution: PenetrationAutomationExecution,
  message: string,
): Promise<void> {
  if (!schedule.inAppEnabled) return
  await notifyPenetrationAutomationAttention({
    userId: schedule.actorUserId,
    executionId: execution.id,
    clientId: schedule.clientId,
    clientName: schedule.clientName,
    message,
  })
}

async function finishSkipped(
  schedule: PenetrationAutomationSchedule,
  execution: PenetrationAutomationExecution,
  message: string,
): Promise<void> {
  const completedAt = new Date().toISOString()
  const saved = await patchPenetrationAutomationExecution({
    ownerUserId: execution.ownerUserId,
    id: execution.id,
    patch: {
      status: "skipped",
      error: message,
      completedAt,
      nextAttemptAt: undefined,
    },
  })
  if (!saved) return
  await recordPenetrationAutomationScheduleProgress({
    schedule,
    execution: saved,
    outcome: "skipped",
    error: message,
  })
  await notifyAttention(schedule, saved, message)
}

function skipSubmissionError(error: unknown): boolean {
  if (!(error instanceof PenetrationJobSubmissionError)) return false
  return [
    "INSUFFICIENT_CREDITS",
    "CLIENT_ACCOUNT_READ_ONLY",
    "PENETRATION_NO_SAVED_QUESTIONS",
    "PENETRATION_NO_SAVED_MODELS",
    "PENETRATION_NO_READY_MODELS",
  ].includes(error.name)
}

async function submitExecution(
  schedule: PenetrationAutomationSchedule,
  execution: PenetrationAutomationExecution,
): Promise<PenetrationAutomationExecution | null> {
  if (execution.trigger === "scheduled" && schedule.status !== "active") {
    return await patchPenetrationAutomationExecution({
      ownerUserId: execution.ownerUserId,
      id: execution.id,
      patch: {
        status: "cancelled",
        completedAt: new Date().toISOString(),
        error: "自动检测计划已暂停",
      },
    })
  }

  if (schedule.monthlyCreditLimit) {
    const [estimate, range] = await Promise.all([
      estimateScheduledCredits(schedule),
      Promise.resolve(shanghaiMonthRange()),
    ])
    const used = await sumPenetrationAutomationCredits({
      ownerUserId: schedule.ownerUserId,
      scheduleId: schedule.id,
      start: range.start,
      end: range.end,
    })
    if (estimate <= 0) {
      await finishSkipped(schedule, execution, "未找到可执行的已保存疑问句或联网模型，请完善检测配置")
      return null
    }
    if (used + estimate > schedule.monthlyCreditLimit) {
      await finishSkipped(
        schedule,
        execution,
        `本月自动检测预计将超过 ${schedule.monthlyCreditLimit} 积分上限，本次未执行`,
      )
      return null
    }
  }

  try {
    const result = await submitPenetrationJob({
      actorUserId: schedule.actorUserId,
      clientId: schedule.clientId,
      teamId: schedule.teamId,
      requestId: `pauto_${execution.id}`,
      operation: "replace",
      useSavedInputs: true,
      origin: "automation",
      automationScheduleId: schedule.id,
      automationExecutionId: execution.id,
      automationTrigger: execution.trigger,
    })
    const snapshot = result.request.clientId
      ? buildInputSnapshot({
          client: result.client,
          schedule,
          request: result.request,
          estimatedCredits: result.estimatedCredits,
          slotCount: result.slotCount,
        })
      : execution.inputSnapshot
    const saved = await patchPenetrationAutomationExecution({
      ownerUserId: execution.ownerUserId,
      id: execution.id,
      patch: {
        status: activeJobStatus(result.job.status) ? "submitted" : "running",
        attemptCount: execution.attemptCount + 1,
        jobId: result.job.id,
        inputSnapshot: snapshot,
        estimatedCredits: result.estimatedCredits,
        startedAt: execution.startedAt || new Date().toISOString(),
        nextAttemptAt: new Date(Date.now() + 20_000).toISOString(),
        error: undefined,
      },
    })
    if (saved) {
      await recordPenetrationAutomationScheduleProgress({
        schedule,
        execution: saved,
        outcome: "started",
      })
    }
    return saved
  } catch (error) {
    if (error instanceof PenetrationJobSubmissionError && error.name === "PENETRATION_CLIENT_BUSY") {
      return await patchPenetrationAutomationExecution({
        ownerUserId: execution.ownerUserId,
        id: execution.id,
        patch: {
          status: "pending",
          nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
          error: "当前客户另一个检测任务正在运行，自动任务稍后继续",
        },
      })
    }
    if (skipSubmissionError(error)) {
      await finishSkipped(
        schedule,
        execution,
        error instanceof Error ? error.message : "自动检测配置暂不可用，本次未执行",
      )
      return null
    }
    throw error
  }
}

async function dispatchDropAlert(input: {
  schedule: PenetrationAutomationSchedule
  execution: PenetrationAutomationExecution
  historyRecordId: string
  baselineRate: number
  currentRate: number
  relativeDropPct: number
  absoluteDropPoints: number
}): Promise<string | undefined> {
  let sent = false
  if (input.schedule.inAppEnabled) {
    await notifyPenetrationAutomationAlert({
      userId: input.schedule.actorUserId,
      executionId: input.execution.id,
      clientId: input.schedule.clientId,
      clientName: input.schedule.clientName,
      historyRecordId: input.historyRecordId,
      baselineRate: input.baselineRate,
      currentRate: input.currentRate,
      relativeDropPct: input.relativeDropPct,
      absoluteDropPoints: input.absoluteDropPoints,
    })
    sent = true
  }
  if (input.schedule.emailEnabled) {
    const user = await getUserById(input.schedule.actorUserId)
    if (user?.email && user.emailVerifiedAt) {
      try {
        await sendPenetrationAutomationAlertEmail({
          to: user.email,
          accountName: user.name,
          clientName: input.schedule.clientName,
          historyRecordId: input.historyRecordId,
          baselineRate: input.baselineRate,
          currentRate: input.currentRate,
          relativeDropPct: input.relativeDropPct,
          absoluteDropPoints: input.absoluteDropPoints,
        })
        sent = true
      } catch (error) {
        console.error("[penetration-automation] alert email failed", input.execution.id, error)
      }
    }
  }
  return sent ? new Date().toISOString() : undefined
}

async function reconcileExecution(
  schedule: PenetrationAutomationSchedule,
  execution: PenetrationAutomationExecution,
): Promise<void> {
  if (!execution.jobId) return
  const job = await getPenetrationJob(execution.jobId, schedule.ownerUserId)
    || await getPenetrationJob(execution.jobId, schedule.actorUserId)
  if (!job) {
    const attempts = execution.attemptCount + 1
    if (attempts >= MAX_SUBMISSION_ATTEMPTS) {
      throw new Error("自动检测任务记录不存在")
    }
    await patchPenetrationAutomationExecution({
      ownerUserId: execution.ownerUserId,
      id: execution.id,
      patch: { attemptCount: attempts, nextAttemptAt: retryAt(attempts) },
    })
    return
  }
  if (activeJobStatus(job.status)) {
    await patchPenetrationAutomationExecution({
      ownerUserId: execution.ownerUserId,
      id: execution.id,
      patch: {
        status: "running",
        nextAttemptAt: new Date(Date.now() + 20_000).toISOString(),
        error: undefined,
      },
    })
    return
  }

  const completedAt = job.finishedAt || new Date().toISOString()
  const historyRecordId = job.historyRecordId || job.id
  const executionStatus = job.status === "succeeded"
    ? "succeeded" as const
    : job.status === "blocked"
      ? "partial" as const
      : job.status === "cancelled"
        ? "cancelled" as const
        : "failed" as const
  if (job.status === "succeeded" || job.status === "blocked") {
    const history = await getPenetrationHistoryRecord(schedule.ownerUserId, historyRecordId)
    if (!history) {
      await patchPenetrationAutomationExecution({
        ownerUserId: execution.ownerUserId,
        id: execution.id,
        patch: { status: "running", nextAttemptAt: new Date(Date.now() + 15_000).toISOString() },
      })
      return
    }
    const candidates = await listPenetrationHistoryComparisonRecords({
      ownerUserId: schedule.ownerUserId,
      clientId: schedule.clientId,
      limit: 100,
    })
    const comparison = comparePenetrationAutomationResult({
      current: history,
      candidates,
      relativeDropThresholdPct:
        execution.inputSnapshot?.relativeDropThresholdPct
        ?? schedule.relativeDropThresholdPct,
      minimumAbsoluteDropPoints:
        execution.inputSnapshot?.minimumAbsoluteDropPoints
        ?? schedule.minimumAbsoluteDropPoints,
    })
    const alertSentAt = comparison.alertTriggered
      && comparison.baselineRate !== undefined
      && comparison.currentRate !== undefined
      && comparison.relativeDropPct !== undefined
      && comparison.absoluteDropPoints !== undefined
      ? await dispatchDropAlert({
          schedule,
          execution,
          historyRecordId,
          baselineRate: comparison.baselineRate,
          currentRate: comparison.currentRate,
          relativeDropPct: comparison.relativeDropPct,
          absoluteDropPoints: comparison.absoluteDropPoints,
        })
      : undefined
    const saved = await patchPenetrationAutomationExecution({
      ownerUserId: execution.ownerUserId,
      id: execution.id,
      patch: {
        status: executionStatus,
        historyRecordId,
        usedCredits: estimateFeatureCredits("penetrationSlot", job.completedSlots),
        baselineHistoryRecordId: comparison.baselineHistoryRecordId,
        baselineRate: comparison.baselineRate,
        currentRate: comparison.currentRate,
        absoluteDropPoints: comparison.absoluteDropPoints,
        relativeDropPct: comparison.relativeDropPct,
        comparable: comparison.comparable,
        comparisonReason: comparison.reason,
        alertTriggered: comparison.alertTriggered,
        alertSentAt,
        completedAt,
        nextAttemptAt: undefined,
        error: job.error,
      },
    })
    if (saved) {
      await recordPenetrationAutomationScheduleProgress({
        schedule,
        execution: saved,
        outcome: "succeeded",
        error: job.error,
      })
    }
    return
  }

  const saved = await patchPenetrationAutomationExecution({
    ownerUserId: execution.ownerUserId,
    id: execution.id,
    patch: {
      status: executionStatus,
      historyRecordId: job.historyRecordId,
      usedCredits: estimateFeatureCredits("penetrationSlot", job.completedSlots),
      completedAt,
      nextAttemptAt: undefined,
      error: job.error || "自动检测未完成",
    },
  })
  if (saved) {
    await recordPenetrationAutomationScheduleProgress({
      schedule,
      execution: saved,
      outcome: executionStatus === "cancelled" ? "skipped" : "failed",
      error: saved.error,
    })
  }
}

async function failExecution(
  schedule: PenetrationAutomationSchedule,
  execution: PenetrationAutomationExecution,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : "自动检测执行失败"
  const attempts = execution.attemptCount + 1
  if (attempts < MAX_SUBMISSION_ATTEMPTS) {
    await patchPenetrationAutomationExecution({
      ownerUserId: execution.ownerUserId,
      id: execution.id,
      patch: {
        status: execution.jobId ? "running" : "pending",
        attemptCount: attempts,
        nextAttemptAt: retryAt(attempts),
        error: message,
      },
    })
    return
  }
  const saved = await patchPenetrationAutomationExecution({
    ownerUserId: execution.ownerUserId,
    id: execution.id,
    patch: {
      status: "failed",
      attemptCount: attempts,
      completedAt: new Date().toISOString(),
      nextAttemptAt: undefined,
      error: message,
    },
  })
  if (!saved) return
  const updated = await recordPenetrationAutomationScheduleProgress({
    schedule,
    execution: saved,
    outcome: "failed",
    error: message,
  })
  const attention = updated?.status === "paused"
    ? `${message}。计划已连续失败 3 次并自动暂停，请检查后恢复。`
    : message
  await notifyAttention(updated || schedule, saved, attention)
}

async function processExecution(ownerUserId: string, executionId: string): Promise<void> {
  const lockKey = executionLockKey(ownerUserId, executionId)
  const lockToken = randomUUID()
  const locked = await kv.set(lockKey, lockToken, { nx: true, ex: EXECUTION_LOCK_SECONDS })
  if (!locked) return
  try {
    let execution = await getPenetrationAutomationExecution(ownerUserId, executionId)
    if (!execution || terminalExecutionStatus(execution.status)) return
    const schedule = await getPenetrationAutomationSchedule(ownerUserId, execution.scheduleId)
    if (!schedule) {
      await patchPenetrationAutomationExecution({
        ownerUserId,
        id: executionId,
        patch: {
          status: "cancelled",
          completedAt: new Date().toISOString(),
          error: "自动检测计划已删除",
        },
      })
      return
    }
    try {
      if (execution.status === "pending") {
        const submitted = await submitExecution(schedule, execution)
        if (!submitted || terminalExecutionStatus(submitted.status)) return
        execution = submitted
      }
      if (execution.status === "submitted" || execution.status === "running") {
        await reconcileExecution(schedule, execution)
      }
    } catch (error) {
      const latest = await getPenetrationAutomationExecution(ownerUserId, executionId)
      if (latest && !terminalExecutionStatus(latest.status)) {
        await failExecution(schedule, latest, error)
      }
    }
  } finally {
    if (await kv.get<string>(lockKey) === lockToken) await kv.del(lockKey)
  }
}

export async function runPenetrationAutomationSweep(now = new Date()): Promise<void> {
  await claimDuePenetrationAutomationExecutions(now, 100)
  const actionable = await listActionablePenetrationAutomationExecutions(now, 200)
  const concurrency = Math.max(
    1,
    Math.min(8, Math.floor(Number(process.env.PENETRATION_AUTOMATION_CONCURRENCY) || 4)),
  )
  for (let index = 0; index < actionable.length; index += concurrency) {
    await Promise.all(actionable.slice(index, index + concurrency).map(execution => (
      processExecution(execution.ownerUserId, execution.id)
    )))
  }
}

export async function registerPenetrationAutomationScheduler(): Promise<void> {
  if (String(process.env.PENETRATION_AUTOMATION_ENABLED || "true").toLowerCase() === "false") {
    return
  }
  const schedule = penetrationAutomationSchedule()
  await automationQueue().upsertJobScheduler(
    SCHEDULER_ID,
    { pattern: schedule.pattern, tz: schedule.timezone },
    { name: SWEEP_JOB_NAME, data: { kind: "sweep" } },
  )
}

export async function enqueuePenetrationAutomationCatchup(now = new Date()): Promise<void> {
  if (String(process.env.PENETRATION_AUTOMATION_ENABLED || "true").toLowerCase() === "false") {
    return
  }
  await automationQueue().add(
    SWEEP_JOB_NAME,
    { kind: "sweep" },
    { jobId: minuteJobId(now) },
  )
}

export async function enqueuePenetrationAutomationExecution(input: {
  ownerUserId: string
  executionId: string
}): Promise<void> {
  await automationQueue().add(
    EXECUTION_JOB_NAME,
    { kind: "execution", ...input },
    { jobId: executionJobId(input.ownerUserId, input.executionId) },
  )
}

async function processAutomationQueueJob(job: Job<AutomationQueuePayload>): Promise<void> {
  if (job.data.kind === "execution") {
    await processExecution(job.data.ownerUserId, job.data.executionId)
    return
  }
  await runPenetrationAutomationSweep()
}

export function createPenetrationAutomationWorker(): Worker<AutomationQueuePayload> {
  const worker = new Worker<AutomationQueuePayload>(
    penetrationAutomationQueueName(),
    processAutomationQueueJob,
    {
      connection: queueConnection(),
      prefix: String(process.env.TASK_QUEUE_PREFIX || "geo:bull"),
      concurrency: Math.max(
        1,
        Math.min(4, Math.floor(Number(process.env.PENETRATION_AUTOMATION_WORKER_CONCURRENCY) || 2)),
      ),
      autorun: false,
    },
  )
  worker.on("ready", () => {
    console.info("[penetration-automation] worker ready", penetrationAutomationQueueName())
  })
  worker.on("failed", (job, error) => {
    console.error("[penetration-automation] failed", job?.name, job?.id, error.message)
  })
  worker.on("error", error => {
    console.error("[penetration-automation] worker error", error)
  })
  return worker
}

export async function closePenetrationAutomationQueue(): Promise<void> {
  const queue = schedulerGlobal.__geoPenetrationAutomationQueue
  schedulerGlobal.__geoPenetrationAutomationQueue = undefined
  if (queue) await queue.close()
}
