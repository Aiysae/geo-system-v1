import "server-only"

import { getBackgroundJobByRequest } from "@/lib/background-jobs"
import {
  requireOperationAccess,
  type OperationAccessContext,
} from "@/lib/team-access"
import type { TeamPermissionAction } from "@/lib/team-permissions"
import {
  getVideoProductionItem,
  patchVideoProductionItem,
  type StoredVideoProductionItem,
} from "@/lib/video-production/store"

export const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" }

export function videoProductionErrorStatus(error: unknown): number {
  if (!(error instanceof Error)) return 500
  if (error.name.startsWith("TEAM_") || error.name.startsWith("CLIENT_") || /权限|无权|只读|VIP4/.test(error.message)) {
    return 403
  }
  return 500
}

export async function requireVideoItemAccess(input: {
  itemId: string
  userId: string
  action: TeamPermissionAction
}): Promise<{ item: StoredVideoProductionItem; access: OperationAccessContext } | null> {
  const item = await getVideoProductionItem(input.itemId)
  if (!item) return null
  const access = await requireOperationAccess({
    userId: input.userId,
    clientId: item.clientId,
    module: "article",
    action: input.action,
    teamId: item.teamId,
  })
  if (access.dataOwnerUserId !== item.dataOwnerUserId) return null
  return { item, access }
}

/**
 * A job can fail or be cancelled before its endpoint runs, which leaves the
 * item queued. Reading the job also re-dispatches one that was left behind.
 */
export async function reconcileVideoItemWithJob(
  item: StoredVideoProductionItem,
): Promise<StoredVideoProductionItem> {
  if (item.status !== "queued" && item.status !== "running") return item
  const job = await getBackgroundJobByRequest(item.createdByUserId, "videoProduction", item.requestId)
    .catch(() => null)
  if (!job) return item
  if (job.status === "failed" || job.status === "cancelled") {
    const latest = await patchVideoProductionItem(item.id, current => (
      current.status === "succeeded"
        ? {}
        : {
            status: job.status === "cancelled" ? "cancelled" : "failed",
            stage: undefined,
            error: current.error || job.error || (job.status === "cancelled" ? "任务已停止" : "生成失败，已退回积分"),
          }
    ))
    return latest || item
  }
  return item
}
