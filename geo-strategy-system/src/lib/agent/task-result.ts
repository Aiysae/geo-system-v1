import "server-only"

import { getArticleBatch } from "@/lib/article-batches/manager"
import { getOwnedArticleMediaJob } from "@/lib/article-media/jobs"
import { getBackgroundJob } from "@/lib/background-jobs"
import { getDifficultyJob } from "@/lib/difficulty/jobs"
import { getQuestionJob } from "@/lib/geo-strategy/question-jobs"
import { getPenetrationJob } from "@/lib/penetration/jobs"
import { getCommercialReportJob } from "@/lib/reports/report-jobs"
import type { TaskCenterCancellationTarget } from "@/lib/task-center/store"

export async function loadAgentTaskResult(target: TaskCenterCancellationTarget): Promise<unknown> {
  if (target.source === "background") {
    return getBackgroundJob(target.sourceJobId, target.actorUserId)
  }
  if (target.source === "penetration") {
    return getPenetrationJob(target.sourceJobId, target.actorUserId)
  }
  if (target.source === "difficulty") {
    return getDifficultyJob(target.sourceJobId, target.actorUserId)
  }
  if (target.source === "question") {
    return getQuestionJob(target.sourceJobId, target.actorUserId)
  }
  if (target.source === "articleBatch") {
    return getArticleBatch(target.sourceJobId, target.actorUserId)
  }
  if (target.source === "articleMedia") {
    return getOwnedArticleMediaJob(target.sourceJobId, target.actorUserId)
  }
  return getCommercialReportJob(target.sourceJobId, target.workspaceOwnerUserId)
}
