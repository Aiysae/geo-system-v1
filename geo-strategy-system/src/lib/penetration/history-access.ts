import "server-only"

import { getPenetrationHistoryRecordScope } from "@/lib/penetration/history-store"
import { getClientAccountLink } from "@/lib/client-accounts"
import {
  getClientExecutionPublicationPolicy,
  penetrationHistoryPublication,
} from "@/lib/client-feedback/publication"
import {
  requireOperationAccess,
  type OperationAccessContext,
} from "@/lib/team-access"
import type { TeamPermissionAction } from "@/lib/team-permissions"
import type { PenetrationHistoryListItem } from "@/types"

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

export async function getPenetrationHistoryViewerPolicy(input: {
  userId: string
  access: OperationAccessContext
  record: Pick<PenetrationHistoryListItem, "id" | "actorUserId" | "clientId">
}): Promise<{
  visible: boolean
  canViewRawAnswers: boolean
}> {
  if (input.access.mode !== "client") {
    return { visible: true, canViewRawAnswers: true }
  }
  const [link, publicationPolicy] = await Promise.all([
    getClientAccountLink(input.userId),
    getClientExecutionPublicationPolicy(
      input.access.dataOwnerUserId,
      input.record.clientId,
    ),
  ])
  if (!link || link.clientId !== input.record.clientId) {
    return { visible: false, canViewRawAnswers: false }
  }
  const publication = penetrationHistoryPublication(publicationPolicy, {
    historyId: input.record.id,
    actorUserId: input.record.actorUserId,
    viewerUserId: input.userId,
  })
  return {
    visible: publication === "full",
    canViewRawAnswers: publication === "full"
      && link.penetrationResultDetail === "full",
  }
}

export function isPenetrationHistoryAccessError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name.startsWith("TEAM_")
    || error.name.startsWith("CLIENT_")
    || /权限|无权|只读|VIP4/.test(error.message)
}
