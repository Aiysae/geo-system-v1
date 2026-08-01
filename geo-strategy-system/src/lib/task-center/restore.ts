import "server-only"

import { getBackgroundJob } from "@/lib/background-jobs"
import { getDifficultyJob } from "@/lib/difficulty/jobs"
import { getQuestionJob } from "@/lib/geo-strategy/question-jobs"
import { getPenetrationJob } from "@/lib/penetration/jobs"
import { getTaskCenterCancellationTarget } from "@/lib/task-center/store"

export async function restoreTaskCenterResult(taskId: string, userId: string): Promise<boolean> {
  const target = await getTaskCenterCancellationTarget(taskId, userId)
  if (!target) return false

  if (target.source === "background") {
    return Boolean(await getBackgroundJob(target.sourceJobId, target.actorUserId))
  }
  if (target.source === "question") {
    return Boolean(await getQuestionJob(target.sourceJobId, target.actorUserId))
  }
  if (target.source === "penetration") {
    return Boolean(await getPenetrationJob(target.sourceJobId, target.actorUserId))
  }
  if (target.source === "difficulty") {
    return Boolean(await getDifficultyJob(target.sourceJobId, target.actorUserId))
  }
  return true
}
