import "server-only"

import { createHash } from "node:crypto"
import { Job, Queue, Worker, type ConnectionOptions } from "bullmq"
import { kv } from "@/lib/kv"
import { durableTaskQueueConnection, durableTaskQueueName } from "@/lib/task-queue"
import {
  claimDueClientFeedbackAutomationExecutions,
  getClientFeedbackAutomationExecution,
  getClientFeedbackAutomationSchedule,
  listActionableClientFeedbackAutomationExecutions,
  patchClientFeedbackAutomationExecution,
  recordClientFeedbackAutomationScheduleProgress,
} from "@/lib/client-feedback/automation-store"
import {
  clientFeedbackPeriodActionCount,
  createClientFeedbackReport,
} from "@/lib/client-feedback/report-service"
import { getClientExecutionProfile } from "@/lib/client-feedback/store"
import { sendClientFeedbackAutomationEmail } from "@/lib/client-feedback/automation-email"
import {
  notifyFeedbackAutomationAttention,
  notifyFeedbackAutomationResult,
} from "@/lib/user-notifications"
import { listTeamMembers } from "@/lib/team-store"
import { hasTeamPermission } from "@/lib/team-permissions"
import { listWorkspaceClients } from "@/lib/workspace-store"
import type {
  ClientFeedbackAutomationExecution,
  ClientFeedbackAutomationSchedule,
} from "@/types/client-feedback"

type QueuePayload =
  | { kind: "sweep" }
  | { kind: "execution"; ownerUserId: string; executionId: string }

const SCHEDULER_ID = "geo-client-feedback-automation-minute-v1"
const SWEEP_JOB_NAME = "client-feedback-automation-sweep"
const EXECUTION_JOB_NAME = "client-feedback-automation-execution"
const LOCK_SECONDS = 10 * 60

const schedulerGlobal = globalThis as typeof globalThis & {
  __geoClientFeedbackAutomationQueue?: Queue<QueuePayload>
}

export function clientFeedbackAutomationQueueName(): string {
  return `${durableTaskQueueName()}-feedback-automation`
}

export function clientFeedbackAutomationSchedule(): { pattern: string; timezone: string } {
  return {
    pattern: String(process.env.CLIENT_FEEDBACK_AUTOMATION_CRON || "* * * * *").trim(),
    timezone: "Asia/Shanghai",
  }
}

function connection(): ConnectionOptions {
  return durableTaskQueueConnection()
}

function queue(): Queue<QueuePayload> {
  if (schedulerGlobal.__geoClientFeedbackAutomationQueue) {
    return schedulerGlobal.__geoClientFeedbackAutomationQueue
  }
  const created = new Queue<QueuePayload>(clientFeedbackAutomationQueueName(), {
    connection: connection(),
    prefix: String(process.env.TASK_QUEUE_PREFIX || "geo:bull"),
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: { age: 60 * 60 * 24 * 7, count: 5_000 },
      removeOnFail: { age: 60 * 60 * 24 * 30, count: 5_000 },
    },
  })
  created.on("error", error => console.error("[feedback-automation] queue error", error.message))
  schedulerGlobal.__geoClientFeedbackAutomationQueue = created
  return created
}

function executionJobId(ownerUserId: string, executionId: string): string {
  const digest = createHash("sha256").update(`${ownerUserId}\u0000${executionId}`).digest("hex").slice(0, 32)
  return `feedback-automation-execution-${digest}`
}

function executionLockKey(ownerUserId: string, executionId: string): string {
  return `geo:feedback-automation:lock:${createHash("sha256").update(`${ownerUserId}\u0000${executionId}`).digest("hex")}`
}

function sweepJobId(now = new Date()): string {
  return `feedback-automation-sweep-${now.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
}

function deterministicMessageId(executionId: string, email: string): string {
  const digest = createHash("sha256").update(`${executionId}\u0000${email}`).digest("hex").slice(0, 40)
  return `<feedback-${digest}@shitugeo.top>`
}

async function notificationRecipientIds(schedule: ClientFeedbackAutomationSchedule): Promise<string[]> {
  const ids = new Set([schedule.actorUserId])
  if (schedule.teamId) {
    const members = await listTeamMembers(schedule.teamId).catch(() => [])
    for (const member of members) {
      if (
        member.status === "active"
        && (member.role === "owner" || hasTeamPermission(member.permissionKeys, "feedback", "manage"))
      ) ids.add(member.userId)
    }
  }
  return [...ids].filter(Boolean)
}

async function notifySuccess(
  schedule: ClientFeedbackAutomationSchedule,
  execution: ClientFeedbackAutomationExecution,
): Promise<void> {
  const recipients = await notificationRecipientIds(schedule)
  await Promise.allSettled(recipients.map(userId => notifyFeedbackAutomationResult({
    userId,
    executionId: execution.id,
    clientId: schedule.clientId,
    clientName: schedule.clientName,
    reportCount: execution.reports.length,
    sharePath: execution.reports[0]?.sharePath,
  })))
}

async function notifyFailure(
  schedule: ClientFeedbackAutomationSchedule,
  execution: ClientFeedbackAutomationExecution,
  message: string,
): Promise<void> {
  const recipients = await notificationRecipientIds(schedule)
  await Promise.allSettled(recipients.map(userId => notifyFeedbackAutomationAttention({
    userId,
    executionId: execution.id,
    clientId: schedule.clientId,
    clientName: schedule.clientName,
    message,
  })))
}

async function generateReports(
  schedule: ClientFeedbackAutomationSchedule,
  execution: ClientFeedbackAutomationExecution,
): Promise<ClientFeedbackAutomationExecution> {
  const client = (await listWorkspaceClients(schedule.ownerUserId))
    .find(item => item.client.id === schedule.clientId)?.client
  if (!client) throw new Error("客户面板不存在或已被删除")
  const profile = await getClientExecutionProfile(schedule.ownerUserId, schedule.clientId)
  let reports = [...execution.reports]

  for (const period of execution.periods) {
    if (reports.some(report => (
      report.type === period.type
      && report.periodStart === period.start
      && report.periodEnd === period.end
    ))) continue
    if (!schedule.sendEmptyReports) {
      const count = await clientFeedbackPeriodActionCount({
        ownerUserId: schedule.ownerUserId,
        clientId: schedule.clientId,
        period,
      })
      if (count === 0) continue
    }
    const created = await createClientFeedbackReport({
      ownerUserId: schedule.ownerUserId,
      actorUserId: schedule.actorUserId,
      client,
      profile,
      period,
      publish: true,
      requestId: `feedback_auto_${schedule.id}_${period.type}_${period.start}_${period.end}`,
    })
    reports = [...reports, {
      type: period.type,
      periodStart: period.start,
      periodEnd: period.end,
      label: period.final ? `收官${period.type === "weekly" ? "周报" : "月报"}` : period.label,
      reportId: created.report.id,
      sharePath: created.sharePath,
    }]
    const saved = await patchClientFeedbackAutomationExecution({
      ownerUserId: execution.ownerUserId,
      id: execution.id,
      patch: { status: "generated", reports, error: undefined },
    })
    if (saved) execution = saved
  }
  return execution
}

async function deliverReports(
  schedule: ClientFeedbackAutomationSchedule,
  execution: ClientFeedbackAutomationExecution,
): Promise<ClientFeedbackAutomationExecution> {
  let deliveries = [...execution.deliveries]
  for (const delivery of deliveries) {
    if (delivery.status === "sent") continue
    try {
      await sendClientFeedbackAutomationEmail({
        to: delivery.email,
        schedule,
        reports: execution.reports,
        messageId: deterministicMessageId(execution.id, delivery.email),
      })
      deliveries = deliveries.map(item => item.email === delivery.email
        ? { ...item, status: "sent" as const, sentAt: new Date().toISOString(), error: undefined }
        : item)
    } catch (error) {
      deliveries = deliveries.map(item => item.email === delivery.email
        ? { ...item, status: "failed" as const, error: error instanceof Error ? error.message.slice(0, 300) : "邮件发送失败" }
        : item)
    }
    const saved = await patchClientFeedbackAutomationExecution({
      ownerUserId: execution.ownerUserId,
      id: execution.id,
      patch: { deliveries },
    })
    if (saved) execution = saved
  }
  if (deliveries.some(item => item.status !== "sent")) throw new Error("部分报送邮箱发送失败")
  return execution
}

async function processExecution(job: Job<QueuePayload>): Promise<void> {
  if (job.data.kind !== "execution") return
  const lockKey = executionLockKey(job.data.ownerUserId, job.data.executionId)
  const lockToken = createHash("sha256").update(`${process.pid}:${Date.now()}:${Math.random()}`).digest("hex")
  if (!await kv.set(lockKey, lockToken, { nx: true, ex: LOCK_SECONDS })) return

  let execution = await getClientFeedbackAutomationExecution(job.data.ownerUserId, job.data.executionId)
  let schedule: ClientFeedbackAutomationSchedule | null = null
  try {
    if (!execution || ["sent", "skipped", "cancelled"].includes(execution.status)) return
    schedule = await getClientFeedbackAutomationSchedule(execution.ownerUserId, execution.scheduleId)
    if (!schedule) throw new Error("自动报送计划不存在")
    if (execution.trigger === "scheduled" && schedule.status === "paused") {
      await patchClientFeedbackAutomationExecution({
        ownerUserId: execution.ownerUserId,
        id: execution.id,
        patch: { status: "cancelled", completedAt: new Date().toISOString(), error: "自动报送计划已暂停" },
      })
      return
    }
    execution = await patchClientFeedbackAutomationExecution({
      ownerUserId: execution.ownerUserId,
      id: execution.id,
      patch: {
        status: "running",
        attemptCount: execution.attemptCount + 1,
        startedAt: execution.startedAt || new Date().toISOString(),
        nextAttemptAt: undefined,
        error: undefined,
      },
    }) || execution
    await recordClientFeedbackAutomationScheduleProgress({ schedule, execution, outcome: "started" })
    execution = await generateReports(schedule, execution)
    if (!execution.reports.length) {
      execution = await patchClientFeedbackAutomationExecution({
        ownerUserId: execution.ownerUserId,
        id: execution.id,
        patch: { status: "skipped", completedAt: new Date().toISOString(), error: "该周期没有可报送的客户动作" },
      }) || execution
      await recordClientFeedbackAutomationScheduleProgress({ schedule, execution, outcome: "succeeded" })
      return
    }
    execution = await deliverReports(schedule, execution)
    execution = await patchClientFeedbackAutomationExecution({
      ownerUserId: execution.ownerUserId,
      id: execution.id,
      patch: { status: "sent", completedAt: new Date().toISOString(), nextAttemptAt: undefined, error: undefined },
    }) || execution
    await recordClientFeedbackAutomationScheduleProgress({ schedule, execution, outcome: "succeeded" })
    await notifySuccess(schedule, execution)
  } catch (error) {
    const message = error instanceof Error ? error.message : "自动报送失败"
    if (execution) {
      const maxAttempts = Math.max(1, Number(job.opts.attempts) || 1)
      const finalAttempt = job.attemptsMade + 1 >= maxAttempts
      const hasSent = execution.deliveries.some(item => item.status === "sent")
      execution = await patchClientFeedbackAutomationExecution({
        ownerUserId: execution.ownerUserId,
        id: execution.id,
        patch: {
          status: finalAttempt ? (hasSent ? "partial" : "failed") : execution.reports.length ? "generated" : "pending",
          nextAttemptAt: finalAttempt ? undefined : new Date(Date.now() + 60_000).toISOString(),
          completedAt: finalAttempt ? new Date().toISOString() : undefined,
          error: message.slice(0, 500),
        },
      }) || execution
      if (schedule && finalAttempt) {
        await recordClientFeedbackAutomationScheduleProgress({ schedule, execution, outcome: "failed", error: message })
        await notifyFailure(schedule, execution, message)
      }
    }
    throw error
  } finally {
    if (await kv.get<string>(lockKey) === lockToken) await kv.del(lockKey)
  }
}

export async function enqueueClientFeedbackAutomationExecution(input: {
  ownerUserId: string
  executionId: string
}): Promise<void> {
  await queue().add(EXECUTION_JOB_NAME, { kind: "execution", ...input }, {
    jobId: executionJobId(input.ownerUserId, input.executionId),
  })
}

export async function retryClientFeedbackAutomationExecution(input: {
  ownerUserId: string
  executionId: string
}): Promise<void> {
  const activeQueue = queue()
  const jobId = executionJobId(input.ownerUserId, input.executionId)
  const existing = await activeQueue.getJob(jobId)
  if (existing) {
    const state = await existing.getState()
    if (!["failed", "completed"].includes(state)) return
    await existing.remove()
  }
  await activeQueue.add(EXECUTION_JOB_NAME, { kind: "execution", ...input }, { jobId })
}

async function runSweep(): Promise<void> {
  const [claimed, actionable] = await Promise.all([
    claimDueClientFeedbackAutomationExecutions(),
    listActionableClientFeedbackAutomationExecutions(),
  ])
  const executions = [...new Map([...claimed, ...actionable].map(item => [item.id, item])).values()]
  if (!executions.length) return
  await Promise.all(executions.map(execution => retryClientFeedbackAutomationExecution({
    ownerUserId: execution.ownerUserId,
    executionId: execution.id,
  })))
}

async function processJob(job: Job<QueuePayload>): Promise<void> {
  if (job.data.kind === "sweep") return runSweep()
  return processExecution(job)
}

export async function registerClientFeedbackAutomationScheduler(): Promise<void> {
  if (String(process.env.CLIENT_FEEDBACK_AUTOMATION_ENABLED || "true").toLowerCase() === "false") return
  const schedule = clientFeedbackAutomationSchedule()
  await queue().upsertJobScheduler(
    SCHEDULER_ID,
    { pattern: schedule.pattern, tz: schedule.timezone },
    { name: SWEEP_JOB_NAME, data: { kind: "sweep" } },
  )
}

export async function enqueueClientFeedbackAutomationCatchup(now = new Date()): Promise<void> {
  if (String(process.env.CLIENT_FEEDBACK_AUTOMATION_ENABLED || "true").toLowerCase() === "false") return
  await queue().add(SWEEP_JOB_NAME, { kind: "sweep" }, { jobId: sweepJobId(now) })
}

export function createClientFeedbackAutomationWorker(): Worker<QueuePayload> {
  const worker = new Worker<QueuePayload>(clientFeedbackAutomationQueueName(), processJob, {
    connection: connection(),
    prefix: String(process.env.TASK_QUEUE_PREFIX || "geo:bull"),
    concurrency: Math.max(1, Math.min(6, Number(process.env.CLIENT_FEEDBACK_AUTOMATION_CONCURRENCY) || 2)),
    limiter: {
      max: Math.max(1, Math.min(120, Number(process.env.CLIENT_FEEDBACK_AUTOMATION_RATE_LIMIT) || 20)),
      duration: 60_000,
    },
    autorun: false,
  })
  worker.on("ready", () => console.info("[feedback-automation] worker ready", clientFeedbackAutomationQueueName()))
  worker.on("completed", job => console.info("[feedback-automation] completed", job.name, job.id))
  worker.on("failed", (job, error) => console.error("[feedback-automation] failed", job?.name, job?.id, error.message))
  worker.on("error", error => console.error("[feedback-automation] worker error", error))
  return worker
}

export async function closeClientFeedbackAutomationQueue(): Promise<void> {
  const active = schedulerGlobal.__geoClientFeedbackAutomationQueue
  schedulerGlobal.__geoClientFeedbackAutomationQueue = undefined
  if (active) await active.close()
}
