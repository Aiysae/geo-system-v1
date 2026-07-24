import "server-only"

import { getPenetrationHistoryRecordScope } from "@/lib/penetration/history-store"
import {
  requireOperationAccess,
  type OperationAccessContext,
} from "@/lib/team-access"
import type { TeamPermissionAction } from "@/lib/team-permissions"

export async function requirePenetrationHistoryAccess(input: {
  historyId: string
  userId: string
  action: TeamPermissionAction
}): Promise<{
  scope: NonNullable<Awaited<ReturnType<typeof getPenetrationHistoryRecordScope>>>
  access: OperationAccessContext
} | null> {
  const scope = await getPenetrationHistoryRecordScope(input.historyId)
  if (!scope) return null
  const access = await requireOperationAccess({
    userId: input.userId,
    clientId: scope.clientId,
    module: "penetration",
    action: input.action,
  })
  if (access.dataOwnerUserId !== scope.ownerUserId) return null
  return { scope, access }
}

export function isPenetrationHistoryAccessError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name.startsWith("TEAM_")
    || error.name.startsWith("CLIENT_")
    || /权限|无权|只读|VIP4/.test(error.message)
}
