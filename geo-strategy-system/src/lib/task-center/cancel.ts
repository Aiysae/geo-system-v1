import "server-only"

import { getTaskCenterCancellationTarget } from "@/lib/task-center/store"
import { isTaskCenterTerminalStatus, type TaskCenterStatus } from "@/types/task-center"

export type CancelTaskCenterResult = {
  taskId: string
  status: TaskCenterStatus
  message: string
}

export class TaskCenterCancelError extends Error {
  code: "NOT_FOUND" | "NOT_CANCELLABLE"

  constructor(
    code: TaskCenterCancelError["code"],
    message: string,
  ) {
    super(message)
    this.name = "TaskCenterCancelError"
    this.code = code
  }
}

function normalizedStatus(value: unknown): TaskCenterStatus {
  const status = String(value || "")
  if (status === "succeeded") return "succeeded"
  if (status === "partial") return "partial"
  if (status === "failed") return "failed"
  if (status === "blocked") return "blocked"
  if (status === "queued" || status === "preparing") return "queued"
  if (status === "running") return "running"
  if (status === "retrying") return "retrying"
  return "cancelled"
}

export async function cancelTaskCenterTask(
  taskId: string,
  userId: string,
): Promise<CancelTaskCenterResult> {
  const target = await getTaskCenterCancellationTarget(taskId, userId)
  if (!target) {
    throw new TaskCenterCancelError("NOT_FOUND", "任务不存在或无权停止")
  }
  if (isTaskCenterTerminalStatus(target.status)) {
    return {
      taskId: target.id,
      status: target.status,
      message: "任务已经结束",
    }
  }
  if (!target.canCancel) {
    throw new TaskCenterCancelError("NOT_CANCELLABLE", "当前任务暂不支持停止")
  }

  let result: { status?: unknown } | null = null
  if (target.source === "background") {
    const { cancelBackgroundJob } = await import("@/lib/background-jobs")
    result = await cancelBackgroundJob(target.sourceJobId, target.actorUserId)
  } else if (target.source === "penetration") {
    const { cancelPenetrationJob } = await import("@/lib/penetration/jobs")
    result = await cancelPenetrationJob(target.sourceJobId, target.actorUserId)
  } else if (target.source === "difficulty") {
    const { cancelDifficultyJob } = await import("@/lib/difficulty/jobs")
    result = await cancelDifficultyJob(target.sourceJobId, target.actorUserId)
  } else if (target.source === "question") {
    const { cancelQuestionJob } = await import("@/lib/geo-strategy/question-jobs")
    result = await cancelQuestionJob(target.sourceJobId, target.actorUserId)
  } else if (target.source === "articleBatch") {
    const { cancelArticleBatch } = await import("@/lib/article-batches/manager")
    result = await cancelArticleBatch(target.sourceJobId, target.actorUserId)
  } else if (target.source === "articleMedia") {
    const { cancelArticleMediaJob } = await import("@/lib/article-media/jobs")
    result = await cancelArticleMediaJob(target.sourceJobId, target.actorUserId)
  } else if (target.source === "report") {
    const { cancelCommercialReportJob } = await import("@/lib/reports/report-jobs")
    result = await cancelCommercialReportJob(
      target.sourceJobId,
      target.workspaceOwnerUserId,
    )
  }

  if (!result) {
    throw new TaskCenterCancelError("NOT_FOUND", "任务不存在或已经过期")
  }

  const status = normalizedStatus(result.status)
  return {
    taskId: target.id,
    status,
    message: status === "cancelled"
      ? "任务已停止，未执行部分不会继续处理"
      : status === "queued" || status === "running" || status === "retrying"
        ? "停止指令已发送，后台正在结束未完成步骤"
      : status === "succeeded" || status === "partial"
        ? "任务在停止前已经完成，结果已保留"
        : "任务已经结束",
  }
}
