import "server-only"

import {
  getPenetrationAutomationExecution,
  getPenetrationAutomationSchedule,
  patchPenetrationAutomationExecution,
  recordPenetrationAutomationScheduleProgress,
} from "@/lib/penetration/automation-store"
import { cancelPenetrationJob } from "@/lib/penetration/jobs"
import type {
  PenetrationAutomationExecution,
  PenetrationAutomationExecutionStatus,
} from "@/lib/penetration/automation-types"

const TERMINAL_STATUSES = new Set<PenetrationAutomationExecutionStatus>([
  "succeeded",
  "partial",
  "failed",
  "skipped",
  "cancelled",
])

export async function cancelPenetrationAutomationExecution(input: {
  ownerUserId: string
  executionId: string
  reason?: string
}): Promise<PenetrationAutomationExecution | null> {
  const execution = await getPenetrationAutomationExecution(
    input.ownerUserId,
    input.executionId,
  )
  if (!execution || TERMINAL_STATUSES.has(execution.status)) return execution

  const reason = String(input.reason || "用户已停止本次自动检测").trim().slice(0, 500)
  let status: PenetrationAutomationExecutionStatus = "cancelled"
  let historyRecordId = execution.historyRecordId
  let completedAt = new Date().toISOString()
  let error: string | undefined = reason

  if (execution.jobId) {
    const job = await cancelPenetrationJob(execution.jobId, input.ownerUserId)
      || await cancelPenetrationJob(execution.jobId, execution.actorUserId)
    if (job?.status === "succeeded") {
      status = "succeeded"
      historyRecordId = job.historyRecordId || historyRecordId
      completedAt = job.finishedAt || completedAt
      error = job.error
    } else if (job?.status === "blocked") {
      status = "partial"
      historyRecordId = job.historyRecordId || historyRecordId
      completedAt = job.finishedAt || completedAt
      error = job.error
    } else if (job?.status === "failed") {
      status = "failed"
      historyRecordId = job.historyRecordId || historyRecordId
      completedAt = job.finishedAt || completedAt
      error = job.error || reason
    }
  }

  const saved = await patchPenetrationAutomationExecution({
    ownerUserId: input.ownerUserId,
    id: execution.id,
    patch: {
      status,
      historyRecordId,
      completedAt,
      nextAttemptAt: undefined,
      error,
    },
  })
  if (!saved) return null

  const schedule = await getPenetrationAutomationSchedule(
    input.ownerUserId,
    execution.scheduleId,
  )
  if (schedule) {
    await recordPenetrationAutomationScheduleProgress({
      schedule,
      execution: saved,
      outcome: status === "failed" ? "failed" : status === "cancelled" ? "skipped" : "succeeded",
      error,
    })
  }
  return saved
}
