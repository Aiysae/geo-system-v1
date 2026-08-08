import { randomUUID } from "node:crypto"
import { hostname } from "node:os"
import { Job, Worker } from "bullmq"
import {
  durableTaskQueueConnection,
  durableTaskQueueName,
  durableTaskQueueNameForLane,
  enqueueDurableTask,
  isDurableTaskSource,
  recordDurableTaskWorkerHeartbeat,
  refreshDurableTaskDispatch,
  releaseDurableTaskDispatch,
  removeDurableTaskWorkerHeartbeat,
  type DurableTaskPayload,
  type TaskWorkerOutcome,
} from "@/lib/task-queue"
import {
  isTaskCancellationRequested,
  startTaskCancellationMonitor,
} from "@/lib/task-cancellation"
import {
  actionReminderQueueName,
  closeActionReminderQueue,
  createActionReminderWorker,
  enqueueActionReminderCatchup,
  registerActionReminderScheduler,
} from "@/lib/action-reminders/scheduler"

function workerConcurrency(name: string, fallback: number): number {
  return Math.max(
    1,
    Math.min(12, Math.floor(Number(process.env[name]) || fallback)),
  )
}

const legacyConcurrency = workerConcurrency("TASK_WORKER_CONCURRENCY", 4)
const workerDefinitions = [
  {
    lane: "penetration" as const,
    queueName: durableTaskQueueNameForLane("penetration"),
    concurrency: workerConcurrency(
      "TASK_WORKER_PENETRATION_CONCURRENCY",
      Math.max(1, Math.ceil(legacyConcurrency / 2)),
    ),
  },
  {
    lane: "generation" as const,
    queueName: durableTaskQueueNameForLane("generation"),
    concurrency: workerConcurrency(
      "TASK_WORKER_GENERATION_CONCURRENCY",
      Math.max(4, Math.floor(legacyConcurrency / 2)),
    ),
  },
  {
    lane: "utility" as const,
    queueName: durableTaskQueueNameForLane("utility"),
    concurrency: workerConcurrency("TASK_WORKER_UTILITY_CONCURRENCY", 1),
  },
  {
    lane: "legacy" as const,
    queueName: durableTaskQueueName(),
    concurrency: workerConcurrency("TASK_WORKER_LEGACY_CONCURRENCY", 1),
  },
] as const
const actionReminderWorker = createActionReminderWorker()
const prefix = String(process.env.TASK_QUEUE_PREFIX || "geo:bull")

const workerStartedAt = new Date().toISOString()
const workerId = `${hostname().replace(/[^A-Za-z0-9_.-]/g, "-")}:${process.pid}:${randomUUID()
  .replace(/-/g, "")
  .slice(0, 12)}`
const heartbeatIntervalMs = Math.max(
  5_000,
  Math.min(60_000, Number(process.env.TASK_WORKER_HEARTBEAT_MS) || 15_000),
)
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

async function writeWorkerHeartbeat(): Promise<void> {
  try {
    await recordDurableTaskWorkerHeartbeat({
      workerId,
      startedAt: workerStartedAt,
    queues: [
      ...workerDefinitions.map(definition => ({
        lane: definition.lane,
        queueName: definition.queueName,
        concurrency: definition.concurrency,
      })),
      {
        lane: "notifications" as const,
        queueName: actionReminderQueueName(),
        concurrency: Math.max(
          1,
          Math.min(4, Number(process.env.ACTION_REMINDER_CONCURRENCY) || 2),
        ),
      },
    ],
    })
  } catch (error) {
    console.warn(
      "[geo-worker] heartbeat failed",
      error instanceof Error ? error.message : error,
    )
  }
}

function startWorkerHeartbeat(): void {
  void writeWorkerHeartbeat()
  heartbeatTimer = setInterval(() => {
    void writeWorkerHeartbeat()
  }, heartbeatIntervalMs)
  heartbeatTimer.unref()
}

async function stopWorkerHeartbeat(): Promise<void> {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = null
  await removeDurableTaskWorkerHeartbeat(workerId).catch(error => {
    console.warn(
      "[geo-worker] heartbeat cleanup failed",
      error instanceof Error ? error.message : error,
    )
  })
}
async function runTask(job: Job<DurableTaskPayload>): Promise<TaskWorkerOutcome> {
  const { source, sourceJobId } = job.data
  if (!isDurableTaskSource(source) || !sourceJobId) {
    throw new Error("后台队列任务数据无效")
  }

  if (source === "penetration") {
    const { runPenetrationJobFromWorker } = await import("@/lib/penetration/jobs")
    return runPenetrationJobFromWorker(sourceJobId)
  }
  if (source === "difficulty") {
    const { runDifficultyJobFromWorker } = await import("@/lib/difficulty/jobs")
    return runDifficultyJobFromWorker(sourceJobId)
  }
  if (source === "background") {
    const { runBackgroundJobFromWorker } = await import("@/lib/background-jobs")
    return runBackgroundJobFromWorker(sourceJobId)
  }
  if (source === "question") {
    const { runQuestionJobFromWorker } = await import("@/lib/geo-strategy/question-jobs")
    return runQuestionJobFromWorker(sourceJobId)
  }
  if (source === "articleBatch") {
    const { runArticleBatchFromWorker } = await import("@/lib/article-batches/manager")
    return runArticleBatchFromWorker(sourceJobId)
  }
  if (source === "report") {
    const { runReportJobFromWorker } = await import("@/lib/reports/report-jobs")
    return runReportJobFromWorker(sourceJobId)
  }

  throw new Error(`后台任务类型尚未迁移到独立 Worker：${source}`)
}

async function processTask(job: Job<DurableTaskPayload>): Promise<void> {
  const { source, sourceJobId, dispatchToken } = job.data
  const startedAt = Date.now()
  console.info(
    "[geo-worker] started",
    source,
    sourceJobId,
    `attempt=${job.attemptsMade + 1}`,
  )
  const refreshMs = Math.max(
    30_000,
    Math.min(5 * 60_000, Number(process.env.TASK_QUEUE_CLAIM_REFRESH_MS) || 60_000),
  )
  let refreshRunning = false
  const claimTimer = setInterval(() => {
    if (refreshRunning) return
    refreshRunning = true
    void refreshDurableTaskDispatch(source, sourceJobId, dispatchToken)
      .finally(() => {
        refreshRunning = false
      })
  }, refreshMs)
  claimTimer.unref()
  const stopCancellationMonitor = startTaskCancellationMonitor(source, sourceJobId)

  try {
    if (await isTaskCancellationRequested(source, sourceJobId)) {
      await releaseDurableTaskDispatch(source, sourceJobId, dispatchToken)
      console.info("[geo-worker] cancelled before start", source, sourceJobId)
      return
    }
    const outcome = await runTask(job)
    await releaseDurableTaskDispatch(source, sourceJobId, dispatchToken)
    if (outcome.requeue) {
      await enqueueDurableTask(source, sourceJobId, {
        delayMs: Math.max(0, Math.floor(outcome.delayMs || 0)),
      })
    }
    console.info(
      "[geo-worker] finished",
      source,
      sourceJobId,
      `durationMs=${Date.now() - startedAt}`,
      outcome.requeue ? `requeueMs=${outcome.delayMs || 0}` : "terminal",
    )
  } catch (error) {
    const attempts = Math.max(1, Number(job.opts.attempts) || 1)
    const lastAttempt = job.attemptsMade + 1 >= attempts
    if (lastAttempt) {
      await releaseDurableTaskDispatch(source, sourceJobId, dispatchToken)
    }
    throw error
  } finally {
    clearInterval(claimTimer)
    stopCancellationMonitor()
  }
}

function createWorker(
  queueName: string,
  concurrency: number,
): Worker<DurableTaskPayload> {
  const worker = new Worker<DurableTaskPayload>(queueName, processTask, {
    connection: durableTaskQueueConnection(),
    prefix,
    concurrency,
    lockDuration: Math.max(
      60_000,
      Math.min(30 * 60_000, Number(process.env.TASK_WORKER_LOCK_MS) || 15 * 60_000),
    ),
    stalledInterval: 30_000,
    maxStalledCount: 2,
    autorun: false,
  })

  worker.on("ready", () => {
    console.info(
      "[geo-worker] ready",
      `queue=${queueName}`,
      `concurrency=${concurrency}`,
    )
  })
  worker.on("completed", job => {
    console.info("[geo-worker] queue item completed", queueName, job.name, job.id)
  })
  worker.on("failed", (job, error) => {
    console.error(
      "[geo-worker] queue item failed",
      queueName,
      job?.name || "unknown",
      job?.id || "unknown",
      error.message,
    )
  })
  worker.on("error", error => {
    console.error("[geo-worker] worker error", queueName, error)
  })
  return worker
}

const workers = workerDefinitions.map(definition =>
  createWorker(definition.queueName, definition.concurrency),
)

async function recoverPendingTasks(): Promise<void> {
  const [
    { resumePendingPenetrationJobs },
    { resumePendingDifficultyJobs },
    { resumePendingBackgroundJobs },
    { resumePendingQuestionJobs },
    { resumePendingArticleBatchMonitors },
    { resumePendingReportJobs },
  ] = await Promise.all([
    import("@/lib/penetration/jobs"),
    import("@/lib/difficulty/jobs"),
    import("@/lib/background-jobs"),
    import("@/lib/geo-strategy/question-jobs"),
    import("@/lib/article-batches/manager"),
    import("@/lib/reports/report-jobs"),
  ])
  await Promise.all([
    resumePendingPenetrationJobs(),
    resumePendingDifficultyJobs(),
    resumePendingBackgroundJobs(),
    resumePendingQuestionJobs(),
    resumePendingArticleBatchMonitors(),
    resumePendingReportJobs(),
  ])
}

async function waitForWebProcess(): Promise<void> {
  const port = String(process.env.PORT || "3000")
  const url = `http://127.0.0.1:${port}/api/task-center?limit=1`
  for (let attempt = 1; attempt <= 120; attempt++) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      })
      if (response.status > 0) return
    } catch {
      // PM2 may start the worker before the web process has bound its port.
    }
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
  throw new Error("Web process did not become ready within 120 seconds")
}

async function startWorker(): Promise<void> {
  await waitForWebProcess()
  await registerActionReminderScheduler()
  await enqueueActionReminderCatchup()
  const runPromises = [
    ...workers.map(worker => worker.run()),
    actionReminderWorker.run(),
  ]
  await Promise.all([
    ...workers.map(worker => worker.waitUntilReady()),
    actionReminderWorker.waitUntilReady(),
  ])
  startWorkerHeartbeat()
  await recoverPendingTasks()
  await Promise.all(runPromises)
}

void startWorker().catch(error => {
  console.error("[geo-worker] startup failed", error)
  process.exit(1)
})

let closing = false
async function shutdown(signal: string): Promise<void> {
  if (closing) return
  closing = true
  console.info("[geo-worker] shutting down", signal)
  const forceTimer = setTimeout(() => {
    console.error("[geo-worker] graceful shutdown timed out")
    process.exit(1)
  }, 30_000)
  forceTimer.unref()
  try {
    await Promise.all([
      stopWorkerHeartbeat(),
      ...workers.map(worker => worker.close()),
      actionReminderWorker.close(),
      closeActionReminderQueue(),
    ])
    clearTimeout(forceTimer)
    process.exit(0)
  } catch (error) {
    console.error("[geo-worker] shutdown failed", error)
    process.exit(1)
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"))
process.once("SIGINT", () => void shutdown("SIGINT"))
