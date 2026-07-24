import "server-only"

import { getOwnedStoredArticleBatch } from "@/lib/article-batches/store"
import {
  requireOperationAccess,
  type OperationAccessContext,
} from "@/lib/team-access"
import type { TeamPermissionAction } from "@/lib/team-permissions"
import type { StoredArticleBatch } from "@/lib/article-batches/store"

export async function requireArticleBatchAccess(input: {
  batchId: string
  userId: string
  action: TeamPermissionAction
}): Promise<{
  batch: StoredArticleBatch
  access: OperationAccessContext
} | null> {
  const batch = await getOwnedStoredArticleBatch(input.batchId, input.userId)
  if (!batch) return null
  const access = await requireOperationAccess({
    userId: input.userId,
    clientId: batch.clientId,
    module: "article",
    action: input.action,
    teamId: batch.teamId,
  })
  return { batch, access }
}

export function isTeamAccessError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name.startsWith("TEAM_")
    || error.name.startsWith("CLIENT_")
    || /权限|无权|只读|VIP4/.test(error.message)
}
