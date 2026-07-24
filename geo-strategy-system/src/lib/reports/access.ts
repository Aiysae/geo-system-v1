import "server-only"

import { getCommercialReportJobScope } from "@/lib/reports/report-jobs"
import {
  requireOperationAccess,
  type OperationAccessContext,
} from "@/lib/team-access"
import type { TeamPermissionAction } from "@/lib/team-permissions"

export async function requireReportJobAccess(input: {
  jobId: string
  userId: string
  action: TeamPermissionAction
}): Promise<{
  scope: NonNullable<Awaited<ReturnType<typeof getCommercialReportJobScope>>>
  access: OperationAccessContext
} | null> {
  const scope = await getCommercialReportJobScope(input.jobId)
  if (!scope) return null
  const access = await requireOperationAccess({
    userId: input.userId,
    clientId: scope.clientId,
    module: "report",
    action: input.action,
    teamId: scope.teamId,
  })
  if (access.dataOwnerUserId !== scope.ownerUserId) return null
  return { scope, access }
}

export function isReportAccessError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name.startsWith("TEAM_")
    || error.name.startsWith("CLIENT_")
    || /权限|无权|只读|VIP4/.test(error.message)
}
