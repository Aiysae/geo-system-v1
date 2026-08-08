import "server-only"

import { createHash } from "crypto"
import { Job, Queue, Worker, type ConnectionOptions } from "bullmq"
import {
  durableTaskQueueConnection,
  durableTaskQueueName,
} from "@/lib/task-queue"
import { shanghaiDateOnly } from "@/lib/client-feedback/store"
import {
  dispatchActionReminderForOwner,
  listEligibleActionReminderOwnerIds,
} from "@/lib/action-reminders/service"
import { kv } from "@/lib/kv"

type ActionReminderQueuePayload =
  | { kind: "sweep"; date?: string }
  | { kind: "owner"; date: string; userId: string }

const SCHEDULER_ID = "geo-action-reminder-daily-v1"
const SWEEP_JOB_NAME = "daily-action-reminder-sweep"
const OWNER_JOB_NAME = "daily-action-reminder-owner"
const SWEEP_COMPLETE_TTL_SECONDS = 60 * 60 * 48
const SWEEP_LOCK_TTL_SECONDS = 15 * 60

type SchedulerGlobal = typeof globalThis & {
  __geoActionReminderQueue?: Queue<ActionReminderQueuePayload>
}

const schedulerGlobal = globalThis as SchedulerGlobal

export function actionReminderQueueName(): string {
  return `${durableTaskQueueName()}-notifications`
}

export function actionReminderSchedule(): { pattern: string; timezone: string } {
  return {
    pattern: String(process.env.ACTION_REMINDER_CRON || "0 22 * * *").trim(),
    timezone: "Asia/Shanghai",
  }
}

function queueConnection(): ConnectionOptions {
  return durableTaskQueueConnection()
}

function actionReminderQueue(): Queue<ActionReminderQueuePayload> {
  if (schedulerGlobal.__geoActionReminderQueue) return schedulerGlobal.__geoActionReminderQueue
  const created = new Queue<ActionReminderQueuePayload>(actionReminderQueueName(), {
    connection: queueConnection(),
    prefix: String(process.env.TASK_QUEUE_PREFIX || "geo:bull"),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: { age: 60 * 60 * 24, count: 2_000 },
      removeOnFail: { age: 60 * 60 * 24 * 14, count: 2_000 },
    },
  })
  created.on("error", error => {
    console.error("[action-reminder] queue error", error.message)
  })
  schedulerGlobal.__geoActionReminderQueue = created
  return created
}

function sweepCompleteKey(date: string): string {
  return `geo:action-reminder:sweep-complete:${date}`
}

function sweepLockKey(date: string): string {
  return `geo:action-reminder:sweep-lock:${date}`
}

function ownerJobId(userId: string, date: string): string {
  const digest = createHash("sha256")
    .update(`${userId}\u0000${date}`)
    .digest("hex")
    .slice(0, 32)
  return `action-reminder-owner-${date.replace(/-/g, "")}-${digest}`
}

function sweepJobId(date: string): string {
  return `action-reminder-sweep-${date.replace(/-/g, "")}`
}

function shanghaiHour(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now))
}

export async function registerActionReminderScheduler(): Promise<void> {
  if (String(process.env.ACTION_REMINDER_ENABLED || "true").toLowerCase() === "false") {
    return
  }
  const schedule = actionReminderSchedule()
  await actionReminderQueue().upsertJobScheduler(
    SCHEDULER_ID,
    { pattern: schedule.pattern, tz: schedule.timezone },
    {
      name: SWEEP_JOB_NAME,
      data: { kind: "sweep" },
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
      },
    },
  )
}

export async function enqueueActionReminderCatchup(now = new Date()): Promise<boolean> {
  if (String(process.env.ACTION_REMINDER_ENABLED || "true").toLowerCase() === "false") {
    return false
  }
  if (shanghaiHour(now) < 22) return false
  const date = shanghaiDateOnly(now)
  if (await kv.get(sweepCompleteKey(date))) return false
  await actionReminderQueue().add(
    SWEEP_JOB_NAME,
    { kind: "sweep", date },
    { jobId: sweepJobId(date) },
  )
  return true
}

async function runSweep(dateValue?: string): Promise<void> {
  const date = dateValue || shanghaiDateOnly()
  if (await kv.get(sweepCompleteKey(date))) return
  const lockToken = createHash("sha256")
    .update(`${process.pid}:${Date.now()}:${Math.random()}`)
    .digest("hex")
  const locked = await kv.set(sweepLockKey(date), lockToken, {
    nx: true,
    ex: SWEEP_LOCK_TTL_SECONDS,
  })
  if (!locked) return

  try {
    const ownerIds = await listEligibleActionReminderOwnerIds()
    const targetQueue = actionReminderQueue()
    for (let index = 0; index < ownerIds.length; index += 500) {
      const chunk = ownerIds.slice(index, index + 500)
      await targetQueue.addBulk(chunk.map(userId => ({
        name: OWNER_JOB_NAME,
        data: { kind: "owner" as const, date, userId },
        opts: {
          jobId: ownerJobId(userId, date),
          attempts: 3,
          backoff: { type: "exponential" as const, delay: 60_000 },
        },
      })))
    }
    await kv.set(sweepCompleteKey(date), {
      date,
      ownerCount: ownerIds.length,
      completedAt: new Date().toISOString(),
    }, { ex: SWEEP_COMPLETE_TTL_SECONDS })
  } finally {
    if (await kv.get<string>(sweepLockKey(date)) === lockToken) {
      await kv.del(sweepLockKey(date))
    }
  }
}

async function processActionReminderJob(
  job: Job<ActionReminderQueuePayload>,
): Promise<void> {
  if (job.data.kind === "sweep") {
    await runSweep(job.data.date)
    return
  }
  await dispatchActionReminderForOwner(job.data.userId, job.data.date)
}

export function createActionReminderWorker(): Worker<ActionReminderQueuePayload> {
  const worker = new Worker<ActionReminderQueuePayload>(
    actionReminderQueueName(),
    processActionReminderJob,
    {
      connection: queueConnection(),
      prefix: String(process.env.TASK_QUEUE_PREFIX || "geo:bull"),
      concurrency: Math.max(
        1,
        Math.min(4, Number(process.env.ACTION_REMINDER_CONCURRENCY) || 2),
      ),
      limiter: {
        max: Math.max(1, Math.min(100, Number(process.env.ACTION_REMINDER_RATE_LIMIT) || 20)),
        duration: 60_000,
      },
      autorun: false,
    },
  )
  worker.on("ready", () => {
    console.info("[action-reminder] worker ready", actionReminderQueueName())
  })
  worker.on("completed", job => {
    console.info("[action-reminder] completed", job.name, job.id)
  })
  worker.on("failed", (job, error) => {
    console.error("[action-reminder] failed", job?.name, job?.id, error.message)
  })
  worker.on("error", error => {
    console.error("[action-reminder] worker error", error)
  })
  return worker
}

export async function closeActionReminderQueue(): Promise<void> {
  const activeQueue = schedulerGlobal.__geoActionReminderQueue
  schedulerGlobal.__geoActionReminderQueue = undefined
  if (activeQueue) await activeQueue.close()
}
